import { z } from 'zod';

/**
 * Environment contract for the RIVO API.
 *
 * Design rules (Master Plan §0, §13, §24):
 *  1. Fail fast and loudly. A missing credential must stop the process at boot,
 *     never surface later as a confusing 500 or — worse — a silent no-op.
 *  2. No defaults that look like real credentials. There are no sample tokens
 *     anywhere in this file.
 *  3. Production is stricter than development. Anything that is merely
 *     inconvenient locally (a console OTP provider, a short secret) is refused
 *     outright when APP_ENV=production.
 */

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const int = (min: number, max: number) =>
  z.coerce.number().int().min(min).max(max);

export const AppEnvEnum = z.enum(['development', 'test', 'staging', 'production']);
export type AppEnvName = z.infer<typeof AppEnvEnum>;

export const envSchema = z
  .object({
    // --- Core ---------------------------------------------------------------
    APP_ENV: AppEnvEnum.default('development'),
    PORT: int(1, 65535).default(3000),
    API_BASE_URL: z.string().url('API_BASE_URL must be an absolute URL'),
    WEB_APP_URL: z.string().url().optional(),
    ADMIN_URL: z.string().url('ADMIN_URL must be an absolute URL'),
    CORS_EXTRA_ORIGINS: z.string().default(''),
    APP_DEEP_LINK_SCHEME: z.string().default('rivo'),
    DEFAULT_TIMEZONE: z.string().default('Asia/Baghdad'),
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

    // --- Data stores --------------------------------------------------------
    DATABASE_URL: z
      .string()
      .refine((v) => v.startsWith('postgres://') || v.startsWith('postgresql://'), {
        message: 'DATABASE_URL must be a postgresql:// connection string',
      }),
    DATABASE_POOL_SIZE: int(1, 100).default(10),
    REDIS_URL: z
      .string()
      .refine((v) => v.startsWith('redis://') || v.startsWith('rediss://'), {
        message: 'REDIS_URL must be a redis:// or rediss:// connection string',
      }),
    QUEUE_REDIS_URL: z.string().optional(),

    // --- Auth ---------------------------------------------------------------
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
    JWT_ACCESS_TTL: z.string().default('15m'),
    JWT_REFRESH_TTL_DAYS: int(1, 365).default(60),
    ADMIN_SESSION_TTL_HOURS: int(1, 168).default(12),
    ADMIN_BOOTSTRAP_EMAIL: z.string().email().optional(),
    ADMIN_BOOTSTRAP_PASSWORD: z.string().min(12).optional(),

    // --- Mapbox -------------------------------------------------------------
    MAPBOX_PUBLIC_TOKEN: z.string().optional(),
    MAPBOX_SECRET_TOKEN: z.string().optional(),
    MAPBOX_STYLE_DARK: z.string().default('mapbox://styles/mapbox/navigation-night-v1'),
    MAPBOX_STYLE_LIGHT: z.string().default('mapbox://styles/mapbox/navigation-day-v1'),

    // --- Cloudflare R2 ------------------------------------------------------
    CLOUDFLARE_ACCOUNT_ID: z.string().optional(),
    R2_ACCESS_KEY_ID: z.string().optional(),
    R2_SECRET_ACCESS_KEY: z.string().optional(),
    R2_BUCKET_NAME: z.string().default('rivo-media'),
    R2_PUBLIC_BASE_URL: z.string().optional(),
    R2_ENDPOINT: z.string().optional(),
    R2_PRESIGN_TTL_MINUTES: int(1, 60).default(15),
    R2_DOWNLOAD_TTL_MINUTES: int(1, 1440).default(60),

    // --- Cloudflare Stream --------------------------------------------------
    CLOUDFLARE_STREAM_TOKEN: z.string().optional(),
    CLOUDFLARE_STREAM_CUSTOMER_CODE: z.string().optional(),
    CLOUDFLARE_STREAM_WEBHOOK_SECRET: z.string().optional(),
    STREAM_UPLOAD_TTL_SECONDS: int(60, 21600).default(3600),

    // --- AI -----------------------------------------------------------------
    AI_PROVIDER: z.enum(['replicate', 'none']).default('none'),
    REPLICATE_API_TOKEN: z.string().optional(),
    REPLICATE_PHOTO_MODEL: z.string().default('nightmareai/real-esrgan'),
    REPLICATE_PHOTO_MODEL_VERSION: z.string().optional(),
    AI_MAX_COST_USD_PER_PROPERTY: z.coerce.number().min(0).default(0.5),
    AI_JOB_TIMEOUT_SECONDS: int(10, 900).default(180),

    // --- OTP ----------------------------------------------------------------
    OTP_PROVIDER: z.enum(['console', 'http']).default('console'),
    OTP_API_KEY: z.string().optional(),
    OTP_SENDER_ID: z.string().default('RIVO'),
    OTP_HTTP_URL: z.string().optional(),
    OTP_HTTP_BODY_TEMPLATE: z.string().optional(),
    OTP_HTTP_HEADERS: z.string().optional(),
    OTP_HTTP_MESSAGE_ID_PATH: z.string().default('id'),

    // --- Payments -----------------------------------------------------------
    PAYMENT_PROVIDER: z.enum(['manual', 'hmac_gateway']).default('manual'),
    PAYMENT_MERCHANT_ID: z.string().optional(),
    PAYMENT_SECRET: z.string().optional(),
    PAYMENT_WEBHOOK_SECRET: z.string().optional(),
    PAYMENT_CREATE_URL: z.string().optional(),
    PAYMENT_WEBHOOK_SIGNATURE_HEADER: z.string().default('x-signature'),
    PAYMENT_WEBHOOK_SIGNATURE_ALGO: z.enum(['sha256', 'sha512']).default('sha256'),
    PAYMENT_WEBHOOK_TOLERANCE_SECONDS: int(30, 3600).default(300),
    PAYMENT_INTENT_TTL_MINUTES: int(5, 1440).default(60),

    // --- Observability ------------------------------------------------------
    SENTRY_DSN_API: z.string().optional(),
    SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),
    SENTRY_RELEASE: z.string().optional(),

    // --- Rate limiting ------------------------------------------------------
    RATE_LIMIT_WINDOW_SECONDS: int(1, 3600).default(60),
    RATE_LIMIT_MAX_REQUESTS: int(1, 10000).default(120),
    ROUTING_RATE_LIMIT_PER_MINUTE: int(1, 1000).default(30),

    // --- Misc ---------------------------------------------------------------
    /// Disables Swagger UI. Swagger is served in every environment except
    /// production unless this is explicitly set.
    SWAGGER_ENABLED: bool.optional(),
    /// Trust the X-Forwarded-For chain. Must be true behind Nginx/Cloudflare,
    /// otherwise every client shares one rate-limit bucket.
    TRUST_PROXY: bool.default(true),
  })
  .superRefine((env, ctx) => {
    const fail = (path: string, message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });

    if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
      fail(
        'JWT_REFRESH_SECRET',
        'JWT_REFRESH_SECRET must differ from JWT_ACCESS_SECRET, otherwise an access token can be replayed as a refresh token',
      );
    }

    const isProd = env.APP_ENV === 'production';

    // --- Production-only requirements -------------------------------------
    if (isProd) {
      if (env.OTP_PROVIDER === 'console') {
        fail(
          'OTP_PROVIDER',
          'OTP_PROVIDER=console prints login codes to the server log and must never run in production. Configure a real SMS provider (OTP_PROVIDER=http).',
        );
      }
      if (!env.MAPBOX_SECRET_TOKEN) {
        fail('MAPBOX_SECRET_TOKEN', 'MAPBOX_SECRET_TOKEN is required in production for search and routing');
      }
      if (!env.MAPBOX_PUBLIC_TOKEN) {
        fail('MAPBOX_PUBLIC_TOKEN', 'MAPBOX_PUBLIC_TOKEN is required in production so the mobile app can render the map');
      }
      if (!env.CLOUDFLARE_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
        fail(
          'R2_ACCESS_KEY_ID',
          'Cloudflare R2 credentials (CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY) are required in production — property photos cannot be uploaded without them',
        );
      }
      if (!env.ADMIN_URL.startsWith('https://')) {
        fail('ADMIN_URL', 'ADMIN_URL must be https:// in production');
      }
      if (!env.API_BASE_URL.startsWith('https://')) {
        fail('API_BASE_URL', 'API_BASE_URL must be https:// in production');
      }
      if (!env.SENTRY_DSN_API) {
        fail('SENTRY_DSN_API', 'SENTRY_DSN_API is required in production so crashes are reported');
      }
    }

    // --- Provider-conditional requirements --------------------------------
    if (env.OTP_PROVIDER === 'http') {
      if (!env.OTP_HTTP_URL) fail('OTP_HTTP_URL', 'OTP_HTTP_URL is required when OTP_PROVIDER=http');
      if (!env.OTP_API_KEY) fail('OTP_API_KEY', 'OTP_API_KEY is required when OTP_PROVIDER=http');
      if (!env.OTP_HTTP_BODY_TEMPLATE)
        fail('OTP_HTTP_BODY_TEMPLATE', 'OTP_HTTP_BODY_TEMPLATE is required when OTP_PROVIDER=http');
    }

    if (env.PAYMENT_PROVIDER === 'hmac_gateway') {
      if (!env.PAYMENT_MERCHANT_ID)
        fail('PAYMENT_MERCHANT_ID', 'PAYMENT_MERCHANT_ID is required when PAYMENT_PROVIDER=hmac_gateway');
      if (!env.PAYMENT_SECRET)
        fail('PAYMENT_SECRET', 'PAYMENT_SECRET is required when PAYMENT_PROVIDER=hmac_gateway');
      if (!env.PAYMENT_WEBHOOK_SECRET)
        fail(
          'PAYMENT_WEBHOOK_SECRET',
          'PAYMENT_WEBHOOK_SECRET is required when PAYMENT_PROVIDER=hmac_gateway — an unverified webhook must never be able to mark a listing paid',
        );
      if (!env.PAYMENT_CREATE_URL)
        fail('PAYMENT_CREATE_URL', 'PAYMENT_CREATE_URL is required when PAYMENT_PROVIDER=hmac_gateway');
      if (env.PAYMENT_SECRET && env.PAYMENT_SECRET === env.PAYMENT_WEBHOOK_SECRET) {
        fail(
          'PAYMENT_WEBHOOK_SECRET',
          'PAYMENT_WEBHOOK_SECRET must differ from PAYMENT_SECRET so a leaked request-signing key cannot be used to forge webhooks',
        );
      }
    }

    if (env.AI_PROVIDER === 'replicate' && !env.REPLICATE_API_TOKEN) {
      fail('REPLICATE_API_TOKEN', 'REPLICATE_API_TOKEN is required when AI_PROVIDER=replicate');
    }

    if (env.CLOUDFLARE_STREAM_TOKEN && !env.CLOUDFLARE_STREAM_CUSTOMER_CODE) {
      fail(
        'CLOUDFLARE_STREAM_CUSTOMER_CODE',
        'CLOUDFLARE_STREAM_CUSTOMER_CODE is required alongside CLOUDFLARE_STREAM_TOKEN to build playback URLs',
      );
    }

    if (env.R2_ACCESS_KEY_ID && !env.CLOUDFLARE_ACCOUNT_ID && !env.R2_ENDPOINT) {
      fail(
        'CLOUDFLARE_ACCOUNT_ID',
        'CLOUDFLARE_ACCOUNT_ID (or an explicit R2_ENDPOINT) is required to reach the R2 bucket',
      );
    }
  });

export type RivoEnv = z.infer<typeof envSchema>;
