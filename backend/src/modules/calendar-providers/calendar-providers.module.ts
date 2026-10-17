import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GoogleCalendarModule } from '../google-calendar/google-calendar.module';
import { UserSettingsModule } from '../user-settings/user-settings.module';
import { AppleCalendarProvider } from './apple-calendar.provider';
import { CalendarProvidersController } from './calendar-providers.controller';
import { CalendarProvidersRegistry } from './calendar-providers.registry';
import { ExternalCalendarBusyService } from './external-calendar-busy.service';
import { GoogleCalendarProvider } from './google-calendar.provider';
import { MicrosoftCalendarProvider } from './microsoft-calendar.provider';

@Module({
  imports: [
    GoogleCalendarModule,
    forwardRef(() => AuthModule),
    UserSettingsModule,
  ],
  controllers: [CalendarProvidersController],
  providers: [
    GoogleCalendarProvider,
    MicrosoftCalendarProvider,
    AppleCalendarProvider,
    CalendarProvidersRegistry,
    ExternalCalendarBusyService,
  ],
  exports: [
    CalendarProvidersRegistry,
    ExternalCalendarBusyService,
    GoogleCalendarProvider,
    MicrosoftCalendarProvider,
    AppleCalendarProvider,
  ],
})
export class CalendarProvidersModule {}
