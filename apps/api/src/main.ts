import 'reflect-metadata';
import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { Logger as PinoLogger } from 'nestjs-pino';
import helmet from 'helmet';
import express from 'express';
import { join } from 'node:path';
import * as Sentry from '@sentry/node';

import { EnvService } from './common/env/env.service';
import { AppModule } from './app.module';
import { buildOpenApiConfig } from './openapi.config';

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

  // Sample photos for a demonstration deployment, served from the API so a
  // populated marketplace can be shown before a Cloudflare R2 bucket exists.
  // Never in production: there, photos come from R2 and this directory has no
  // reason to be reachable.
  if (!envService.isProduction) {
    const demoMedia = express.static(join(__dirname, '..', 'public', 'demo-media'), { maxAge: '1h' });
    app.use(
      '/demo-media',
      // Object keys are unique per listing — (bucket, object_key) is a unique
      // constraint, as it must be when the key names a real file — but they all
      // point at the same handful of sample images. Resolve by basename so
      // demo/RV-DEMO03/sample-2.jpg and demo/RV-DEMO04/sample-2.jpg both serve
      // sample-2.jpg.
      (req: express.Request, res: express.Response, next: express.NextFunction) => {
        req.url = `/${req.url.split('/').pop() ?? ''}`;
        demoMedia(req, res, next);
      },
    );
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
    const config = buildOpenApiConfig(env.API_BASE_URL);

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
