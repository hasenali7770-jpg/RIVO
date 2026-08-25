import { Injectable, Logger } from '@nestjs/common';
import { envSchema, RivoEnv } from './env.schema';

/**
 * Validated, typed access to configuration.
 *
 * `load()` is called before the Nest application is created (see main.ts) so a
 * misconfigured deployment dies at startup with a readable report rather than
 * booting into a half-working state.
 */
@Injectable()
export class EnvService {
  private static cached: RivoEnv | null = null;
  private static readonly logger = new Logger('Env');

  /** Parses process.env, throwing a formatted error listing every problem. */
  static load(source: NodeJS.ProcessEnv = process.env): RivoEnv {
    const parsed = envSchema.safeParse(source);

    if (!parsed.success) {
      const lines = parsed.error.issues.map((issue) => {
        const key = issue.path.join('.') || '(root)';
        return `  • ${key}: ${issue.message}`;
      });
      const message = [
        '',
        'RIVO cannot start — the environment is invalid:',
        ...lines,
        '',
        'Fix the values above in your .env (see .env.example for the full contract).',
        '',
      ].join('\n');
      throw new Error(message);
    }

    EnvService.cached = parsed.data;
    return parsed.data;
  }

  static get instance(): RivoEnv {
    if (!EnvService.cached) return EnvService.load();
    return EnvService.cached;
  }

  /** Test seam: clears the memoised environment. */
  static reset(): void {
    EnvService.cached = null;
  }

  get env(): RivoEnv {
    return EnvService.instance;
  }

  get<K extends keyof RivoEnv>(key: K): RivoEnv[K] {
    return this.env[key];
  }

  get isProduction(): boolean {
    return this.env.APP_ENV === 'production';
  }

  get isDevelopment(): boolean {
    return this.env.APP_ENV === 'development';
  }

  get isTest(): boolean {
    return this.env.APP_ENV === 'test';
  }

  get swaggerEnabled(): boolean {
    return this.env.SWAGGER_ENABLED ?? !this.isProduction;
  }

  get queueRedisUrl(): string {
    return this.env.QUEUE_REDIS_URL || this.env.REDIS_URL;
  }

  /** Origins allowed to call the API from a browser. Mobile apps send no Origin. */
  get corsOrigins(): string[] {
    const extra = this.env.CORS_EXTRA_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean);
    const base = [this.env.ADMIN_URL, this.env.WEB_APP_URL].filter((o): o is string => Boolean(o));
    return Array.from(new Set([...base, ...extra]));
  }

  // --- Capability probes -----------------------------------------------------
  // Used by the feature-flag resolver and /health so the mobile app can hide
  // entry points instead of showing controls that would fail (Master Plan §24).

  get hasMapbox(): boolean {
    return Boolean(this.env.MAPBOX_SECRET_TOKEN);
  }

  get hasR2(): boolean {
    return Boolean(
      this.env.R2_ACCESS_KEY_ID &&
        this.env.R2_SECRET_ACCESS_KEY &&
        (this.env.CLOUDFLARE_ACCOUNT_ID || this.env.R2_ENDPOINT),
    );
  }

  get hasStream(): boolean {
    return Boolean(this.env.CLOUDFLARE_STREAM_TOKEN && this.env.CLOUDFLARE_STREAM_CUSTOMER_CODE);
  }

  get hasAi(): boolean {
    return this.env.AI_PROVIDER !== 'none';
  }

  get hasOnlinePayments(): boolean {
    return this.env.PAYMENT_PROVIDER !== 'manual';
  }

  /**
   * Logs which integrations are live and which are not. Printed once at boot so
   * an operator can see at a glance what this deployment can actually do.
   */
  logCapabilities(): void {
    const rows: Array<[string, boolean, string]> = [
      ['Mapbox (search + routing)', this.hasMapbox, 'MAPBOX_SECRET_TOKEN'],
      ['Cloudflare R2 (photos)', this.hasR2, 'R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY'],
      ['Cloudflare Stream (reels)', this.hasStream, 'CLOUDFLARE_STREAM_TOKEN'],
      ['AI enhancement', this.hasAi, 'AI_PROVIDER'],
      ['Online payments', this.hasOnlinePayments, 'PAYMENT_PROVIDER'],
      ['Sentry', Boolean(this.env.SENTRY_DSN_API), 'SENTRY_DSN_API'],
    ];
    EnvService.logger.log(`RIVO API starting in ${this.env.APP_ENV} mode`);
    for (const [label, enabled, hint] of rows) {
      if (enabled) {
        EnvService.logger.log(`  [on ] ${label}`);
      } else {
        EnvService.logger.warn(`  [off] ${label} — set ${hint} to enable`);
      }
    }
    if (this.env.OTP_PROVIDER === 'console') {
      EnvService.logger.warn(
        '  [dev] OTP_PROVIDER=console — login codes are printed to this log and no SMS is sent',
      );
    }
    if (this.env.PAYMENT_PROVIDER === 'manual') {
      EnvService.logger.warn(
        '  [dev] PAYMENT_PROVIDER=manual — listing fees must be settled by a FINANCE admin; no online gateway is connected',
      );
    }
  }
}
