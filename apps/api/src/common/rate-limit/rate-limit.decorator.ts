import { SetMetadata, applyDecorators } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

/** Named budgets declared in AppModule's ThrottlerModule configuration. */
export type RateLimitBucket = 'otp' | 'routing' | 'write' | 'adminAuth';

export const RATE_LIMIT_BUCKETS_KEY = 'rivo:rate-limit-buckets';

export interface RateLimitOptions {
  /** Requests allowed per window. Omit to use the budget configured in AppModule. */
  limit?: number;
  /** Window length in milliseconds. Omit to use the budget configured in AppModule. */
  ttl?: number;
}

/**
 * Opts a route into one of the named rate-limit budgets.
 *
 * This exists instead of using `@Throttle` directly because `@nestjs/throttler`
 * applies **every** configured throttler to **every** route: a named budget in
 * the module configuration is a global default, and `@Throttle` on a route only
 * overrides its numbers. Declaring an `otp` budget of 6/hour therefore capped
 * *all* traffic — including anonymous listing search — at 6 requests an hour per
 * IP. Behind carrier NAT that locks out a whole city.
 *
 * `RivoThrottlerGuard` reads the metadata this decorator writes and enforces a
 * named budget only on the routes that asked for it. The `default` budget still
 * applies everywhere.
 */
export function RateLimit(bucket: RateLimitBucket, options: RateLimitOptions = {}): MethodDecorator & ClassDecorator {
  return applyDecorators(
    SetMetadata(RATE_LIMIT_BUCKETS_KEY, [bucket]),
    Throttle({ [bucket]: { limit: options.limit, ttl: options.ttl } }),
  );
}
