import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { Task } from '../tasks/entities/task.entity';
import { ScheduledTask } from '../schedule/schedule.entity';
import { Habit } from '../habits/entities/habit.entity';
import { HabitCheckIn } from '../habits/entities/habit-check-in.entity';
import { Phase } from '../phases/entities/phase.entity';
import { EventPhase } from '../event-phases/event-phase.entity';
import { UserSettings } from '../user-settings/entities/user-settings.entity';
import { UserIdentity } from './entities/user-identity.entity';
import { PushSubscription } from '../reminders/entities/push-subscription.entity';
import { ReminderDelivery } from '../reminders/entities/reminder-delivery.entity';
import { ScheduleJob } from '../schedule/entities/schedule-job.entity';
import { PendingGoogleWrite } from '../google-calendar/entities/pending-google-write.entity';
import { RequestIdempotency } from '../tasks/entities/request-idempotency.entity';
import { CalendarEventOverlay } from '../calendar-overlays/entities/calendar-event-overlay.entity';
import { VoiceDailyUsage } from '../voice/entities/voice-daily-usage.entity';
import { DayReminder } from '../day-reminders/entities/day-reminder.entity';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service';
import { uniqueGoogleEventRefs } from '../schedule/google-segment-sync.util';
import { ApiError } from '../common/types/errors';

@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @InjectRepository(Task)
    private readonly tasksRepo: Repository<Task>,
    @InjectRepository(ScheduledTask)
    private readonly scheduledRepo: Repository<ScheduledTask>,
    @InjectRepository(Habit)
    private readonly habitsRepo: Repository<Habit>,
    private readonly google: GoogleCalendarService,
    private readonly dataSource: DataSource,
  ) {}

  async getProfile(userId: string): Promise<{ email: string }> {
    const user = await this.usersRepo.findOne({
      where: { id: userId },
      select: { id: true, email: true },
    });
    if (!user) {
      throw new ApiError('EMAIL_NOT_FOUND');
    }
    return { email: user.email };
  }

  /**
   * Remove Google artifacts first (fail closed), then wipe local rows + user.
   * Confirmation must be the account email (case-insensitive) or exact `DELETE`.
   */
  async deleteAccount(userId: string, confirmation: string): Promise<void> {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new ApiError('EMAIL_NOT_FOUND');
    }
    this.assertConfirmation(user.email, confirmation);

    try {
      await this.purgeGoogleArtifacts(user);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Account delete blocked: Google cleanup failed (${msg})`);
      throw new ApiError('ACCOUNT_DELETE_CALENDAR_FAILED', {
        detail: msg,
      });
    }

    await this.wipeLocalData(userId);
    this.logger.log(`Deleted account ${userId}`);
  }

  private assertConfirmation(email: string, raw: string): void {
    const confirmation = (raw ?? '').trim();
    if (!confirmation) {
      throw new ApiError('ACCOUNT_DELETE_CONFIRMATION_INVALID');
    }
    if (confirmation === 'DELETE') return;
    if (confirmation.toLowerCase() === email.trim().toLowerCase()) return;
    throw new ApiError('ACCOUNT_DELETE_CONFIRMATION_INVALID');
  }

  private async purgeGoogleArtifacts(user: User): Promise<void> {
    if (!user.googleAccessToken && !user.googleRefreshToken) {
      return;
    }

    const refs = await this.collectGoogleEventRefs(user.id);
    for (const ref of refs) {
      await this.google.deleteEvent(user.id, ref.eventId, ref.calendarId);
    }
    await this.google.deleteAppCalendar(user.id);
  }

  private async collectGoogleEventRefs(
    userId: string,
  ): Promise<Array<{ eventId: string; calendarId: string }>> {
    const tasks = await this.tasksRepo.find({
      where: { userId },
      select: {
        id: true,
        googleEventId: true,
        googleEventCalendarId: true,
      },
    });
    const taskIds = tasks.map((t) => t.id);
    const slots =
      taskIds.length === 0
        ? []
        : await this.scheduledRepo
            .createQueryBuilder('s')
            .select(['s.googleEventId', 's.googleEventCalendarId'])
            .where('s.taskId IN (:...taskIds)', { taskIds })
            .getMany();
    const reminders = await this.dataSource.getRepository(DayReminder).find({
      where: { userId },
      select: { googleEventId: true, googleEventCalendarId: true },
    });
    const habits = await this.habitsRepo.find({
      where: { userId },
      select: {
        googleEventId: true,
        googleEventCalendarId: true,
      },
    });

    return uniqueGoogleEventRefs([
      ...tasks.map((t) =>
        t.googleEventId
          ? {
              eventId: t.googleEventId,
              calendarId: t.googleEventCalendarId || 'primary',
            }
          : null,
      ),
      ...slots.map((s) =>
        s.googleEventId
          ? {
              eventId: s.googleEventId,
              calendarId: s.googleEventCalendarId || 'primary',
            }
          : null,
      ),
      ...reminders.map((r) =>
        r.googleEventId
          ? { eventId: r.googleEventId, calendarId: r.googleEventCalendarId || 'primary' }
          : null,
      ),
      ...habits.map((h) =>
        h.googleEventId
          ? {
              eventId: h.googleEventId,
              calendarId: h.googleEventCalendarId || 'primary',
            }
          : null,
      ),
    ]);
  }

  private async wipeLocalData(userId: string): Promise<void> {
    const driver = this.dataSource.options.type;
    const sqlite = driver === 'sqlite' || driver === 'better-sqlite3';
    // SQLite e2e schemas can leave relation FKs that block ordered deletes;
    // turn checks off for the wipe connection only.
    if (sqlite) {
      await this.dataSource.query('PRAGMA foreign_keys = OFF');
    }
    try {
      await this.dataSource.transaction(async (manager) => {
        await manager.delete(PendingGoogleWrite, { userId });
        await manager.delete(RequestIdempotency, { userId });
        await manager.delete(ScheduleJob, { userId });
        await manager.delete(ReminderDelivery, { userId });
        await manager.delete(PushSubscription, { userId });
        await manager.delete(VoiceDailyUsage, { userId });
        await manager.delete(CalendarEventOverlay, { userId });
        await manager.delete(EventPhase, { userId });

        // Portable TypeORM deletes (the raw SQL here used SQLite-only `?` and
        // unquoted camelCase names, so it failed on Postgres — AUD-004).
        await manager.delete(DayReminder, { userId });
        const taskIds = (await manager.find(Task, { select: { id: true }, where: { userId } })).map(
          (task) => task.id,
        );
        const junction = manager.getRepository(Task).metadata.manyToManyRelations.find(
          (relation) => relation.propertyName === 'phases',
        )?.junctionEntityMetadata;
        for (let i = 0; i < taskIds.length; i += 500) {
          const ids = taskIds.slice(i, i + 500);
          if (junction) {
            const qb = manager.createQueryBuilder();
            await qb
              .delete()
              .from(junction.target)
              .where(`${qb.escape(junction.ownerColumns[0].databaseName)} IN (:...ids)`, { ids })
              .execute();
          }
          await manager.delete(ScheduledTask, { taskId: In(ids) });
        }
        await manager.update(Task, { userId }, { phaseId: null });
        await manager.delete(Task, { userId });
        await manager.delete(HabitCheckIn, { userId });
        await manager.delete(Habit, { userId });
        await manager.update(Phase, { userId }, { parentPhaseId: null });
        await manager.delete(Phase, { userId });
        await manager.delete(UserSettings, { userId });
        await manager.delete(UserIdentity, { userId });
        await manager.delete(User, { id: userId });
      });
    } finally {
      if (sqlite) {
        await this.dataSource.query('PRAGMA foreign_keys = ON');
      }
    }
  }
}
