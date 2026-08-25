import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import * as Sentry from '@sentry/node';
import { EnvService } from './common/env/env.service';
import { WorkerModule } from './worker/worker.module';

/**
 * Background worker entry point.
 *
 * Runs as its own process (and its own container in docker-compose) so a long AI
 * job or a stalled video encode cannot occupy a request handler, and so the API
 * and the worker can be scaled independently as media load grows.
 */
async function bootstrap(): Promise<void> {
  const env = EnvService.load();

  if (env.SENTRY_DSN_API) {
    Sentry.init({
      dsn: env.SENTRY_DSN_API,
      environment: env.APP_ENV,
      release: env.SENTRY_RELEASE,
      tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
      initialScope: { tags: { process: 'worker' } },
    });
  }

  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: env.APP_ENV === 'development' ? ['log', 'warn', 'error', 'debug'] : ['log', 'warn', 'error'],
  });
  app.enableShutdownHooks();

  const logger = new Logger('Worker');
  logger.log(`RIVO worker started in ${env.APP_ENV} mode`);

  const shutdown = async (signal: string) => {
    logger.log(`${signal} received — finishing in-flight jobs before exit`);
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
