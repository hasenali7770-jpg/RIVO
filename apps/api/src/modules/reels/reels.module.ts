import { Module } from '@nestjs/common';
import { ReelsController } from './reels.controller';
import { ReelsService } from './reels.service';
import { ReelFeedRepository } from './reel-feed.repository';
import { FfprobeService } from './ffprobe.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [ReelsController],
  providers: [ReelsService, ReelFeedRepository, FfprobeService],
  exports: [ReelsService, FfprobeService],
})
export class ReelsModule {}
