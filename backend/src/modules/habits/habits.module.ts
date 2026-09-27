import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GoogleCalendarModule } from '../google-calendar/google-calendar.module';
import { UserSettings } from '../user-settings/entities/user-settings.entity';
import { VoiceModule } from '../voice/voice.module';
import { HabitCheckIn } from './entities/habit-check-in.entity';
import { Habit } from './entities/habit.entity';
import { HabitStreakTipService } from './habit-streak-tip.service';
import { HabitsController } from './habits.controller';
import { HabitsService } from './habits.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Habit, HabitCheckIn, UserSettings]),
    GoogleCalendarModule,
    VoiceModule,
  ],
  controllers: [HabitsController],
  providers: [HabitsService, HabitStreakTipService],
})
export class HabitsModule {}
