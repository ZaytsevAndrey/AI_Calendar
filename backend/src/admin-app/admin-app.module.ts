import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { createTypeOrmOptions } from '../database/typeorm.config';
import { User } from '../modules/users/user.entity';
import { Task } from '../modules/tasks/entities/task.entity';
import { VoiceDailyUsage } from '../modules/voice/entities/voice-daily-usage.entity';
import { UserIdentity } from '../modules/auth/entities/user-identity.entity';
import { UserSettings } from '../modules/user-settings/entities/user-settings.entity';
import { ScheduleJob } from '../modules/schedule/entities/schedule-job.entity';
import { PendingGoogleWrite } from '../modules/google-calendar/entities/pending-google-write.entity';
import { PushSubscription } from '../modules/reminders/entities/push-subscription.entity';
import { ReminderDelivery } from '../modules/reminders/entities/reminder-delivery.entity';
import { VoiceTurnLog } from '../modules/admin-data/entities/voice-turn-log.entity';
import { ApiErrorLog } from '../modules/admin-data/entities/api-error-log.entity';
import { AdminUser } from '../modules/admin-data/entities/admin-user.entity';
import { adminJwtSecret } from './admin-config';
import { AdminAuthService } from './admin-auth.service';
import { AdminGuard } from './admin.guard';
import { AdminStatsService } from './admin-stats.service';
import { AdminHealthService } from './admin-health.service';
import { AdminActionsService } from './admin-actions.service';
import { ClientApiService } from './client-api.service';
import { AdminAuthController, AdminController } from './admin.controller';

/**
 * The admin API: a separate process (src/admin-main.ts) with its own port, CORS
 * origin and signing key. It shares only the database with the client API and
 * never changes the schema; the client API owns TYPEORM_SYNC.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      useFactory: () => ({ ...createTypeOrmOptions(process.env), synchronize: false }),
    }),
    TypeOrmModule.forFeature([
      User,
      Task,
      VoiceDailyUsage,
      UserIdentity,
      UserSettings,
      ScheduleJob,
      PendingGoogleWrite,
      PushSubscription,
      ReminderDelivery,
      VoiceTurnLog,
      ApiErrorLog,
      AdminUser,
    ]),
    JwtModule.registerAsync({ useFactory: () => ({ secret: adminJwtSecret() }) }),
  ],
  controllers: [AdminAuthController, AdminController],
  providers: [AdminAuthService, AdminGuard, AdminStatsService, AdminHealthService, AdminActionsService, ClientApiService],
})
export class AdminAppModule {}
