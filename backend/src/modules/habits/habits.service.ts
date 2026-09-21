import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { resolveIanaTimeZone } from '../../common/iana-time-zone';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service';
import { phaseHexToGoogleColorId } from '../google-calendar/phase-hex-to-google-color-id.util';
import { localDateTimeIso, localYmd, normalizeClockHm } from '../voice/voice-local-date.util';
import { UserSettings } from '../user-settings/entities/user-settings.entity';
import { CreateHabitDto } from './dto/create-habit.dto';
import { UpdateHabitDto } from './dto/update-habit.dto';
import { HabitCheckIn } from './entities/habit-check-in.entity';
import { Habit } from './entities/habit.entity';
import {
  CHECK_IN_WINDOW_DAYS,
  checkInEditableFrom,
  computeHabitStats,
  isCheckInDateAllowed,
  isValidYmd,
} from './habit-stats.util';

const DEFAULT_COLOR = '#3b82f6';
const HEX_COLOR = /^#([A-Fa-f0-9]{6})$/;

export type HabitSummary = {
  id: string;
  name: string;
  color: string;
  description: string | null;
  checkedToday: boolean;
  currentStreak: number;
  points: number;
  totalCheckIns: number;
  checkInDates: string[];
  blockStartTime: string | null;
  blockMinutes: number | null;
  googleEventId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type GoogleBlockSnapshot = {
  name: string;
  color: string;
  description: string | null;
  blockStartTime: string | null;
  blockMinutes: number | null;
};

export type HabitsListResponse = {
  today: string;
  editableFrom: string;
  editableTo: string;
  timeZone: string;
  habits: HabitSummary[];
};

@Injectable()
export class HabitsService {
  private readonly logger = new Logger(HabitsService.name);

  constructor(
    @InjectRepository(Habit)
    private readonly habitsRepository: Repository<Habit>,
    @InjectRepository(HabitCheckIn)
    private readonly checkInsRepository: Repository<HabitCheckIn>,
    @InjectRepository(UserSettings)
    private readonly userSettingsRepository: Repository<UserSettings>,
    private readonly googleCalendar: GoogleCalendarService,
  ) {}

  async findAll(userId: string): Promise<HabitsListResponse> {
    const { today, timeZone } = await this.civilToday(userId);
    const habits = await this.habitsRepository.find({
      where: { userId },
      order: { createdAt: 'ASC' },
    });
    await this.backfillMissingGoogleBlocks(userId, habits);
    const summaries = await this.summariesFor(habits, today);
    return {
      today,
      editableFrom: checkInEditableFrom(today),
      editableTo: today,
      timeZone,
      habits: summaries,
    };
  }

  async create(userId: string, dto: CreateHabitDto): Promise<HabitSummary> {
    const block = this.normalizeBlock(dto.blockStartTime, dto.blockMinutes);
    const habit = this.habitsRepository.create({
      userId,
      name: this.requireName(dto.name),
      color: this.normalizeColor(dto.color),
      description: this.normalizeDescription(dto.description),
      blockStartTime: block.blockStartTime,
      blockMinutes: block.blockMinutes,
    });
    const saved = await this.habitsRepository.save(habit);
    const synced = await this.syncGoogleBlock(userId, saved, {
      name: '',
      color: '',
      description: null,
      blockStartTime: null,
      blockMinutes: null,
    });
    return this.summaryFor(synced, userId);
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateHabitDto,
  ): Promise<HabitSummary> {
    const habit = await this.requireHabit(userId, id);
    const previous = this.googleSnapshot(habit);
    if (dto.name !== undefined) habit.name = this.requireName(dto.name);
    if (dto.color !== undefined) habit.color = this.normalizeColor(dto.color);
    if (dto.description !== undefined) {
      habit.description = this.normalizeDescription(dto.description);
    }
    if (dto.blockStartTime !== undefined || dto.blockMinutes !== undefined) {
      const block = this.normalizeBlock(
        dto.blockStartTime !== undefined ? dto.blockStartTime : habit.blockStartTime,
        dto.blockMinutes !== undefined ? dto.blockMinutes : habit.blockMinutes,
      );
      habit.blockStartTime = block.blockStartTime;
      habit.blockMinutes = block.blockMinutes;
    }
    const saved = await this.habitsRepository.save(habit);
    const synced = await this.syncGoogleBlock(userId, saved, previous);
    return this.summaryFor(synced, userId);
  }

  async remove(userId: string, id: string): Promise<void> {
    const habit = await this.requireHabit(userId, id);
    try {
      await this.deleteGoogleBlock(userId, habit);
    } catch (err) {
      if (!this.isGoogleDisconnected(err)) throw err;
      this.logger.warn(
        `Habit ${habit.id} was deleted locally; its Google event was left in place: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
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
    const { today } = await this.civilToday(userId);
    const localDate = this.requireAllowedDate(date, today);

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

    const [summary] = await this.summariesFor([habit], today);
    return summary;
  }

  private async summaryFor(habit: Habit, userId: string): Promise<HabitSummary> {
    const { today } = await this.civilToday(userId);
    const [summary] = await this.summariesFor([habit], today);
    return summary;
  }

  private async summariesFor(
    habits: Habit[],
    today: string,
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
        currentStreak: stats.currentStreak,
        points: stats.points,
        totalCheckIns: stats.totalCheckIns,
        checkInDates: [...done].filter(isValidYmd).sort(),
        blockStartTime: habit.blockStartTime ?? null,
        blockMinutes: habit.blockMinutes ?? null,
        googleEventId: habit.googleEventId ?? null,
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

  private async civilToday(userId: string): Promise<{
    today: string;
    timeZone: string;
  }> {
    const settings = await this.userSettingsRepository.findOne({
      where: { userId },
    });
    const timeZone = resolveIanaTimeZone(settings?.timeZone);
    const today = localYmd(new Date().toISOString(), timeZone);
    return { today, timeZone };
  }

  private requireAllowedDate(date: string, today: string): string {
    if (!isValidYmd(date)) {
      throw new BadRequestException('date must be a valid YYYY-MM-DD');
    }
    if (!isCheckInDateAllowed(date, today)) {
      throw new BadRequestException(
        `Check-ins are only allowed for the last ${CHECK_IN_WINDOW_DAYS} days, through today`,
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

  private normalizeBlock(
    start: string | null | undefined,
    minutes: number | null | undefined,
  ): { blockStartTime: string | null; blockMinutes: number | null } {
    const startEmpty = start == null || String(start).trim() === '';
    const minutesEmpty = minutes == null;
    if (startEmpty && minutesEmpty) {
      return { blockStartTime: null, blockMinutes: null };
    }
    if (startEmpty || minutesEmpty) {
      throw new BadRequestException(
        'A time block needs both a start time and a duration',
      );
    }
    const hm = normalizeClockHm(String(start));
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hm)) {
      throw new BadRequestException('blockStartTime must be HH:mm');
    }
    const mins = Number(minutes);
    if (!Number.isInteger(mins) || mins < 5 || mins > 240) {
      throw new BadRequestException('blockMinutes must be an integer from 5 to 240');
    }
    return { blockStartTime: hm, blockMinutes: mins };
  }

  private googleSnapshot(habit: Habit): GoogleBlockSnapshot {
    return {
      name: habit.name,
      color: habit.color,
      description: habit.description ?? null,
      blockStartTime: habit.blockStartTime ?? null,
      blockMinutes: habit.blockMinutes ?? null,
    };
  }

  private googleFacingChanged(previous: GoogleBlockSnapshot, habit: Habit): boolean {
    const next = this.googleSnapshot(habit);
    return (
      previous.name !== next.name ||
      previous.color !== next.color ||
      previous.description !== next.description ||
      previous.blockStartTime !== next.blockStartTime ||
      previous.blockMinutes !== next.blockMinutes
    );
  }

  /** Creates the Google series for blocks saved before Calendar was linked. */
  private async backfillMissingGoogleBlocks(userId: string, habits: Habit[]): Promise<void> {
    const missing = habits.filter(
      (habit) => habit.blockStartTime && habit.blockMinutes && !habit.googleEventId,
    );
    for (const habit of missing) {
      try {
        const synced = await this.syncGoogleBlock(userId, habit, {
          name: '',
          color: '',
          description: null,
          blockStartTime: null,
          blockMinutes: null,
        });
        habit.googleEventId = synced.googleEventId ?? null;
        habit.googleEventCalendarId = synced.googleEventCalendarId ?? null;
      } catch (err) {
        this.logger.warn(
          `Habit ${habit.id} time block was not written to Google Calendar: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  /**
   * Writes the daily block as an open-ended Google series when Calendar is linked.
   * A missing token keeps the local block and skips the write.
   * Clock or duration changes replace the series so the start stays on the chosen time.
   */
  private async syncGoogleBlock(
    userId: string,
    habit: Habit,
    previous: GoogleBlockSnapshot,
  ): Promise<Habit> {
    const settings = await this.userSettingsRepository.findOne({ where: { userId } });
    if (!settings?.googleCalendarLinked) return habit;

    const hasBlock = Boolean(habit.blockStartTime && habit.blockMinutes);
    try {
      if (!hasBlock) {
        if (!habit.googleEventId) return habit;
        await this.deleteGoogleBlock(userId, habit);
        habit.googleEventId = null;
        habit.googleEventCalendarId = null;
        return this.habitsRepository.save(habit);
      }

      if (habit.googleEventId && !this.googleFacingChanged(previous, habit)) {
        return habit;
      }

      if (habit.googleEventId) {
        await this.deleteGoogleBlock(userId, habit);
        habit.googleEventId = null;
        habit.googleEventCalendarId = null;
      }

      const timeZone = resolveIanaTimeZone(settings.timeZone);
      const today = localYmd(new Date().toISOString(), timeZone);
      const created = await this.googleCalendar.createEvent(
        userId,
        this.googleBlockPayload(habit, timeZone, today),
        { skipSleepWindowCheck: true },
      );
      habit.googleEventId = typeof created.id === 'string' ? created.id : null;
      habit.googleEventCalendarId =
        typeof created.appCalendarId === 'string' ? created.appCalendarId : null;
      return this.habitsRepository.save(habit);
    } catch (err) {
      if (this.isGoogleDisconnected(err)) {
        this.logger.warn(
          `Habit ${habit.id} time block was not written to Google Calendar: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return this.habitsRepository.save(habit);
      }
      throw err;
    }
  }

  private googleBlockPayload(
    habit: Habit,
    timeZone: string,
    today: string,
  ): Record<string, unknown> {
    const startIso = localDateTimeIso(today, habit.blockStartTime as string, timeZone);
    const endIso = new Date(
      new Date(startIso).getTime() + (habit.blockMinutes as number) * 60_000,
    ).toISOString();
    const colorId = phaseHexToGoogleColorId(habit.color);
    return {
      summary: habit.name,
      description: habit.description?.trim() || 'Daily habit time block',
      start: { dateTime: startIso, timeZone },
      end: { dateTime: endIso, timeZone },
      recurrence: ['RRULE:FREQ=DAILY'],
      transparency: 'opaque',
      ...(colorId ? { colorId } : {}),
    };
  }

  private async deleteGoogleBlock(userId: string, habit: Habit): Promise<void> {
    if (!habit.googleEventId) return;
    await this.googleCalendar.deleteEvent(
      userId,
      habit.googleEventId,
      habit.googleEventCalendarId ?? undefined,
    );
  }

  private isGoogleDisconnected(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err);
    return /not connected|token expired/i.test(message);
  }
}
