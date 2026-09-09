import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { resolveIanaTimeZone } from '../../common/iana-time-zone';
import { addDaysToYmd, localYmd } from '../voice/voice-local-date.util';
import { UserSettings } from '../user-settings/entities/user-settings.entity';
import { CreateHabitDto } from './dto/create-habit.dto';
import { UpdateHabitDto } from './dto/update-habit.dto';
import { HabitCheckIn } from './entities/habit-check-in.entity';
import { Habit } from './entities/habit.entity';
import {
  computeHabitStats,
  isValidYmd,
  lastNDays,
} from './habit-stats.util';

const DEFAULT_COLOR = '#3b82f6';
const HEX_COLOR = /^#([A-Fa-f0-9]{6})$/;
const WEEK_DAYS = 7;

export type HabitDayMarker = { date: string; done: boolean };

export type HabitSummary = {
  id: string;
  name: string;
  color: string;
  description: string | null;
  checkedToday: boolean;
  checkedYesterday: boolean;
  currentStreak: number;
  points: number;
  totalCheckIns: number;
  last7Days: HabitDayMarker[];
  createdAt: Date;
  updatedAt: Date;
};

export type HabitsListResponse = {
  today: string;
  yesterday: string;
  timeZone: string;
  habits: HabitSummary[];
};

@Injectable()
export class HabitsService {
  constructor(
    @InjectRepository(Habit)
    private readonly habitsRepository: Repository<Habit>,
    @InjectRepository(HabitCheckIn)
    private readonly checkInsRepository: Repository<HabitCheckIn>,
    @InjectRepository(UserSettings)
    private readonly userSettingsRepository: Repository<UserSettings>,
  ) {}

  async findAll(userId: string): Promise<HabitsListResponse> {
    const { today, yesterday, timeZone } = await this.civilWindow(userId);
    const habits = await this.habitsRepository.find({
      where: { userId },
      order: { createdAt: 'ASC' },
    });
    const summaries = await this.summariesFor(habits, today, yesterday);
    return { today, yesterday, timeZone, habits: summaries };
  }

  async create(userId: string, dto: CreateHabitDto): Promise<HabitSummary> {
    const habit = this.habitsRepository.create({
      userId,
      name: this.requireName(dto.name),
      color: this.normalizeColor(dto.color),
      description: this.normalizeDescription(dto.description),
    });
    const saved = await this.habitsRepository.save(habit);
    return this.summaryFor(saved, userId);
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateHabitDto,
  ): Promise<HabitSummary> {
    const habit = await this.requireHabit(userId, id);
    if (dto.name !== undefined) habit.name = this.requireName(dto.name);
    if (dto.color !== undefined) habit.color = this.normalizeColor(dto.color);
    if (dto.description !== undefined) {
      habit.description = this.normalizeDescription(dto.description);
    }
    const saved = await this.habitsRepository.save(habit);
    return this.summaryFor(saved, userId);
  }

  async remove(userId: string, id: string): Promise<void> {
    const habit = await this.requireHabit(userId, id);
    await this.checkInsRepository.delete({ habitId: habit.id });
    await this.habitsRepository.remove(habit);
  }

  async setCheckIn(
    userId: string,
    habitId: string,
    date: string,
    done: boolean,
  ): Promise<HabitSummary> {
    const habit = await this.requireHabit(userId, habitId);
    const { today, yesterday } = await this.civilWindow(userId);
    const localDate = this.requireAllowedDate(date, today, yesterday);

    const existing = await this.checkInsRepository.findOne({
      where: { habitId: habit.id, localDate },
    });

    if (done && !existing) {
      await this.checkInsRepository.save(
        this.checkInsRepository.create({
          habitId: habit.id,
          userId,
          localDate,
        }),
      );
    } else if (!done && existing) {
      await this.checkInsRepository.remove(existing);
    }

    const [summary] = await this.summariesFor([habit], today, yesterday);
    return summary;
  }

  private async summaryFor(habit: Habit, userId: string): Promise<HabitSummary> {
    const { today, yesterday } = await this.civilWindow(userId);
    const [summary] = await this.summariesFor([habit], today, yesterday);
    return summary;
  }

  private async summariesFor(
    habits: Habit[],
    today: string,
    yesterday: string,
  ): Promise<HabitSummary[]> {
    if (habits.length === 0) return [];
    const rows = await this.checkInsRepository.find({
      where: { habitId: In(habits.map((habit) => habit.id)) },
      select: ['habitId', 'localDate'],
    });
    const datesByHabit = new Map<string, string[]>();
    for (const row of rows) {
      const list = datesByHabit.get(row.habitId) ?? [];
      list.push(row.localDate);
      datesByHabit.set(row.habitId, list);
    }
    return habits.map((habit) => {
      const dates = datesByHabit.get(habit.id) ?? [];
      const done = new Set(dates);
      const stats = computeHabitStats(dates, today);
      return {
        id: habit.id,
        name: habit.name,
        color: habit.color,
        description: habit.description,
        checkedToday: done.has(today),
        checkedYesterday: done.has(yesterday),
        currentStreak: stats.currentStreak,
        points: stats.points,
        totalCheckIns: stats.totalCheckIns,
        last7Days: lastNDays(today, WEEK_DAYS, done),
        createdAt: habit.createdAt,
        updatedAt: habit.updatedAt,
      };
    });
  }

  private async requireHabit(userId: string, id: string): Promise<Habit> {
    const habit = await this.habitsRepository.findOne({ where: { id, userId } });
    if (!habit) {
      throw new NotFoundException('Habit not found');
    }
    return habit;
  }

  private async civilWindow(userId: string): Promise<{
    today: string;
    yesterday: string;
    timeZone: string;
  }> {
    const settings = await this.userSettingsRepository.findOne({
      where: { userId },
    });
    const timeZone = resolveIanaTimeZone(settings?.timeZone);
    const today = localYmd(new Date().toISOString(), timeZone);
    return { today, yesterday: addDaysToYmd(today, -1), timeZone };
  }

  private requireAllowedDate(
    date: string,
    today: string,
    yesterday: string,
  ): string {
    if (!isValidYmd(date)) {
      throw new BadRequestException('date must be a valid YYYY-MM-DD');
    }
    if (date !== today && date !== yesterday) {
      throw new BadRequestException(
        'Check-ins are only allowed for today or yesterday',
      );
    }
    return date;
  }

  private requireName(name: string): string {
    const trimmed = name?.trim() ?? '';
    if (!trimmed) {
      throw new BadRequestException('name is required');
    }
    if (trimmed.length > 80) {
      throw new BadRequestException('name must be at most 80 characters');
    }
    return trimmed;
  }

  private normalizeColor(color?: string): string {
    const value = color?.trim() || DEFAULT_COLOR;
    if (!HEX_COLOR.test(value)) {
      throw new BadRequestException('color must be a hex value like #22c55e');
    }
    return value.toLowerCase();
  }

  private normalizeDescription(description?: string | null): string | null {
    if (description == null) return null;
    const trimmed = description.trim();
    if (trimmed.length > 500) {
      throw new BadRequestException(
        'description must be at most 500 characters',
      );
    }
    return trimmed || null;
  }
}
