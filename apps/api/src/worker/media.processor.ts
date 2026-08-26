import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { StorageService } from '../integrations/r2/storage.service';
import { QueueService } from '../common/queue/queue.service';
import { JOB_NAMES, QUEUE_NAMES } from '../common/queue/queue.constants';
import { FeatureFlagsService } from '../modules/feature-flags/feature-flags.service';
import { measureImage } from '../integrations/ai/image-metrics';

/**
 * Verifies an uploaded photo and measures it for real.
 *
 * The client told us the dimensions when it presigned; this reads the actual
 * bytes. Those measured values are what the moderator and the quality score see.
 */
@Injectable()
export class MediaProcessor {
  private readonly logger = new Logger(MediaProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly queue: QueueService,
    private readonly flags: FeatureFlagsService,
  ) {}

  async verifyImage(mediaId: string): Promise<void> {
    const job = await this.prisma.mediaJob.create({
      data: { type: 'IMAGE_VERIFY', status: 'RUNNING', mediaId, startedAt: new Date() },
    });

    try {
      const media = await this.prisma.propertyMedia.findUnique({ where: { id: mediaId } });
      if (!media) {
        await this.finish(job.id, 'FAILED', 'Media record no longer exists');
        return;
      }

      const head = await this.storage.head(media.objectKey);
      if (!head.exists) {
        await this.prisma.propertyMedia.update({ where: { id: mediaId }, data: { uploadConfirmed: false } });
        await this.finish(job.id, 'FAILED', 'Object is not present in storage');
        return;
      }

      // Only the first 256 KB is fetched: every supported format carries its
      // dimensions in the header, so downloading a 20 MB photo to read two
      // integers would be waste.
      const buffer = await this.storage.getObjectBuffer(media.objectKey);
      const dims = measureImage(buffer);

      const issues: string[] = [];
      let qualityScore = 1;

      if (!dims) {
        issues.push('unreadable_format');
        qualityScore -= 0.5;
      } else {
        if (dims.width < 1024 || dims.height < 1024) {
          issues.push('low_resolution');
          qualityScore -= 0.3;
        }
        if (dims.width < 640 || dims.height < 640) {
          issues.push('very_low_resolution');
          qualityScore -= 0.2;
        }
      }
      // A large image stored in very few bytes has been compressed to mush.
      if (dims && buffer.byteLength / (dims.width * dims.height) < 0.05) {
        issues.push('heavily_compressed');
        qualityScore -= 0.15;
      }

      await this.prisma.propertyMedia.update({
        where: { id: mediaId },
        data: {
          width: dims?.width,
          height: dims?.height,
          sizeBytes: head.sizeBytes ?? media.sizeBytes,
          qualityScore: Math.max(0, Math.min(1, qualityScore)),
          qualityNotes: { issues, measuredAt: new Date().toISOString() },
        },
      });

      await this.finish(job.id, 'SUCCEEDED', null, { width: dims?.width, height: dims?.height, issues });

      // Enhancement is queued automatically for originals, so the seller does not
      // have to ask for it photo by photo.
      if (media.kind === 'ORIGINAL' && (await this.flags.isEnabled('ai_photo_enhancement'))) {
        const existing = await this.prisma.aiJob.findFirst({
          where: { mediaId, type: 'PHOTO_ENHANCE', status: { in: ['QUEUED', 'RUNNING', 'SUCCEEDED'] } },
        });
        if (!existing) {
          const aiJob = await this.prisma.aiJob.create({
            data: { type: 'PHOTO_ENHANCE', status: 'QUEUED', mediaId, propertyId: media.propertyId, operations: [] },
          });
          const queueJobId = await this.queue.add(QUEUE_NAMES.AI, JOB_NAMES.IMAGE_ENHANCE, {
            aiJobId: aiJob.id,
            mediaId,
          });
          await this.prisma.aiJob.update({ where: { id: aiJob.id }, data: { queueJobId } });
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Image verification failed for ${mediaId}: ${message}`);
      await this.finish(job.id, 'FAILED', message);
      throw err;
    }
  }

  private async finish(jobId: string, status: 'SUCCEEDED' | 'FAILED', error: string | null, result?: object) {
    await this.prisma.mediaJob.update({
      where: { id: jobId },
      data: { status, error, result: result ?? undefined, finishedAt: new Date() },
    });
  }
}
