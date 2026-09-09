import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserSettings } from '../user-settings/entities/user-settings.entity';
import { HabitCheckIn } from './entities/habit-check-in.entity';
import { Habit } from './entities/habit.entity';
import { HabitsController } from './habits.controller';
import { HabitsService } from './habits.service';

@Module({
  imports: [TypeOrmModule.forFeature([Habit, HabitCheckIn, UserSettings])],
  controllers: [HabitsController],
  providers: [HabitsService],
})
export class HabitsModule {}
