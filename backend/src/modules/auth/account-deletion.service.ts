import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
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
import { CalendarEventOverlay } from '../calendar-overlays/entities/calendar-event-overlay.entity';
import { VoiceDailyUsage } from '../voice/entities/voice-daily-usage.entity';
import { VoiceTurnLog } from '../admin-data/entities/voice-turn-log.entity';
import { ApiErrorLog } from '../admin-data/entities/api-error-log.entity';
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
        const table = (entity: { new (): unknown }) =>
          manager.getRepository(entity).metadata.tableName;

        await manager.delete(PendingGoogleWrite, { userId });
        await manager.delete(ScheduleJob, { userId });
        await manager.delete(ReminderDelivery, { userId });
        await manager.delete(PushSubscription, { userId });
        await manager.delete(VoiceDailyUsage, { userId });
        await manager.delete(VoiceTurnLog, { userId });
        await manager.delete(ApiErrorLog, { userId });
        await manager.delete(CalendarEventOverlay, { userId });
        await manager.delete(EventPhase, { userId });

        const tasks = table(Task);
        const scheduled = table(ScheduledTask);
        const habits = table(Habit);
        const checkIns = table(HabitCheckIn);
        const phases = table(Phase);
        const settings = table(UserSettings);
        const identities = table(UserIdentity);
        const users = table(User);

        await manager.query(
          `DELETE FROM task_phases WHERE taskId IN (SELECT id FROM ${tasks} WHERE userId = ?)`,
          [userId],
        );
        await manager.query(
          `DELETE FROM ${scheduled} WHERE taskId IN (SELECT id FROM ${tasks} WHERE userId = ?)`,
          [userId],
        );
        await manager.query(
          `UPDATE ${tasks} SET phaseId = NULL WHERE userId = ?`,
          [userId],
        );
        await manager.query(`DELETE FROM ${tasks} WHERE userId = ?`, [userId]);
        await manager.query(`DELETE FROM ${checkIns} WHERE userId = ?`, [
          userId,
        ]);
        await manager.query(`DELETE FROM ${habits} WHERE userId = ?`, [userId]);
        await manager.query(
          `UPDATE ${phases} SET parentPhaseId = NULL WHERE userId = ?`,
          [userId],
        );
        await manager.query(`DELETE FROM ${phases} WHERE userId = ?`, [userId]);
        await manager.query(`DELETE FROM ${settings} WHERE userId = ?`, [
          userId,
        ]);
        await manager.query(`DELETE FROM ${identities} WHERE userId = ?`, [
          userId,
        ]);
        await manager.query(`DELETE FROM ${users} WHERE id = ?`, [userId]);
      });
    } finally {
      if (sqlite) {
        await this.dataSource.query('PRAGMA foreign_keys = ON');
      }
    }
  }
}
