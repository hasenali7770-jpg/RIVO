import { Injectable, Logger } from '@nestjs/common';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  REEL_MAX_DURATION_SECONDS,
  REEL_MIN_DURATION_SECONDS,
  REEL_MIN_SHORT_EDGE,
} from '@rivo/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StreamService } from '../../integrations/stream/stream.service';
import { QueueService } from '../../common/queue/queue.service';
import { JOB_NAMES, QUEUE_NAMES } from '../../common/queue/queue.constants';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import { validateReel } from './reel-validation';
import { ReelFeedRepository } from './reel-feed.repository';

@Injectable()
export class ReelsService {
  private readonly logger = new Logger(ReelsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stream: StreamService,
    private readonly queue: QueueService,
    private readonly flags: FeatureFlagsService,
    private readonly notifications: NotificationsService,
    private readonly feed: ReelFeedRepository,
  ) {}

  /**
   * Starts a reel upload.
   *
   * The reel is bound to a property before a single byte is uploaded — Master
   * Plan §7 forbids a general social feed, and this is where that is enforced.
   * There is no code path that creates a reel without a property.
   */
  async createUpload(propertyId: string, userId: string) {
    await this.flags.assertEnabled('reels_enabled');

    if (!this.stream.isConfigured) {
      throw AppError.notConfigured('Property Reels (Cloudflare Stream)', 'CLOUDFLARE_STREAM_TOKEN');
    }

    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, ownerId: userId, deletedAt: null },
      select: { id: true, status: true, reference: true },
    });
    if (!property) {
      throw new AppError(404, {
        code: ErrorCode.REEL_NOT_LINKED_TO_PROPERTY,
        message: 'A reel must belong to one of your listings',
        messageAr: 'يجب أن يكون الريل مرتبطاً بأحد إعلاناتك.',
      });
    }

    // One reel per listing in the MVP. Extra reels are a paid upgrade in the
    // roadmap (deck p.8), gated by the `featured_listings` family of flags.
    const existing = await this.prisma.propertyVideo.findFirst({
      where: { propertyId, status: { notIn: ['REJECTED', 'VALIDATION_FAILED'] } },
    });
    if (existing) {
      throw new AppError(409, {
        code: ErrorCode.REEL_ALREADY_EXISTS,
        message: 'This listing already has a reel. Delete it before uploading another.',
        messageAr: 'يوجد ريل لهذا الإعلان بالفعل. يرجى حذفه قبل رفع ريل جديد.',
        details: { videoId: existing.id, status: existing.status },
      });
    }

    const video = await this.prisma.propertyVideo.create({
      data: { propertyId, status: 'PENDING_UPLOAD' },
    });

    let upload;
    try {
      upload = await this.stream.createDirectUpload({ propertyId, videoId: video.id });
    } catch (err) {
      await this.prisma.propertyVideo.update({
        where: { id: video.id },
        data: { status: 'VALIDATION_FAILED', validationError: 'Could not create a Cloudflare Stream upload URL' },
      });
      throw err;
    }

    await this.prisma.propertyVideo.update({
      where: { id: video.id },
      data: { streamUid: upload.uid, uploadUrlExpiresAt: upload.expiresAt },
    });

    return {
      videoId: video.id,
      uploadUrl: upload.uploadUrl,
      streamUid: upload.uid,
      expiresAt: upload.expiresAt,
      requirements: {
        minShortEdgePx: REEL_MIN_SHORT_EDGE,
        minDurationSeconds: REEL_MIN_DURATION_SECONDS,
        maxDurationSeconds: REEL_MAX_DURATION_SECONDS,
        preferredResolution: '1080x1920',
        preferredAspect: '9:16',
        maxBytes: this.stream.maxUploadBytes,
        note: 'Resolution and duration are measured on the server after upload. A 720p file will be rejected even if the app allowed it.',
        noteAr: 'يتم فحص الدقة والمدة على الخادم بعد الرفع. الفيديو بدقة أقل من 1080p سيُرفض.',
      },
    };
  }

  /**
   * Called by the app once the device finishes POSTing to the Stream upload URL.
   * Queues the polling job; it does not trust the client's claim that the file
   * is fine.
   */
  async notifyUploadFinished(videoId: string, userId: string, caption?: string) {
    const video = await this.loadOwnedVideo(videoId, userId);

    await this.prisma.propertyVideo.update({
      where: { id: videoId },
      data: { status: 'UPLOADED', caption: caption?.slice(0, 300) },
    });

    const queueJobId = await this.queue.add(
      QUEUE_NAMES.VIDEO,
      JOB_NAMES.VIDEO_POLL,
      { videoId },
      { delay: 5000 },
    );
    await this.prisma.mediaJob.create({
      data: { type: 'VIDEO_POLL_STREAM', status: 'QUEUED', videoId, queueJobId },
    });

    return { videoId: video.id, status: 'UPLOADED', message: 'Processing. Validation runs once encoding completes.' };
  }

  /**
   * Validates an encoded reel against Cloudflare's own measurements.
   *
   * This is the enforcement point for the 1080p rule. It is called by the worker,
   * never by a client, and it writes either READY or VALIDATION_FAILED with the
   * exact reason the seller will see.
   */
  async validateAndPublish(videoId: string): Promise<{ status: string; reason?: string }> {
    const video = await this.prisma.propertyVideo.findUnique({
      where: { id: videoId },
      include: { property: { select: { id: true, ownerId: true, reference: true } } },
    });
    if (!video || !video.streamUid) {
      return { status: 'MISSING', reason: 'Video or Stream UID not found' };
    }

    const details = await this.stream.getVideo(video.streamUid);

    if (!details.ready) {
      if (details.state === 'error') {
        await this.prisma.propertyVideo.update({
          where: { id: videoId },
          data: {
            status: 'VALIDATION_FAILED',
            validationError: details.errorReason ?? 'Cloudflare Stream could not process this video',
          },
        });
        return { status: 'VALIDATION_FAILED', reason: details.errorReason ?? 'encoding error' };
      }
      // Still encoding — the worker reschedules.
      await this.prisma.propertyVideo.update({ where: { id: videoId }, data: { status: 'PROCESSING' } });
      return { status: 'PROCESSING' };
    }

    const result = validateReel({
      width: details.width,
      height: details.height,
      durationSeconds: details.durationSeconds,
      sizeBytes: details.sizeBytes,
    });

    const measured = {
      width: details.width,
      height: details.height,
      shortEdge: details.width && details.height ? Math.min(details.width, details.height) : null,
      durationSeconds: details.durationSeconds,
      sizeBytes: details.sizeBytes ? BigInt(details.sizeBytes) : null,
    };

    if (!result.valid) {
      await this.prisma.propertyVideo.update({
        where: { id: videoId },
        data: {
          status: 'VALIDATION_FAILED',
          validationError: result.message,
          validationDetails: result.details as object,
          ...measured,
        },
      });

      // The rejected file is removed from Stream: keeping an unpublishable video
      // would cost the client storage every month for nothing.
      this.stream
        .deleteVideo(video.streamUid)
        .catch((err) => this.logger.warn(`Could not delete rejected Stream video ${video.streamUid}: ${err.message}`));

      await this.notifications.notify(video.property.ownerId, {
        type: 'REEL_REJECTED',
        titleAr: 'لم يتم قبول الريل',
        titleEn: 'Reel was not accepted',
        bodyAr: result.messageAr ?? 'الفيديو لا يحقق شروط النشر.',
        bodyEn: result.message ?? 'The video did not meet the publishing requirements.',
        deepLink: `rivo://property/${video.property.id}/reel`,
      });

      return { status: 'VALIDATION_FAILED', reason: result.message };
    }

    await this.prisma.propertyVideo.update({
      where: { id: videoId },
      data: {
        status: 'READY',
        ...measured,
        playbackHlsUrl: details.hlsUrl ?? this.stream.playbackUrl(video.streamUid),
        playbackDashUrl: details.dashUrl,
        thumbnailUrl: details.thumbnailUrl,
        validationError: null,
        validationDetails: result.details as object,
        publishedAt: new Date(),
      },
    });

    if (await this.flags.isEnabled('ai_video_enhancement')) {
      await this.queue.add(QUEUE_NAMES.AI, JOB_NAMES.VIDEO_COVER, { videoId });
    }

    await this.notifications.notify(video.property.ownerId, {
      type: 'REEL_READY',
      titleAr: 'الريل جاهز',
      titleEn: 'Your reel is ready',
      bodyAr: `تم قبول الريل الخاص بإعلان ${video.property.reference}.`,
      bodyEn: `The reel for listing ${video.property.reference} passed validation.`,
      deepLink: `rivo://property/${video.property.id}`,
    });

    return { status: 'READY' };
  }

  async getStatus(videoId: string, userId: string) {
    const video = await this.loadOwnedVideo(videoId, userId);
    return {
      id: video.id,
      propertyId: video.propertyId,
      status: video.status,
      width: video.width,
      height: video.height,
      shortEdge: video.shortEdge,
      durationSeconds: video.durationSeconds,
      thumbnailUrl: video.thumbnailUrl,
      playbackHlsUrl: video.playbackHlsUrl,
      caption: video.caption,
      validationError: video.validationError,
      validationDetails: video.validationDetails,
      requirements: {
        minShortEdgePx: REEL_MIN_SHORT_EDGE,
        minDurationSeconds: REEL_MIN_DURATION_SECONDS,
        maxDurationSeconds: REEL_MAX_DURATION_SECONDS,
      },
    };
  }

  async deleteReel(videoId: string, userId: string) {
    const video = await this.loadOwnedVideo(videoId, userId);
    if (video.streamUid) {
      await this.stream
        .deleteVideo(video.streamUid)
        .catch((err) => this.logger.warn(`Could not delete Stream video ${video.streamUid}: ${err.message}`));
    }
    await this.prisma.propertyVideo.delete({ where: { id: videoId } });
    return { deleted: true };
  }

  async updateCaption(videoId: string, userId: string, caption: string) {
    await this.loadOwnedVideo(videoId, userId);
    await this.prisma.propertyVideo.update({ where: { id: videoId }, data: { caption: caption.slice(0, 300) } });
    return { updated: true };
  }

  async setCover(videoId: string, userId: string, seconds: number) {
    const video = await this.loadOwnedVideo(videoId, userId);
    if (!video.streamUid || !video.durationSeconds) {
      throw AppError.badRequest({ code: ErrorCode.VALIDATION_FAILED, message: 'The reel is not ready yet' });
    }
    if (seconds < 0 || seconds > video.durationSeconds) {
      throw AppError.badRequest({
        code: ErrorCode.VALIDATION_FAILED,
        message: `Cover time must be between 0 and ${Math.floor(video.durationSeconds)} seconds`,
      });
    }
    await this.stream.setThumbnailTimestamp(video.streamUid, seconds, video.durationSeconds);
    await this.prisma.propertyVideo.update({ where: { id: videoId }, data: { coverTimeSeconds: seconds } });
    return { coverTimeSeconds: seconds };
  }

  // --- Feed ------------------------------------------------------------------

  async getFeed(params: {
    viewerId: string | null;
    lat?: number;
    lng?: number;
    purpose?: string;
    type?: string[];
    governorate?: string;
    maxPrice?: string;
    page?: number;
    limit?: number;
  }) {
    await this.flags.assertEnabled('reels_enabled');

    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(params.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

    const rows = await this.feed.rank({ ...params, page, limit });

    return {
      items: rows.map((r) => ({
        id: r.video_id,
        hlsUrl: r.playback_hls_url,
        dashUrl: r.playback_dash_url,
        thumbnailUrl: r.thumbnail_url,
        durationSeconds: r.duration_seconds,
        width: r.width,
        height: r.height,
        caption: r.caption,
        viewCount: r.view_count,
        property: {
          id: r.property_id,
          reference: r.reference,
          title: r.title,
          purpose: r.purpose,
          type: r.type,
          priceIqd: r.price_iqd.toString(),
          rentPeriod: r.rent_period,
          areaSqm: r.area_sqm,
          bedrooms: r.bedrooms,
          bathrooms: r.bathrooms,
          governorate: r.governorate,
          district: r.district,
          lat: r.display_lat,
          lng: r.display_lng,
          isVerified: r.is_verified_listing,
          contactPhone: r.contact_phone,
          contactPreference: r.contact_preference,
        },
        seller: { displayName: r.seller_name, sellerType: r.seller_type, isVerified: r.seller_verified },
        isFavorited: r.is_favorited ?? false,
        distanceM: r.distance_m === null ? null : Math.round(r.distance_m),
        score: r.rank_score,
      })),
      pagination: { page, limit, hasMore: rows.length === limit },
    };
  }

  async getOne(videoId: string, viewerId: string | null) {
    const video = await this.prisma.propertyVideo.findFirst({
      where: { id: videoId, status: 'READY' },
      include: {
        property: {
          include: {
            location: true,
            owner: { include: { sellerProfile: true } },
          },
        },
      },
    });
    if (!video || video.property.status !== 'PUBLISHED') {
      throw AppError.notFound({ message: 'Reel not found', messageAr: 'الريل غير موجود.' });
    }

    const isFavorited = viewerId
      ? (await this.prisma.favorite.count({ where: { userId: viewerId, propertyId: video.propertyId } })) > 0
      : false;

    return {
      id: video.id,
      hlsUrl: video.playbackHlsUrl,
      dashUrl: video.playbackDashUrl,
      thumbnailUrl: video.thumbnailUrl,
      durationSeconds: video.durationSeconds,
      width: video.width,
      height: video.height,
      caption: video.caption,
      viewCount: video.viewCount,
      property: {
        id: video.property.id,
        reference: video.property.reference,
        title: video.property.title,
        purpose: video.property.purpose,
        type: video.property.type,
        priceIqd: video.property.priceIqd.toString(),
        rentPeriod: video.property.rentPeriod,
        areaSqm: video.property.areaSqm.toString(),
        governorate: video.property.governorate,
        district: video.property.district,
        lat: video.property.location?.publicLat ?? video.property.location?.lat ?? null,
        lng: video.property.location?.publicLng ?? video.property.location?.lng ?? null,
        isVerified: video.property.isVerifiedListing,
        contactPhone: video.property.contactPhone,
        contactPreference: video.property.contactPreference,
      },
      seller: {
        displayName: video.property.owner.displayName,
        sellerType: video.property.owner.sellerType,
        isVerified: video.property.owner.sellerProfile?.verification === 'VERIFIED',
      },
      isFavorited,
    };
  }

  /**
   * Records a view. `completion` feeds feed ranking, so it is clamped to 0..1
   * server-side — a client cannot inflate its own reel by reporting 50.
   */
  async recordView(videoId: string, params: { userId: string | null; anonId?: string; watchedSeconds: number; completion: number }) {
    const video = await this.prisma.propertyVideo.findFirst({
      where: { id: videoId, status: 'READY' },
      select: { id: true, durationSeconds: true },
    });
    if (!video) throw AppError.notFound({ message: 'Reel not found' });

    const completion = Math.max(0, Math.min(1, params.completion));
    const watched = Math.max(0, Math.min(params.watchedSeconds, (video.durationSeconds ?? 0) * 1.5));

    await this.prisma.$transaction([
      this.prisma.reelViewEvent.create({
        data: {
          videoId,
          userId: params.userId,
          anonId: params.userId ? null : params.anonId?.slice(0, 64),
          watchedSeconds: watched,
          completion,
        },
      }),
      this.prisma.propertyVideo.update({
        where: { id: videoId },
        data: { viewCount: { increment: 1 }, completionSum: { increment: completion } },
      }),
    ]);

    return { recorded: true };
  }

  private async loadOwnedVideo(videoId: string, userId: string) {
    const video = await this.prisma.propertyVideo.findFirst({
      where: { id: videoId, property: { ownerId: userId } },
    });
    if (!video) throw AppError.notFound({ message: 'Reel not found' });
    return video;
  }
}
