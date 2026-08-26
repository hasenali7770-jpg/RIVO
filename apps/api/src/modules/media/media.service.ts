import { Injectable, Logger } from '@nestjs/common';
import {
  PROPERTY_PHOTO_MAX,
  PROPERTY_PHOTO_MAX_BYTES,
  PROPERTY_PHOTO_MIN,
  PROPERTY_PHOTO_MIME_TYPES,
} from '@rivo/config';
import type { MediaKind } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../integrations/r2/storage.service';
import { QueueService } from '../../common/queue/queue.service';
import { JOB_NAMES, QUEUE_NAMES } from '../../common/queue/queue.constants';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import { extensionForMime } from '../../integrations/ai/image-metrics';
import { isEditable } from '../properties/property-state';
import { CompleteUploadDto, PresignImagesDto } from './dto/media.dto';

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly queue: QueueService,
    private readonly flags: FeatureFlagsService,
  ) {}

  /**
   * Issues presigned R2 PUT URLs.
   *
   * The 18-photo ceiling is checked here against what is already in the database
   * plus what is being requested, so a client cannot get around it by presigning
   * in several small batches (Master Plan §6 step 5).
   */
  async presignImages(dto: PresignImagesDto, userId: string) {
    if (!this.storage.isConfigured) {
      throw AppError.notConfigured('Photo uploads (Cloudflare R2)', 'R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY');
    }

    const property = await this.prisma.property.findFirst({
      where: { id: dto.propertyId, ownerId: userId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!property) throw AppError.notFound({ message: 'Listing not found' });

    if (!isEditable(property.status) && property.status !== 'AWAITING_PAYMENT') {
      throw new AppError(409, {
        code: ErrorCode.PROPERTY_INVALID_STATE,
        message: `Photos cannot be added while the listing is ${property.status}`,
        messageAr: 'لا يمكن إضافة صور في حالة الإعلان الحالية.',
        details: { status: property.status },
      });
    }

    const existing = await this.prisma.propertyMedia.count({
      where: { propertyId: dto.propertyId, kind: 'ORIGINAL' },
    });

    if (existing + dto.files.length > PROPERTY_PHOTO_MAX) {
      throw new AppError(422, {
        code: ErrorCode.PHOTO_COUNT_TOO_HIGH,
        message: `A listing may have at most ${PROPERTY_PHOTO_MAX} photos. This listing already has ${existing}; you requested ${dto.files.length} more.`,
        messageAr: `الحد الأعلى ${PROPERTY_PHOTO_MAX} صورة. لديك ${existing} صورة ويمكنك إضافة ${Math.max(0, PROPERTY_PHOTO_MAX - existing)} فقط.`,
        details: {
          existing,
          requested: dto.files.length,
          remaining: Math.max(0, PROPERTY_PHOTO_MAX - existing),
          maximum: PROPERTY_PHOTO_MAX,
        },
      });
    }

    const results = [];
    let position = existing;

    for (const file of dto.files) {
      if (!(PROPERTY_PHOTO_MIME_TYPES as readonly string[]).includes(file.contentType)) {
        throw new AppError(415, {
          code: ErrorCode.PHOTO_TYPE_UNSUPPORTED,
          message: `${file.contentType} is not an accepted image type`,
          messageAr: 'صيغة الصورة غير مدعومة.',
          details: { accepted: PROPERTY_PHOTO_MIME_TYPES },
        });
      }
      if (file.contentLength > PROPERTY_PHOTO_MAX_BYTES) {
        throw new AppError(413, {
          code: ErrorCode.PHOTO_TOO_LARGE,
          message: `Each photo must be ${Math.floor(PROPERTY_PHOTO_MAX_BYTES / 1024 / 1024)} MB or smaller`,
          messageAr: 'حجم الصورة كبير جداً.',
          details: { maxBytes: PROPERTY_PHOTO_MAX_BYTES },
        });
      }

      const objectKey = this.storage.buildPhotoKey({
        propertyId: dto.propertyId,
        kind: 'ORIGINAL',
        extension: extensionForMime(file.contentType),
      });

      const presigned = await this.storage.presignUpload({
        objectKey,
        contentType: file.contentType,
        contentLength: file.contentLength,
      });

      // The row is created up front, unconfirmed. `uploadConfirmed` only becomes
      // true after the server has verified the object in R2, which is what makes
      // the photo count trustworthy.
      const media = await this.prisma.propertyMedia.create({
        data: {
          propertyId: dto.propertyId,
          kind: 'ORIGINAL',
          objectKey,
          bucket: presigned.bucket,
          mimeType: file.contentType,
          sizeBytes: file.contentLength,
          checksumSha256: file.checksumSha256,
          position: position++,
          uploadConfirmed: false,
          isSelected: true,
        },
      });

      results.push({
        mediaId: media.id,
        uploadUrl: presigned.uploadUrl,
        objectKey,
        expiresAt: presigned.expiresAt,
        requiredHeaders: presigned.requiredHeaders,
      });
    }

    return {
      uploads: results,
      rules: { minimum: PROPERTY_PHOTO_MIN, maximum: PROPERTY_PHOTO_MAX, currentCount: existing },
    };
  }

  /**
   * Confirms uploads landed.
   *
   * Each object is HEADed in R2 and its true size compared with what was
   * presigned. A client claiming success for an object that is not there, or
   * that is a different size, is refused.
   */
  async completeUploads(dto: CompleteUploadDto, userId: string) {
    const media = await this.prisma.propertyMedia.findMany({
      where: { id: { in: dto.items.map((i) => i.mediaId) } },
      include: { property: { select: { id: true, ownerId: true, status: true } } },
    });

    if (media.length !== dto.items.length) {
      throw AppError.notFound({ message: 'One or more media records were not found' });
    }
    if (media.some((m) => m.property.ownerId !== userId)) {
      throw AppError.forbidden({ message: 'These photos belong to another user' });
    }

    const confirmed: string[] = [];
    const failed: Array<{ mediaId: string; reason: string }> = [];

    for (const item of media) {
      const head = await this.storage.head(item.objectKey);

      if (!head.exists) {
        failed.push({ mediaId: item.id, reason: 'The object was not found in storage' });
        continue;
      }
      // A 1 KB tolerance covers metadata differences between the presign and the
      // stored object; anything larger means a different file was uploaded.
      if (head.sizeBytes !== undefined && Math.abs(head.sizeBytes - item.sizeBytes) > 1024) {
        failed.push({
          mediaId: item.id,
          reason: `Uploaded size ${head.sizeBytes} does not match the ${item.sizeBytes} bytes that were presigned`,
        });
        continue;
      }

      await this.prisma.propertyMedia.update({
        where: { id: item.id },
        data: {
          uploadConfirmed: true,
          sizeBytes: head.sizeBytes ?? item.sizeBytes,
          mimeType: head.contentType ?? item.mimeType,
        },
      });
      confirmed.push(item.id);

      // Probes real dimensions, scores quality, and queues enhancement.
      await this.queue.add(QUEUE_NAMES.MEDIA, JOB_NAMES.IMAGE_VERIFY, { mediaId: item.id });
    }

    const propertyId = media[0].property.id;

    // Cover defaults to the first photo so a listing always has one.
    const property = await this.prisma.property.findUniqueOrThrow({
      where: { id: propertyId },
      select: { coverMediaId: true, photoCount: true },
    });
    if (!property.coverMediaId && confirmed.length > 0) {
      await this.prisma.property.update({
        where: { id: propertyId },
        data: { coverMediaId: confirmed[0] },
      });
    }

    const photoCount = await this.prisma.propertyMedia.count({
      where: { propertyId, kind: 'ORIGINAL', uploadConfirmed: true },
    });

    return {
      confirmed,
      failed,
      photoCount,
      rules: {
        minimum: PROPERTY_PHOTO_MIN,
        maximum: PROPERTY_PHOTO_MAX,
        satisfied: photoCount >= PROPERTY_PHOTO_MIN && photoCount <= PROPERTY_PHOTO_MAX,
      },
    };
  }

  async deleteMedia(mediaId: string, userId: string) {
    const media = await this.prisma.propertyMedia.findUnique({
      where: { id: mediaId },
      include: { property: { select: { id: true, ownerId: true, status: true, coverMediaId: true } } },
    });
    if (!media) throw AppError.notFound({ message: 'Photo not found' });
    if (media.property.ownerId !== userId) throw AppError.forbidden({ message: 'This photo belongs to another user' });

    if (!isEditable(media.property.status) && media.property.status !== 'AWAITING_PAYMENT') {
      throw new AppError(409, {
        code: ErrorCode.PROPERTY_INVALID_STATE,
        message: `Photos cannot be deleted while the listing is ${media.property.status}`,
        details: { status: media.property.status },
      });
    }

    // Deleting an original also removes its enhanced derivative, so an enhanced
    // copy of a deleted photo can never remain published.
    const derivatives = await this.prisma.propertyMedia.findMany({
      where: { sourceMediaId: mediaId },
      select: { id: true, objectKey: true },
    });

    await this.prisma.propertyMedia.deleteMany({
      where: { OR: [{ id: mediaId }, { sourceMediaId: mediaId }] },
    });

    // Storage cleanup is best-effort: an orphaned object costs a fraction of a
    // cent, while failing the request would leave the user unable to proceed.
    for (const key of [media.objectKey, ...derivatives.map((d) => d.objectKey)]) {
      this.storage.deleteObject(key).catch((err) => this.logger.warn(`Could not delete R2 object ${key}: ${err.message}`));
    }

    if (media.property.coverMediaId === mediaId) {
      const next = await this.prisma.propertyMedia.findFirst({
        where: { propertyId: media.property.id, kind: 'ORIGINAL', uploadConfirmed: true },
        orderBy: { position: 'asc' },
        select: { id: true },
      });
      await this.prisma.property.update({
        where: { id: media.property.id },
        data: { coverMediaId: next?.id ?? null },
      });
    }

    const photoCount = await this.prisma.propertyMedia.count({
      where: { propertyId: media.property.id, kind: 'ORIGINAL', uploadConfirmed: true },
    });
    return { deleted: true, photoCount };
  }

  /**
   * Chooses which version of a photo the listing publishes.
   *
   * Master Plan §6 step 6: the user must be able to compare original and enhanced
   * and pick. Both rows stay in the database and in R2 either way — selecting one
   * never deletes the other.
   */
  async selectVersion(mediaId: string, userId: string, use: 'ORIGINAL' | 'ENHANCED') {
    const media = await this.prisma.propertyMedia.findUnique({
      where: { id: mediaId },
      include: { property: { select: { ownerId: true, status: true } }, derivatives: true },
    });
    if (!media) throw AppError.notFound({ message: 'Photo not found' });
    if (media.property.ownerId !== userId) throw AppError.forbidden({ message: 'This photo belongs to another user' });

    const original = media.kind === 'ORIGINAL' ? media : await this.prisma.propertyMedia.findUniqueOrThrow({ where: { id: media.sourceMediaId as string } });
    const enhanced =
      media.kind === 'ENHANCED'
        ? media
        : await this.prisma.propertyMedia.findFirst({ where: { sourceMediaId: original.id, kind: 'ENHANCED' } });

    if (use === 'ENHANCED' && !enhanced) {
      throw AppError.badRequest({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'No enhanced version exists for this photo yet',
        messageAr: 'لا توجد نسخة محسّنة لهذه الصورة بعد.',
      });
    }

    await this.prisma.$transaction([
      this.prisma.propertyMedia.update({ where: { id: original.id }, data: { isSelected: use === 'ORIGINAL' } }),
      ...(enhanced
        ? [this.prisma.propertyMedia.update({ where: { id: enhanced.id }, data: { isSelected: use === 'ENHANCED' } })]
        : []),
    ]);

    return { mediaId: original.id, selected: use };
  }

  /** Original vs. enhanced, side by side, for the comparison screen. */
  async compareVersions(mediaId: string, userId: string) {
    const media = await this.prisma.propertyMedia.findUnique({
      where: { id: mediaId },
      include: {
        property: { select: { ownerId: true } },
        derivatives: true,
        aiJobs: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (!media) throw AppError.notFound({ message: 'Photo not found' });
    if (media.property.ownerId !== userId) throw AppError.forbidden({ message: 'This photo belongs to another user' });

    const enhanced = media.derivatives.find((d) => d.kind === 'ENHANCED');
    const job = media.aiJobs[0];

    return {
      original: {
        id: media.id,
        url: await this.storage.publicOrSignedUrl(media.objectKey),
        width: media.width,
        height: media.height,
        sizeBytes: media.sizeBytes,
        isSelected: media.isSelected,
      },
      enhanced: enhanced
        ? {
            id: enhanced.id,
            url: await this.storage.publicOrSignedUrl(enhanced.objectKey),
            width: enhanced.width,
            height: enhanced.height,
            sizeBytes: enhanced.sizeBytes,
            isSelected: enhanced.isSelected,
          }
        : null,
      enhancement: job
        ? {
            status: job.status,
            provider: job.provider,
            model: job.model,
            modelVersion: job.modelVersion,
            operations: job.operations,
            error: job.error,
            queuedAt: job.createdAt,
            finishedAt: job.finishedAt,
          }
        : null,
      // Reproduced here so the comparison UI can state plainly what was and was
      // not done to the image.
      disclosure: {
        en: 'Enhancement adjusts exposure, colour, noise and sharpness only. It never adds, removes or alters anything in the property.',
        ar: 'التحسين يشمل الإضاءة والألوان وتقليل التشويش والحدة فقط، ولا يضيف أو يحذف أو يغيّر أي شيء في العقار.',
      },
    };
  }

  /** Queues AI enhancement for one photo. */
  async requestEnhancement(mediaId: string, userId: string, force = false) {
    await this.flags.assertEnabled('ai_photo_enhancement');

    const media = await this.prisma.propertyMedia.findUnique({
      where: { id: mediaId },
      include: { property: { select: { ownerId: true, id: true } } },
    });
    if (!media) throw AppError.notFound({ message: 'Photo not found' });
    if (media.property.ownerId !== userId) throw AppError.forbidden({ message: 'This photo belongs to another user' });
    if (media.kind !== 'ORIGINAL') {
      throw AppError.badRequest({ code: ErrorCode.VALIDATION_FAILED, message: 'Only an original photo can be enhanced' });
    }
    if (!media.uploadConfirmed) {
      throw new AppError(409, {
        code: ErrorCode.UPLOAD_NOT_CONFIRMED,
        message: 'This photo has not finished uploading yet',
      });
    }

    const running = await this.prisma.aiJob.findFirst({
      where: { mediaId, type: 'PHOTO_ENHANCE', status: { in: ['QUEUED', 'RUNNING'] } },
    });
    if (running && !force) {
      return { jobId: running.id, status: running.status, alreadyQueued: true };
    }

    const job = await this.prisma.aiJob.create({
      data: { type: 'PHOTO_ENHANCE', status: 'QUEUED', mediaId, propertyId: media.property.id, operations: [] },
    });
    const queueJobId = await this.queue.add(QUEUE_NAMES.AI, JOB_NAMES.IMAGE_ENHANCE, { aiJobId: job.id, mediaId });
    await this.prisma.aiJob.update({ where: { id: job.id }, data: { queueJobId } });

    return { jobId: job.id, status: 'QUEUED', alreadyQueued: false };
  }

  /** Job status for the upload/processing progress UI. */
  async getJobStatus(jobId: string, userId: string) {
    const [aiJob, mediaJob] = await Promise.all([
      this.prisma.aiJob.findUnique({
        where: { id: jobId },
        include: { media: { include: { property: { select: { ownerId: true } } } } },
      }),
      this.prisma.mediaJob.findUnique({
        where: { id: jobId },
        include: { media: { include: { property: { select: { ownerId: true } } } } },
      }),
    ]);

    const job = aiJob ?? mediaJob;
    if (!job) throw AppError.notFound({ message: 'Job not found' });

    const ownerId = job.media?.property.ownerId;
    if (ownerId && ownerId !== userId) throw AppError.forbidden({ message: 'This job belongs to another user' });

    return {
      id: job.id,
      type: job.type,
      status: job.status,
      attempts: job.attempts,
      error: job.error,
      result: job.result,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      ...(aiJob ? { provider: aiJob.provider, model: aiJob.model, operations: aiJob.operations } : {}),
    };
  }

  /** All jobs for a listing — powers the "processing" state on the review screen. */
  async listPropertyJobs(propertyId: string, userId: string) {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, ownerId: userId },
      select: { id: true },
    });
    if (!property) throw AppError.notFound({ message: 'Listing not found' });

    const [aiJobs, mediaJobs] = await Promise.all([
      this.prisma.aiJob.findMany({ where: { propertyId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.mediaJob.findMany({
        where: { media: { propertyId } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const all = [...aiJobs, ...mediaJobs];
    return {
      jobs: all.map((j) => ({
        id: j.id,
        type: j.type,
        status: j.status,
        mediaId: j.mediaId,
        error: j.error,
        finishedAt: j.finishedAt,
      })),
      summary: {
        total: all.length,
        pending: all.filter((j) => j.status === 'QUEUED' || j.status === 'RUNNING').length,
        succeeded: all.filter((j) => j.status === 'SUCCEEDED').length,
        failed: all.filter((j) => j.status === 'FAILED').length,
        skipped: all.filter((j) => j.status === 'SKIPPED').length,
      },
    };
  }

  /** Presigns an avatar or verification-document upload (not property media). */
  async presignUserAsset(userId: string, params: { contentType: string; contentLength: number; purpose: 'avatar' | 'verification' }) {
    if (!this.storage.isConfigured) {
      throw AppError.notConfigured('Uploads (Cloudflare R2)', 'R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY');
    }
    if (!(PROPERTY_PHOTO_MIME_TYPES as readonly string[]).includes(params.contentType)) {
      throw new AppError(415, {
        code: ErrorCode.PHOTO_TYPE_UNSUPPORTED,
        message: `${params.contentType} is not an accepted image type`,
        details: { accepted: PROPERTY_PHOTO_MIME_TYPES },
      });
    }
    const objectKey = `users/${userId}/${params.purpose}/${Date.now()}.${extensionForMime(params.contentType)}`;
    const presigned = await this.storage.presignUpload({
      objectKey,
      contentType: params.contentType,
      contentLength: params.contentLength,
    });
    return { uploadUrl: presigned.uploadUrl, objectKey, expiresAt: presigned.expiresAt, requiredHeaders: presigned.requiredHeaders };
  }

  /** Used by the worker to register an enhanced derivative. */
  async recordEnhancedDerivative(params: {
    originalId: string;
    objectKey: string;
    bucket: string;
    mimeType: string;
    sizeBytes: number;
    width?: number;
    height?: number;
  }): Promise<string> {
    const original = await this.prisma.propertyMedia.findUniqueOrThrow({ where: { id: params.originalId } });

    const existing = await this.prisma.propertyMedia.findFirst({
      where: { sourceMediaId: params.originalId, kind: 'ENHANCED' as MediaKind },
    });

    if (existing) {
      await this.prisma.propertyMedia.update({
        where: { id: existing.id },
        data: {
          objectKey: params.objectKey,
          bucket: params.bucket,
          mimeType: params.mimeType,
          sizeBytes: params.sizeBytes,
          width: params.width,
          height: params.height,
          uploadConfirmed: true,
        },
      });
      return existing.id;
    }

    const created = await this.prisma.propertyMedia.create({
      data: {
        propertyId: original.propertyId,
        kind: 'ENHANCED',
        objectKey: params.objectKey,
        bucket: params.bucket,
        mimeType: params.mimeType,
        sizeBytes: params.sizeBytes,
        width: params.width,
        height: params.height,
        position: original.position,
        sourceMediaId: original.id,
        uploadConfirmed: true,
        // The enhanced version is offered, not imposed: the original stays
        // selected until the seller chooses otherwise.
        isSelected: false,
      },
    });
    return created.id;
  }
}
