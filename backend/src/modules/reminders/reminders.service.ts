import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, MoreThan, Repository } from 'typeorm';
import { sendNotification, setVapidDetails } from 'web-push';
import { resolveIanaTimeZone } from '../../common/iana-time-zone';
import { HabitCheckIn } from '../habits/entities/habit-check-in.entity';
import { Habit } from '../habits/entities/habit.entity';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service';
import { Task } from '../tasks/entities/task.entity';
import { UserSettings } from '../user-settings/entities/user-settings.entity';
import { localYmd, normalizeClockHm } from '../voice/voice-local-date.util';
import { PushSubscription } from './entities/push-subscription.entity';
import { ReminderDelivery } from './entities/reminder-delivery.entity';
import {
  buildTimedReminderBlocks,
  type ReminderGoogleEvent,
} from './reminder-blocks.util';
import { reminderCronSecretMatches } from './reminder-cron.util';
import {
  REMINDER_LOOKAHEAD_MS,
  selectDueReminders,
  type DueReminder,
} from './reminder-due.util';

const DELIVERY_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const PUSH_TTL_SECONDS = 30 * 60;

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = 'code' in err ? String((err as { code?: unknown }).code) : '';
  if (code === '23505') return true;
  const message = err instanceof Error ? err.message : '';
  return /unique/i.test(message);
}

function pushStatus(err: unknown): number | undefined {
  if (!err || typeof err !== 'object' || !('statusCode' in err)) return undefined;
  const status = (err as { statusCode?: unknown }).statusCode;
  return typeof status === 'number' ? status : undefined;
}

@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);
  private ticking = false;
  private vapidReady = false;
  private warnedMissingVapid = false;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(PushSubscription)
    private readonly subscriptions: Repository<PushSubscription>,
    @InjectRepository(ReminderDelivery)
    private readonly deliveries: Repository<ReminderDelivery>,
    @InjectRepository(UserSettings)
    private readonly settings: Repository<UserSettings>,
    @InjectRepository(Task)
    private readonly tasks: Repository<Task>,
    @InjectRepository(Habit)
    private readonly habits: Repository<Habit>,
    @InjectRepository(HabitCheckIn)
    private readonly checkIns: Repository<HabitCheckIn>,
    private readonly googleCalendar: GoogleCalendarService,
  ) {}

  getVapidPublicKey(): { publicKey: string } {
    const publicKey = this.config.get<string>('VAPID_PUBLIC_KEY')?.trim();
    if (!publicKey || !this.ensureWebPush()) {
      throw new ServiceUnavailableException('Web Push is not configured');
    }
    return { publicKey };
  }

  async saveSubscription(
    userId: string,
    input: { endpoint?: string; p256dh?: string; auth?: string },
  ): Promise<{ ok: true }> {
    const endpoint = input.endpoint?.trim() ?? '';
    const p256dh = input.p256dh?.trim() ?? '';
    const auth = input.auth?.trim() ?? '';
    if (!endpoint.startsWith('https://') || endpoint.length > 2000) {
      throw new BadRequestException('endpoint must be an https URL');
    }
    if (!p256dh || p256dh.length > 255 || !auth || auth.length > 255) {
      throw new BadRequestException('subscription keys are required');
    }

    const existing = await this.subscriptions.findOne({ where: { endpoint } });
    if (existing) {
      existing.userId = userId;
      existing.p256dh = p256dh;
      existing.auth = auth;
      await this.subscriptions.save(existing);
      return { ok: true };
    }

    await this.subscriptions.save(
      this.subscriptions.create({ userId, endpoint, p256dh, auth }),
    );
    return { ok: true };
  }

  async removeSubscription(userId: string, endpoint?: string): Promise<void> {
    const trimmed = endpoint?.trim() ?? '';
    if (!trimmed) throw new BadRequestException('endpoint is required');
    await this.subscriptions.delete({ userId, endpoint: trimmed });
  }

  async tickFromCron(secret: string | undefined): Promise<{ users: number; sent: number }> {
    const expected = this.config.get<string>('REMINDER_CRON_SECRET')?.trim();
    if (!expected) {
      throw new ServiceUnavailableException('Reminder cron is not configured');
    }
    if (!reminderCronSecretMatches(secret, expected)) {
      throw new UnauthorizedException('Invalid reminder cron secret');
    }
    return this.dispatchDue();
  }

  async dispatchDue(now = new Date()): Promise<{ users: number; sent: number }> {
    if (this.ticking) return { users: 0, sent: 0 };
    this.ticking = true;
    try {
      if (!this.ensureWebPush()) {
        if (!this.warnedMissingVapid) {
          this.warnedMissingVapid = true;
          this.logger.warn('Web Push is not configured; reminder tick skipped');
        }
        return { users: 0, sent: 0 };
      }
      return await this.dispatchDueUnlocked(now);
    } finally {
      this.ticking = false;
    }
  }

  private async dispatchDueUnlocked(now: Date): Promise<{ users: number; sent: number }> {
    const nowMs = now.getTime();
    const cutoff = new Date(nowMs - DELIVERY_TTL_MS);
    await this.deliveries.delete({ sentAt: LessThan(cutoff) });

    const enabled = await this.settings.find({ where: { remindersEnabled: true } });
    let users = 0;
    let sent = 0;
    for (const settings of enabled) {
      try {
        const count = await this.dispatchUser(settings, now);
        if (count == null) continue;
        users += 1;
        sent += count;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Reminder dispatch failed for user ${settings.userId}: ${message}`);
      }
    }
    if (sent > 0) {
      this.logger.log(`Sent ${sent} reminder(s) for ${users} user(s)`);
    }
    return { users, sent };
  }

  /** Returns null when the user has no browsers to notify. */
  private async dispatchUser(settings: UserSettings, now: Date): Promise<number | null> {
    const subs = await this.subscriptions.find({ where: { userId: settings.userId } });
    if (!subs.length) return null;

    const timeZone = resolveIanaTimeZone(settings.timeZone);
    const todayYmd = localYmd(now.toISOString(), timeZone);
    const nowMs = now.getTime();

    const [habits, checks, tasks, recent] = await Promise.all([
      this.habits.find({ where: { userId: settings.userId } }),
      this.checkIns.find({ where: { userId: settings.userId, localDate: todayYmd } }),
      this.tasks.find({ where: { userId: settings.userId } }),
      this.deliveries.find({
        where: { userId: settings.userId, sentAt: MoreThan(new Date(nowMs - DELIVERY_TTL_MS)) },
      }),
    ]);
    const checked = new Set(checks.map((row) => row.habitId));
    const events = await this.loadDisplayEvents(settings, nowMs);

    const due = selectDueReminders({
      nowMs,
      todayYmd,
      timeZone,
      wakeHm: normalizeClockHm(settings.wakeTime),
      blocks: buildTimedReminderBlocks({
        nowMs,
        events,
        tasks,
      }),
      habits: habits.map((habit) => ({
        id: habit.id,
        name: habit.name,
        blockStartTime: habit.blockStartTime,
        checkedToday: checked.has(habit.id),
      })),
      alreadySent: new Set(recent.map((row) => row.dedupeKey)),
    });

    let sent = 0;
    for (const reminder of due) {
      const claimed = await this.claim(settings.userId, reminder.dedupeKey);
      if (!claimed) continue;
      const ok = await this.deliver(settings.userId, subs, reminder);
      if (!ok) {
        await this.deliveries.delete({ id: claimed });
        continue;
      }
      sent += 1;
    }
    return sent;
  }

  private async loadDisplayEvents(
    settings: UserSettings,
    nowMs: number,
  ): Promise<ReminderGoogleEvent[]> {
    if (!settings.googleCalendarLinked) return [];
    try {
      const page = await this.googleCalendar.getDisplayEvents(
        settings.userId,
        new Date(nowMs).toISOString(),
        new Date(nowMs + REMINDER_LOOKAHEAD_MS).toISOString(),
        50,
      );
      return (page.events ?? []) as ReminderGoogleEvent[];
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Google events skipped for reminders of user ${settings.userId}: ${message}`,
      );
      return [];
    }
  }

  private async claim(userId: string, dedupeKey: string): Promise<string | null> {
    try {
      const saved = await this.deliveries.save(
        this.deliveries.create({ userId, dedupeKey }),
      );
      return saved.id;
    } catch (err) {
      if (isUniqueViolation(err)) return null;
      throw err;
    }
  }

  private async deliver(
    userId: string,
    subs: PushSubscription[],
    reminder: DueReminder,
  ): Promise<boolean> {
    const payload = JSON.stringify({
      title: reminder.title,
      body: reminder.body,
      url: reminder.url,
    });
    let sent = false;
    for (const sub of subs) {
      try {
        await sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          { TTL: PUSH_TTL_SECONDS, urgency: 'high' },
        );
        sent = true;
      } catch (err) {
        const status = pushStatus(err);
        if (status === 404 || status === 410) {
          await this.subscriptions.delete({ id: sub.id });
          continue;
        }
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Push failed for user ${userId}: ${message}`);
      }
    }
    return sent;
  }

  private ensureWebPush(): boolean {
    if (this.vapidReady) return true;
    const publicKey = this.config.get<string>('VAPID_PUBLIC_KEY')?.trim();
    const privateKey = this.config.get<string>('VAPID_PRIVATE_KEY')?.trim();
    if (!publicKey || !privateKey) return false;
    const subject =
      this.config.get<string>('VAPID_SUBJECT')?.trim() || 'mailto:reminders@localhost';
    setVapidDetails(subject, publicKey, privateKey);
    this.vapidReady = true;
    return true;
  }
}
