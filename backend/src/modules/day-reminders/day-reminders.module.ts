import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GoogleCalendarModule } from '../google-calendar/google-calendar.module';
import { UserSettings } from '../user-settings/entities/user-settings.entity';
import { DayRemindersController } from './day-reminders.controller';
import { DayRemindersService } from './day-reminders.service';
import { DayReminder } from './entities/day-reminder.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([DayReminder, UserSettings]),
    GoogleCalendarModule,
  ],
  controllers: [DayRemindersController],
  providers: [DayRemindersService],
  exports: [DayRemindersService],
})
export class DayRemindersModule {}
