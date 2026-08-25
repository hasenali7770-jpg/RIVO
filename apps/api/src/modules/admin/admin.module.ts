import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminAuthService } from './admin-auth.service';
import { AdminOperationsService } from './admin-operations.service';
import { PropertiesModule } from '../properties/properties.module';
import { PaymentsModule } from '../payments/payments.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PropertiesModule, PaymentsModule, NotificationsModule],
  controllers: [AdminController],
  providers: [AdminService, AdminAuthService, AdminOperationsService],
  exports: [AdminAuthService],
})
export class AdminModule {}
