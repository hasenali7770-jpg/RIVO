import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, QueueEvents } from 'bullmq';
import Redis from 'ioredis';
import { EnvService } from '../env/env.service';
import { DEFAULT_JOB_OPTIONS, QUEUE_NAMES, QueueName } from './queue.constants';

/**
 * BullMQ producer side.
 *
 * BullMQ requires `maxRetriesPerRequest: null` on its connection, which is why it
 * gets its own Redis client rather than sharing RedisService's.
 */
@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly queues = new Map<QueueName, Queue>();
  private readonly events = new Map<QueueName, QueueEvents>();
  private connection!: Redis;

  constructor(private readonly env: EnvService) {}

  onModuleInit(): void {
    this.connection = new Redis(this.env.queueRedisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
    this.connection.on('error', (err) => this.logger.error(`Queue Redis error: ${err.message}`));

    for (const name of Object.values(QUEUE_NAMES)) {
      this.queues.set(
        name,
        new Queue(name, { connection: this.connection, defaultJobOptions: DEFAULT_JOB_OPTIONS }),
      );
    }
    this.logger.log(`${this.queues.size} queues ready`);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
    await Promise.all([...this.events.values()].map((e) => e.close()));
    await this.connection?.quit().catch(() => this.connection?.disconnect());
  }

  queue(name: QueueName): Queue {
    const q = this.queues.get(name);
    if (!q) throw new Error(`Queue ${name} is not registered`);
    return q;
  }

  async add<T extends object>(
    queueName: QueueName,
    jobName: string,
    data: T,
    opts?: { delay?: number; jobId?: string; attempts?: number; priority?: number },
  ): Promise<string | undefined> {
    const job = await this.queue(queueName).add(jobName, data, opts);
    return job.id;
  }

  /**
   * Registers a repeating job, replacing any prior schedule under the same id.
   * Called by the worker at boot so cron state lives in code, not in a Redis key
   * nobody can find later.
   */
  async schedule(queueName: QueueName, jobName: string, pattern: string, data: object = {}): Promise<void> {
    const queue = this.queue(queueName);
    const schedulers = await queue.getJobSchedulers();
    for (const s of schedulers) {
      if (s.name === jobName && s.id) await queue.removeJobScheduler(s.id);
    }
    await queue.upsertJobScheduler(jobName, { pattern }, { name: jobName, data });
  }

  /** Queue depths, surfaced on the admin dashboard. */
  async stats(): Promise<Record<string, { waiting: number; active: number; failed: number; delayed: number }>> {
    const out: Record<string, { waiting: number; active: number; failed: number; delayed: number }> = {};
    for (const [name, queue] of this.queues) {
      const counts = await queue.getJobCounts('waiting', 'active', 'failed', 'delayed');
      out[name] = {
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        failed: counts.failed ?? 0,
        delayed: counts.delayed ?? 0,
      };
    }
    return out;
  }
}
