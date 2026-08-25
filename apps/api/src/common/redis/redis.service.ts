import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { EnvService } from '../env/env.service';

/**
 * Shared Redis connection.
 *
 * Used for: OTP and API rate-limit counters, short-lived caches (geocoding and
 * routing responses, which cost money per call upstream), and live incident
 * fan-out. BullMQ opens its own connections — see QueueModule.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(private readonly env: EnvService) {
    this.client = new Redis(this.env.get('REDIS_URL'), {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: true,
      retryStrategy: (times) => Math.min(times * 200, 5000),
    });
    this.client.on('error', (err) => this.logger.error(`Redis error: ${err.message}`));
  }

  async onModuleInit(): Promise<void> {
    await this.client.connect();
    await this.client.ping();
    this.logger.log('Redis connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => this.client.disconnect());
  }

  /**
   * Fixed-window counter. Returns the new count and the seconds until the window
   * resets, so callers can send an accurate Retry-After.
   *
   * A fixed window is chosen over a sliding log deliberately: it is one round
   * trip, and for OTP and routing budgets the small boundary imprecision is
   * irrelevant next to the operational simplicity.
   */
  async incrementWindow(key: string, windowSeconds: number): Promise<{ count: number; ttl: number }> {
    const pipeline = this.client.multi();
    pipeline.incr(key);
    pipeline.ttl(key);
    const results = await pipeline.exec();
    const count = Number(results?.[0]?.[1] ?? 0);
    let ttl = Number(results?.[1]?.[1] ?? -1);
    if (ttl < 0) {
      await this.client.expire(key, windowSeconds);
      ttl = windowSeconds;
    }
    return { count, ttl };
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      // A corrupt cache entry should never break a request.
      await this.client.del(key);
      return null;
    }
  }

  async setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }

  /** Best-effort distributed lock; returns null when the lock is already held. */
  async acquireLock(key: string, ttlSeconds: number): Promise<string | null> {
    const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const ok = await this.client.set(key, token, 'EX', ttlSeconds, 'NX');
    return ok === 'OK' ? token : null;
  }

  /** Releases a lock only if this caller still owns it. */
  async releaseLock(key: string, token: string): Promise<void> {
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end`;
    await this.client.eval(script, 1, key, token);
  }

  async isHealthy(): Promise<boolean> {
    try {
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }
}
