import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import Redis from 'ioredis';
import { EnvService } from '../common/env/env.service';
import { QueueService } from '../common/queue/queue.service';
import { JOB_NAMES, QUEUE_NAMES } from '../common/queue/queue.constants';
import { MediaProcessor } from './media.processor';
import { AiProcessor } from './ai.processor';
import { VideoProcessor } from './video.processor';
import { MaintenanceProcessor } from './maintenance.processor';

/**
 * Binds BullMQ queues to processors and registers the recurring schedules.
 *
 * Concurrency is set per queue rather than globally: AI jobs are slow and cost
 * money upstream, so they run few-at-a-time; media verification is quick and I/O
 * bound and can run wider.
 */
@Injectable()
export class WorkerRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkerRunner.name);
  private readonly workers: Worker[] = [];
  private connection!: Redis;

  constructor(
    private readonly env: EnvService,
    private readonly queue: QueueService,
    private readonly media: MediaProcessor,
    private readonly ai: AiProcessor,
    private readonly video: VideoProcessor,
    private readonly maintenance: MaintenanceProcessor,
  ) {}

  async onModuleInit(): Promise<void> {
    this.connection = new Redis(this.env.queueRedisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

    this.workers.push(
      this.build(QUEUE_NAMES.MEDIA, 5, async (job) => {
        if (job.name === JOB_NAMES.IMAGE_VERIFY) {
          await this.media.verifyImage((job.data as { mediaId: string }).mediaId);
        }
      }),
    );

    this.workers.push(
      this.build(QUEUE_NAMES.AI, 2, async (job) => {
        if (job.name === JOB_NAMES.IMAGE_ENHANCE) {
          await this.ai.enhancePhoto(job.data as { aiJobId: string; mediaId: string });
        }
      }),
    );

    this.workers.push(
      this.build(QUEUE_NAMES.VIDEO, 4, async (job) => {
        if (job.name === JOB_NAMES.VIDEO_POLL) {
          await this.video.pollAndValidate(job.data as { videoId: string; attempt?: number });
        }
      }),
    );

    this.workers.push(
      this.build(QUEUE_NAMES.MAINTENANCE, 1, async (job) => {
        switch (job.name) {
          case JOB_NAMES.TELEMETRY_AGGREGATE:
            await this.maintenance.aggregateTelemetry();
            break;
          case JOB_NAMES.TELEMETRY_PURGE:
            await this.maintenance.purgeRawTelemetry();
            await this.maintenance.purgeOtpChallenges();
            await this.maintenance.purgeSessions();
            break;
          case JOB_NAMES.INCIDENTS_EXPIRE:
            await this.maintenance.expireIncidents();
            break;
          case JOB_NAMES.PAYMENTS_EXPIRE:
            await this.maintenance.expirePayments();
            break;
          default:
            this.logger.warn(`Unhandled maintenance job "${job.name}"`);
        }
      }),
    );

    await this.registerSchedules();
    this.logger.log(`RIVO worker ready — ${this.workers.length} queues attached`);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close()));
    await this.connection?.quit().catch(() => this.connection?.disconnect());
  }

  private build(queueName: string, concurrency: number, handler: (job: Job) => Promise<void>): Worker {
    const worker = new Worker(queueName, handler, { connection: this.connection, concurrency });

    worker.on('failed', (job, err) => {
      this.logger.error(
        `${queueName} job ${job?.name ?? '?'} (${job?.id ?? '?'}) failed on attempt ${job?.attemptsMade ?? 0}: ${err.message}`,
      );
    });
    worker.on('error', (err) => this.logger.error(`${queueName} worker error: ${err.message}`));

    return worker;
  }

  private async registerSchedules(): Promise<void> {
    // Aggregation runs slightly more often than the 15-minute bucket so a bucket
    // is complete by the time routing reads it.
    await this.queue.schedule(QUEUE_NAMES.MAINTENANCE, JOB_NAMES.TELEMETRY_AGGREGATE, '*/10 * * * *');
    // Retention sweep, daily at 03:15 Baghdad time (00:15 UTC).
    await this.queue.schedule(QUEUE_NAMES.MAINTENANCE, JOB_NAMES.TELEMETRY_PURGE, '15 0 * * *');
    await this.queue.schedule(QUEUE_NAMES.MAINTENANCE, JOB_NAMES.INCIDENTS_EXPIRE, '*/5 * * * *');
    await this.queue.schedule(QUEUE_NAMES.MAINTENANCE, JOB_NAMES.PAYMENTS_EXPIRE, '*/10 * * * *');
  }
}
