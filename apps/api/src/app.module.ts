import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';

import { EnvModule } from './common/env/env.module';
import { EnvService } from './common/env/env.service';
import { PrismaModule } from './common/prisma/prisma.module';
import { RedisModule } from './common/redis/redis.module';
import { QueueModule } from './common/queue/queue.module';
import { AuditModule } from './common/audit/audit.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { RequestIdMiddleware } from './common/interceptors/request-id.middleware';
import { BigIntInterceptor } from './common/interceptors/bigint.interceptor';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';

import { OtpModule } from './integrations/otp/otp.module';
import { MapboxModule } from './integrations/mapbox/mapbox.module';
import { StorageModule } from './integrations/r2/storage.module';
import { StreamModule } from './integrations/stream/stream.module';
import { AiModule } from './integrations/ai/ai.module';
import { PaymentsIntegrationModule } from './integrations/payments/payments-integration.module';

import { HealthModule } from './modules/health/health.module';
import { FeatureFlagsModule } from './modules/feature-flags/feature-flags.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { PropertiesModule } from './modules/properties/properties.module';
import { MediaModule } from './modules/media/media.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { ReelsModule } from './modules/reels/reels.module';
import { MapsModule } from './modules/maps/maps.module';
import { TrafficModule } from './modules/traffic/traffic.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AdminModule } from './modules/admin/admin.module';

@Module({
  imports: [
    EnvModule,
    LoggerModule.forRootAsync({
      inject: [EnvService],
      useFactory: (env: EnvService) => ({
        pinoHttp: {
          level: env.get('LOG_LEVEL'),
          // Human-readable locally, structured JSON everywhere else (Master Plan §17).
          transport: env.isDevelopment
            ? { target: 'pino-pretty', options: { singleLine: true, colorize: true } }
            : undefined,
          // `req` is typed as IncomingMessage by pino-http; the request id is
          // attached by RequestIdMiddleware, so it is read back through a cast.
          customProps: (req: unknown) => ({ requestId: (req as { requestId?: string }).requestId }),
          autoLogging: {
            ignore: (req: unknown) => (req as { url?: string }).url === '/api/v1/health',
          },
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.headers["x-signature"]',
              'req.body.code',
              'req.body.refreshToken',
              'req.body.password',
              'res.headers["set-cookie"]',
            ],
            censor: '[redacted]',
          },
        },
      }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [EnvService],
      useFactory: (env: EnvService) => {
        // The e2e suite drives hundreds of requests from one address in seconds.
        // These per-IP budgets are raised there so throttling does not mask the
        // behaviour under test. The OTP abuse controls that Master Plan §13
        // actually requires live in AuthService, are backed by Redis, and stay
        // fully active in every environment — including tests, which assert on
        // them directly.
        const relaxed = env.isTest;
        return {
          throttlers: [
            {
              name: 'default',
              ttl: env.get('RATE_LIMIT_WINDOW_SECONDS') * 1000,
              limit: relaxed ? 100_000 : env.get('RATE_LIMIT_MAX_REQUESTS'),
            },
            // Named budgets referenced by @Throttle on individual routes.
            { name: 'otp', ttl: 3600_000, limit: relaxed ? 100_000 : 6 },
            {
              name: 'routing',
              ttl: 60_000,
              limit: relaxed ? 100_000 : env.get('ROUTING_RATE_LIMIT_PER_MINUTE'),
            },
            { name: 'write', ttl: 60_000, limit: relaxed ? 100_000 : 30 },
          ],
        };
      },
    }),
    ScheduleModule.forRoot(),

    PrismaModule,
    RedisModule,
    QueueModule,
    AuditModule,

    OtpModule,
    MapboxModule,
    StorageModule,
    StreamModule,
    AiModule,
    PaymentsIntegrationModule,

    HealthModule,
    FeatureFlagsModule,
    AuthModule,
    UsersModule,
    PropertiesModule,
    MediaModule,
    PaymentsModule,
    ReelsModule,
    MapsModule,
    TrafficModule,
    NotificationsModule,
    AdminModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: BigIntInterceptor },
    // Order matters: rate limiting runs before authentication so an unauthenticated
    // flood is rejected without touching the database.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
