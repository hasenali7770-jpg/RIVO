import 'reflect-metadata';
import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger as PinoLogger } from 'nestjs-pino';
import helmet from 'helmet';
import express from 'express';
import * as Sentry from '@sentry/node';

import { EnvService } from './common/env/env.service';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  // Environment is validated before Nest starts: a misconfigured deployment must
  // fail here with a readable report, not halfway through the first request.
  const env = EnvService.load();

  if (env.SENTRY_DSN_API) {
    Sentry.init({
      dsn: env.SENTRY_DSN_API,
      environment: env.APP_ENV,
      release: env.SENTRY_RELEASE,
      tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    });
  }

  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: false });
  app.useLogger(app.get(PinoLogger));

  // Payment and Cloudflare Stream webhook signatures are computed over the exact
  // bytes that were sent. Re-serialising the parsed JSON would reorder keys and
  // change whitespace, breaking every signature, so the raw body is captured
  // here and read by the webhook handlers.
  app.use(
    express.json({
      limit: '2mb',
      verify: (req: express.Request & { rawBody?: string }, _res, buf: Buffer) => {
        if (buf?.length) req.rawBody = buf.toString('utf8');
      },
    }),
  );
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  const envService = app.get(EnvService);
  envService.logCapabilities();

  // Behind Nginx/Cloudflare the client IP is only correct with trust proxy set;
  // without it every caller shares one rate-limit bucket.
  if (env.TRUST_PROXY) {
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
  }

  app.use(
    helmet({
      // The API serves JSON, not HTML; the Swagger UI supplies its own CSP needs.
      contentSecurityPolicy: env.APP_ENV === 'production' ? undefined : false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // Mobile apps send no Origin header. Browsers must match the allow-list.
      if (!origin) return callback(null, true);
      if (envService.corsOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`Origin ${origin} is not allowed by CORS`), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'Idempotency-Key'],
    exposedHeaders: ['X-Request-Id'],
  });

  app.setGlobalPrefix('api', { exclude: [] });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      // Reject unknown properties rather than dropping them: a client sending a
      // field we do not understand is a bug worth surfacing.
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      validationError: { target: false, value: false },
    }),
  );

  app.enableShutdownHooks();

  if (envService.swaggerEnabled) {
    const config = new DocumentBuilder()
      .setTitle('RIVO API')
      .setDescription(
        'RIVO | ريفو — خرائط | داركم.\n\n' +
          'Smart navigation and the Iraqi real-estate marketplace in one API.\n\n' +
          '**Business rules enforced server-side:** 8–18 property photos, minimum 1080p reels, ' +
          'a 3,000 IQD listing fee, and payment state that only a verified gateway webhook can advance.',
      )
      .setVersion('1.0.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'user')
      .addBearerAuth({ type: 'http', scheme: 'bearer' }, 'admin')
      .addServer(env.API_BASE_URL)
      .addTag('auth', 'Phone OTP sign-in, token rotation, device sessions')
      .addTag('properties', 'Darcom listings: create, search, moderate')
      .addTag('media', 'Photo upload to R2 and AI enhancement jobs')
      .addTag('reels', 'Property Reels: Cloudflare Stream upload and feed')
      .addTag('payments', '3,000 IQD listing fee and gateway webhooks')
      .addTag('maps', 'Search, traffic-aware routing, route feedback')
      .addTag('traffic', 'Road incidents and consented telemetry')
      .addTag('admin', 'Admin dashboard API (role-gated)')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
      customSiteTitle: 'RIVO API',
      swaggerOptions: { persistAuthorization: true, tagsSorter: 'alpha' },
    });
  }

  await app.listen(env.PORT, '0.0.0.0');
  const logger = new Logger('Bootstrap');
  logger.log(`RIVO API listening on port ${env.PORT}`);
  if (envService.swaggerEnabled) logger.log(`Swagger UI at ${env.API_BASE_URL}/api/docs`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
