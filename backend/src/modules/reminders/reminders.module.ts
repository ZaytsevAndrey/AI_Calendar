import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HabitCheckIn } from '../habits/entities/habit-check-in.entity';
import { Habit } from '../habits/entities/habit.entity';
import { GoogleCalendarModule } from '../google-calendar/google-calendar.module';
import { Task } from '../tasks/entities/task.entity';
import { UserSettings } from '../user-settings/entities/user-settings.entity';
import { PushSubscription } from './entities/push-subscription.entity';
import { ReminderDelivery } from './entities/reminder-delivery.entity';
import { ReminderTickProcessor } from './reminder-tick.processor';
import { ReminderTickController, RemindersController } from './reminders.controller';
import { RemindersService } from './reminders.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PushSubscription,
      ReminderDelivery,
      UserSettings,
      Task,
      Habit,
      HabitCheckIn,
    ]),
    GoogleCalendarModule,
  ],
  controllers: [RemindersController, ReminderTickController],
  providers: [RemindersService, ReminderTickProcessor],
})
export class RemindersModule {}
