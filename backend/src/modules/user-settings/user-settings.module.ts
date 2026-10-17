import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserSettingsService } from './user-settings.service';
import { UserSettingsController } from './user-settings.controller';
import { UserSettings } from './entities/user-settings.entity';
import { PhasesModule } from '../phases/phases.module';
import { GoogleCalendarModule } from '../google-calendar/google-calendar.module';
import { CalendarProvidersModule } from '../calendar-providers/calendar-providers.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserSettings]),
    PhasesModule,
    GoogleCalendarModule,
    forwardRef(() => CalendarProvidersModule),
  ],
  controllers: [UserSettingsController],
  providers: [UserSettingsService],
  exports: [UserSettingsService],
})
export class UserSettingsModule {}
