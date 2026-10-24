import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { resolveIanaTimeZone } from '../../common/iana-time-zone';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service';
import { UserSettings } from '../user-settings/entities/user-settings.entity';
import { WriteDayReminderDto } from './dto/write-day-reminder.dto';
import { DayReminder } from './entities/day-reminder.entity';
import {
  DAY_REMINDER_PATTERNS,
  dayOfMonth,
  isYmd,
  nextDueYmd,
  normalizeHm,
  notificationWindow,
  type DayReminderPattern,
} from './day-reminder.dates';

const DEFAULT_NOTIFICATION_TIME = '09:00';

@Injectable()
export class DayRemindersService {
  private readonly logger = new Logger(DayRemindersService.name);

  constructor(
    @InjectRepository(DayReminder)
    private readonly reminders: Repository<DayReminder>,
    @InjectRepository(UserSettings)
    private readonly settings: Repository<UserSettings>,
    private readonly google: GoogleCalendarService,
  ) {}

  async findAll(userId: string): Promise<DayReminder[]> {
    const rows = await this.reminders.find({
      where: { userId, status: 'open' },
      order: { dueYmd: 'ASC', createdAt: 'ASC' },
    });
    const kept: DayReminder[] = [];
    for (const row of rows) {
      const removed = await this.removeIfGoogleEventGone(userId, row);
      if (!removed) kept.push(row);
    }
    return kept;
  }

  async create(userId: string, dto: WriteDayReminderDto): Promise<DayReminder> {
    const row = this.reminders.create({
      userId,
      status: 'open',
      googleEventId: null,
      googleEventCalendarId: null,
      ...this.fieldsFromDto(dto),
    });
    const saved = await this.reminders.save(row);
    await this.syncGoogle(userId, saved);
    return saved;
  }

  async update(
    userId: string,
    id: string,
    dto: WriteDayReminderDto,
  ): Promise<DayReminder> {
    const row = await this.findOpen(userId, id);
    Object.assign(row, this.fieldsFromDto(dto));
    const saved = await this.reminders.save(row);
    await this.syncGoogle(userId, saved);
    return saved;
  }

  /**
   * Close the open occurrence. A one-off is completed. A repeat moves to the
   * next day and the same Google event is retargeted.
   */
  async resolve(userId: string, id: string): Promise<DayReminder> {
    const row = await this.findOpen(userId, id);
    if (!row.recurrencePattern) {
      row.status = 'completed';
      await this.deleteGoogleQuietly(userId, row);
      row.googleEventId = null;
      row.googleEventCalendarId = null;
      return this.reminders.save(row);
    }
    row.dueYmd = nextDueYmd({
      dueYmd: row.dueYmd,
      pattern: row.recurrencePattern,
      weekDays: row.recurrenceWeekDays,
      monthDay: row.recurrenceMonthDay,
    });
    const saved = await this.reminders.save(row);
    await this.syncGoogle(userId, saved);
    return saved;
  }

  async remove(userId: string, id: string): Promise<void> {
    const row = await this.reminders.findOne({ where: { id, userId } });
    if (!row) throw new NotFoundException('Reminder not found');
    await this.deleteGoogleQuietly(userId, row);
    await this.reminders.remove(row);
  }

  /** Move Google events that still follow the settings clock. */
  async retargetDefaultTime(userId: string, hm: string): Promise<void> {
    const clock = normalizeHm(hm);
    if (!clock) return;
    const rows = await this.reminders.find({
      where: { userId, status: 'open', notificationTime: IsNull() },
    });
    for (const row of rows) {
      await this.syncGoogle(userId, row, clock);
    }
  }

  private async findOpen(userId: string, id: string): Promise<DayReminder> {
    const row = await this.reminders.findOne({
      where: { id, userId, status: 'open' },
    });
    if (!row) throw new NotFoundException('Reminder not found');
    return row;
  }

  private fieldsFromDto(dto: WriteDayReminderDto): Partial<DayReminder> {
    const name = dto.name?.trim() ?? '';
    if (!name) throw new BadRequestException('Name is required');
    if (!isYmd(dto.dueYmd)) throw new BadRequestException('dueYmd must be a real date');
    const pattern = (dto.recurrencePattern ?? null) as DayReminderPattern | null;
    if (pattern && !DAY_REMINDER_PATTERNS.includes(pattern)) {
      throw new BadRequestException('recurrencePattern is invalid');
    }
    const notificationTime =
      dto.notificationTime == null || dto.notificationTime === ''
        ? null
        : normalizeHm(dto.notificationTime);
    if (dto.notificationTime && !notificationTime) {
      throw new BadRequestException('notificationTime must be HH:mm');
    }
    const weekDays =
      pattern === 'WEEKLY'
        ? [...new Set((dto.recurrenceWeekDays ?? []).filter((day) => day >= 0 && day <= 6))]
        : null;
    return {
      name,
      description: dto.description?.trim() ? dto.description.trim() : null,
      dueYmd: dto.dueYmd,
      notificationTime,
      recurrencePattern: pattern,
      recurrenceWeekDays: weekDays && weekDays.length > 0 ? weekDays : null,
      recurrenceMonthDay: pattern === 'MONTHLY' ? dayOfMonth(dto.dueYmd) : null,
    };
  }

  private async timeZoneOf(userId: string): Promise<string> {
    const settings = await this.settings.findOne({ where: { userId } });
    return resolveIanaTimeZone(settings?.timeZone || 'UTC');
  }

  private async defaultClock(userId: string): Promise<string> {
    const settings = await this.settings.findOne({ where: { userId } });
    return normalizeHm(settings?.defaultReminderTime || '') || DEFAULT_NOTIFICATION_TIME;
  }

  private async syncGoogle(
    userId: string,
    row: DayReminder,
    clockOverride?: string,
  ): Promise<void> {
    if (row.status !== 'open') return;
    const timeZone = await this.timeZoneOf(userId);
    const clock =
      clockOverride ||
      row.notificationTime ||
      (await this.defaultClock(userId));
    const window = notificationWindow(row.dueYmd, clock);
    const body: Record<string, unknown> = {
      summary: row.name,
      description: row.description ?? '',
      start: { dateTime: window.startDateTime, timeZone },
      end: { dateTime: window.endDateTime, timeZone },
      transparency: 'transparent',
      reminders: {
        useDefault: false,
        overrides: [{ method: 'popup', minutes: 0 }],
      },
    };
    try {
      if (row.googleEventId) {
        await this.google.updateEvent(userId, row.googleEventId, body, {
          skipSleepWindowCheck: true,
          calendarId: row.googleEventCalendarId ?? undefined,
        });
        return;
      }
      const created = await this.google.createEvent(userId, body, {
        skipSleepWindowCheck: true,
      });
      if (typeof created.id === 'string') {
        row.googleEventId = created.id;
        row.googleEventCalendarId =
          typeof created.appCalendarId === 'string' ? created.appCalendarId : null;
        await this.reminders.save(row);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isGoogleGone(message) && row.googleEventId) {
        row.googleEventId = null;
        row.googleEventCalendarId = null;
        await this.reminders.save(row);
        await this.syncGoogle(userId, row, clock);
        return;
      }
      this.logger.warn(`Day reminder Google sync skipped: ${message}`);
    }
  }

  /** A deleted or cancelled Google event removes the reminder. It is not recreated. */
  private async removeIfGoogleEventGone(
    userId: string,
    row: DayReminder,
  ): Promise<boolean> {
    if (!row.googleEventId) return false;
    try {
      const remote = await this.google.getEvent(
        userId,
        row.googleEventId,
        row.googleEventCalendarId ?? undefined,
      );
      if (remote?.status === 'cancelled') {
        await this.reminders.remove(row);
        return true;
      }
      return false;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!isGoogleGone(message)) return false;
      await this.reminders.remove(row);
      return true;
    }
  }

  private async deleteGoogleQuietly(userId: string, row: DayReminder): Promise<void> {
    if (!row.googleEventId) return;
    try {
      await this.google.deleteEvent(
        userId,
        row.googleEventId,
        row.googleEventCalendarId ?? undefined,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isGoogleGone(message)) return;
      this.logger.warn(`Day reminder Google delete skipped: ${message}`);
    }
  }
}

function isGoogleGone(message: string): boolean {
  return /404|not found|gone|cancelled|canceled|resource has been deleted/i.test(message);
}
