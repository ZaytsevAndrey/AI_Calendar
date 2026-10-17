import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { GoogleCalendarModule } from '../google-calendar/google-calendar.module';
import { UserSettings } from '../user-settings/entities/user-settings.entity';
import { UserSettingsModule } from '../user-settings/user-settings.module';
import { AppleCalendarProvider } from './apple-calendar.provider';
import { AppCalendarWriteService } from './app-calendar-write.service';
import { APP_CALENDAR_WRITES } from './app-calendar-writes.token';
import { CalendarProvidersController } from './calendar-providers.controller';
import { CalendarProvidersRegistry } from './calendar-providers.registry';
import { ExternalCalendarBusyService } from './external-calendar-busy.service';
import { GoogleCalendarProvider } from './google-calendar.provider';
import { MicrosoftCalendarProvider } from './microsoft-calendar.provider';

@Module({
  imports: [
    forwardRef(() => GoogleCalendarModule),
    forwardRef(() => AuthModule),
    forwardRef(() => UserSettingsModule),
    TypeOrmModule.forFeature([UserSettings]),
  ],
  controllers: [CalendarProvidersController],
  providers: [
    GoogleCalendarProvider,
    MicrosoftCalendarProvider,
    AppleCalendarProvider,
    CalendarProvidersRegistry,
    ExternalCalendarBusyService,
    AppCalendarWriteService,
    {
      provide: APP_CALENDAR_WRITES,
      useExisting: AppCalendarWriteService,
    },
  ],
  exports: [
    CalendarProvidersRegistry,
    ExternalCalendarBusyService,
    GoogleCalendarProvider,
    MicrosoftCalendarProvider,
    AppleCalendarProvider,
    AppCalendarWriteService,
    APP_CALENDAR_WRITES,
  ],
})
export class CalendarProvidersModule {}
