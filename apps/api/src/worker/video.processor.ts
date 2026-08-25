import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { QueueService } from '../common/queue/queue.service';
import { JOB_NAMES, QUEUE_NAMES } from '../common/queue/queue.constants';
import { ReelsService } from '../modules/reels/reels.service';

/** How many times to re-check Cloudflare before giving up on an encode. */
const MAX_POLL_ATTEMPTS = 40;
const POLL_INTERVAL_MS = 15_000;

/**
 * Watches a reel through Cloudflare Stream encoding, then validates it.
 *
 * Polling is used rather than relying only on Cloudflare's webhook: the webhook
 * needs a publicly reachable URL and a configured secret, and a reel that
 * silently never finishes would leave the seller staring at a spinner. Polling
 * always converges; the webhook, when configured, just makes it faster.
 */
@Injectable()
export class VideoProcessor {
  private readonly logger = new Logger(VideoProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly reels: ReelsService,
  ) {}

  async pollAndValidate(params: { videoId: string; attempt?: number }): Promise<void> {
    const attempt = params.attempt ?? 1;

    const video = await this.prisma.propertyVideo.findUnique({
      where: { id: params.videoId },
      select: { id: true, status: true, streamUid: true },
    });
    if (!video) return;

    // Already resolved by a webhook or a previous poll.
    if (['READY', 'VALIDATION_FAILED', 'REJECTED'].includes(video.status)) return;

    const result = await this.reels.validateAndPublish(params.videoId);

    if (result.status === 'PROCESSING') {
      if (attempt >= MAX_POLL_ATTEMPTS) {
        await this.prisma.propertyVideo.update({
          where: { id: params.videoId },
          data: {
            status: 'VALIDATION_FAILED',
            validationError:
              'The video did not finish processing in time. Please try uploading it again, or use a smaller file.',
          },
        });
        this.logger.warn(`Reel ${params.videoId} never finished encoding after ${attempt} polls`);
        return;
      }

      await this.queue.add(
        QUEUE_NAMES.VIDEO,
        JOB_NAMES.VIDEO_POLL,
        { videoId: params.videoId, attempt: attempt + 1 },
        { delay: POLL_INTERVAL_MS },
      );
      return;
    }

    this.logger.log(`Reel ${params.videoId} resolved as ${result.status}${result.reason ? `: ${result.reason}` : ''}`);
  }
}
