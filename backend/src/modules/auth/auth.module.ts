import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthService } from './auth.service';
import { AccountDeletionService } from './account-deletion.service';
import { AuthController } from './auth.controller';
import { MultiProviderAuthController } from './multi-provider-auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { UserIdentity } from './entities/user-identity.entity';
import { UserIdentitiesService } from './user-identities.service';
import { MicrosoftAuthService } from './microsoft-auth.service';
import { UsersModule } from '../users/users.module';
import { User } from '../users/user.entity';
import { UserSettings } from '../user-settings/entities/user-settings.entity';
import { Task } from '../tasks/entities/task.entity';
import { ScheduledTask } from '../schedule/schedule.entity';
import { Habit } from '../habits/entities/habit.entity';
import { HabitCheckIn } from '../habits/entities/habit-check-in.entity';
import { Phase } from '../phases/entities/phase.entity';
import { EventPhase } from '../event-phases/event-phase.entity';
import { PushSubscription } from '../reminders/entities/push-subscription.entity';
import { ReminderDelivery } from '../reminders/entities/reminder-delivery.entity';
import { ScheduleJob } from '../schedule/entities/schedule-job.entity';
import { PendingGoogleWrite } from '../google-calendar/entities/pending-google-write.entity';
import { CalendarEventOverlay } from '../calendar-overlays/entities/calendar-event-overlay.entity';
import { VoiceDailyUsage } from '../voice/entities/voice-daily-usage.entity';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GoogleCalendarModule } from '../google-calendar/google-calendar.module';
import { CalendarProvidersModule } from '../calendar-providers/calendar-providers.module';

@Module({
  imports: [
    ConfigModule,
    UsersModule,
    PassportModule,
    GoogleCalendarModule,
    forwardRef(() => CalendarProvidersModule),
    TypeOrmModule.forFeature([
      UserIdentity,
      UserSettings,
      User,
      Task,
      ScheduledTask,
      Habit,
      HabitCheckIn,
      Phase,
      EventPhase,
      PushSubscription,
      ReminderDelivery,
      ScheduleJob,
      PendingGoogleWrite,
      CalendarEventOverlay,
      VoiceDailyUsage,
    ]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: configService.get<string>('JWT_EXPIRES_IN') },
      }),
    }),
  ],
  controllers: [AuthController, MultiProviderAuthController],
  providers: [
    AuthService,
    AccountDeletionService,
    JwtStrategy,
    UserIdentitiesService,
    MicrosoftAuthService,
  ],
  exports: [AuthService, UserIdentitiesService, MicrosoftAuthService],
})
export class AuthModule {}
