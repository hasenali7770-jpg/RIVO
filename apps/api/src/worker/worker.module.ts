import { Module } from '@nestjs/common';
import { EnvModule } from '../common/env/env.module';
import { PrismaModule } from '../common/prisma/prisma.module';
import { RedisModule } from '../common/redis/redis.module';
import { QueueModule } from '../common/queue/queue.module';
import { AuditModule } from '../common/audit/audit.module';
import { StorageModule } from '../integrations/r2/storage.module';
import { StreamModule } from '../integrations/stream/stream.module';
import { MapboxModule } from '../integrations/mapbox/mapbox.module';
import { AiModule } from '../integrations/ai/ai.module';
import { OtpModule } from '../integrations/otp/otp.module';
import { PaymentsIntegrationModule } from '../integrations/payments/payments-integration.module';
import { FeatureFlagsModule } from '../modules/feature-flags/feature-flags.module';
import { MediaModule } from '../modules/media/media.module';
import { ReelsModule } from '../modules/reels/reels.module';
import { TrafficModule } from '../modules/traffic/traffic.module';
import { PaymentsModule } from '../modules/payments/payments.module';
import { NotificationsModule } from '../modules/notifications/notifications.module';
import { MediaProcessor } from './media.processor';
import { AiProcessor } from './ai.processor';
import { VideoProcessor } from './video.processor';
import { MaintenanceProcessor } from './maintenance.processor';
import { WorkerRunner } from './worker.runner';

/**
 * The worker runs the same domain services as the API, in a separate process.
 *
 * Sharing the services rather than reimplementing them is what keeps a rule like
 * "an enhanced photo is never auto-selected" true in both places: there is only
 * one implementation of it.
 */
@Module({
  imports: [
    EnvModule,
    PrismaModule,
    RedisModule,
    QueueModule,
    AuditModule,
    StorageModule,
    StreamModule,
    MapboxModule,
    AiModule,
    OtpModule,
    PaymentsIntegrationModule,
    FeatureFlagsModule,
    MediaModule,
    ReelsModule,
    TrafficModule,
    PaymentsModule,
    NotificationsModule,
  ],
  providers: [MediaProcessor, AiProcessor, VideoProcessor, MaintenanceProcessor, WorkerRunner],
})
export class WorkerModule {}
