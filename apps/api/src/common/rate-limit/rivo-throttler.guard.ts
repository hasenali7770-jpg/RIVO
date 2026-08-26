import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerRequest } from '@nestjs/throttler';

import { RATE_LIMIT_BUCKETS_KEY, RateLimitBucket } from './rate-limit.decorator';

/**
 * Makes the named rate-limit budgets opt-in.
 *
 * `ThrottlerGuard` evaluates every configured throttler on every route, so the
 * strict budgets meant for one endpoint (6 OTP requests an hour, 10 admin login
 * attempts per 5 minutes) were being charged against ordinary traffic as well.
 * A visitor browsing listings could exhaust the OTP budget and receive 429s for
 * an hour without ever having asked for a login code.
 *
 * Here a named budget is enforced only where `@RateLimit(bucket)` declared it.
 * The unnamed `default` budget is untouched and still covers every route.
 */
@Injectable()
export class RivoThrottlerGuard extends ThrottlerGuard {
  protected async handleRequest(requestProps: ThrottlerRequest): Promise<boolean> {
    const { context, throttler } = requestProps;

    if (throttler.name && throttler.name !== 'default' && !this.appliesTo(context, throttler.name)) {
      return true;
    }

    return super.handleRequest(requestProps);
  }

  private appliesTo(context: ExecutionContext, bucket: string): boolean {
    const declared = this.reflector.getAllAndOverride<RateLimitBucket[] | undefined>(RATE_LIMIT_BUCKETS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    return declared?.includes(bucket as RateLimitBucket) ?? false;
  }
}
