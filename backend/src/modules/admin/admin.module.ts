import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/user.entity';
import { UsersModule } from '../users/users.module';
import { Task } from '../tasks/entities/task.entity';
import { VoiceDailyUsage } from '../voice/entities/voice-daily-usage.entity';
import { UserIdentity } from '../auth/entities/user-identity.entity';
import { UserSettings } from '../user-settings/entities/user-settings.entity';
import { ScheduleJob } from '../schedule/entities/schedule-job.entity';
import { PendingGoogleWrite } from '../google-calendar/entities/pending-google-write.entity';
import { PushSubscription } from '../reminders/entities/push-subscription.entity';
import { ReminderDelivery } from '../reminders/entities/reminder-delivery.entity';
import { AuthModule } from '../auth/auth.module';
import { VoiceModule } from '../voice/voice.module';
import { VoiceTurnLog } from './entities/voice-turn-log.entity';
import { VoiceTurnLogService } from './voice-turn-log.service';
import { AdminAuthService } from './admin-auth.service';
import { AdminGuard } from './admin.guard';
import { AdminStatsService } from './admin-stats.service';
import { AdminHealthService } from './admin-health.service';
import { AdminActionsService } from './admin-actions.service';
import { AdminAuthController, AdminController } from './admin.controller';

@Module({
  imports: [
    ConfigModule,
    UsersModule,
    AuthModule,
    VoiceModule,
    TypeOrmModule.forFeature([
      User,
      Task,
      VoiceDailyUsage,
      VoiceTurnLog,
      UserIdentity,
      UserSettings,
      ScheduleJob,
      PendingGoogleWrite,
      PushSubscription,
      ReminderDelivery,
    ]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({ secret: config.get<string>('JWT_SECRET') }),
    }),
  ],
  controllers: [AdminAuthController, AdminController],
  providers: [
    VoiceTurnLogService,
    AdminAuthService,
    AdminGuard,
    AdminStatsService,
    AdminHealthService,
    AdminActionsService,
  ],
  exports: [VoiceTurnLogService],
})
export class AdminModule {}
