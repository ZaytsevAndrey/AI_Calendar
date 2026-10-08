import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { phaseHexToGoogleColorId } from './phase-hex-to-google-color-id.util';
import { applyTaskGoogleEventFields } from './task-google-event-fields.util';
import { GoogleCalendarService } from './google-calendar.service';
import {
  PendingGoogleWrite,
  type PendingGoogleWriteOperation,
} from './entities/pending-google-write.entity';
import {
  googleContentDiffers,
  googleEditedAfterEnqueue,
  googleEventFieldsFromApi,
} from './pending-google-write.util';
import { isProblematicSchedule, Task } from '../tasks/entities/task.entity';
import { ScheduledTask } from '../schedule/schedule.entity';
import { UserSettings } from '../user-settings/entities/user-settings.entity';

@Injectable()
export class PendingGoogleWriteService {
  private readonly logger = new Logger(PendingGoogleWriteService.name);

  constructor(
    @InjectRepository(PendingGoogleWrite)
    private readonly pendingRepo: Repository<PendingGoogleWrite>,
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    @InjectRepository(ScheduledTask)
    private readonly scheduledRepo: Repository<ScheduledTask>,
    @InjectRepository(UserSettings)
    private readonly settingsRepo: Repository<UserSettings>,
    private readonly google: GoogleCalendarService,
  ) {}

  /** True when this task should have a Google event for its seated interval. */
  canSyncTask(task: Task): boolean {
    if (task.isUnscheduled || isProblematicSchedule(task)) return false;
    if (!task.scheduledStartTime || !task.scheduledEndTime) return false;
    if (
      task.status === 'completed' ||
      task.status === 'canceled'
    ) {
      return false;
    }
    return true;
  }

  async enqueue(
    userId: string,
    operation: PendingGoogleWriteOperation,
    opts: {
      taskId?: string | null;
      googleEventId?: string | null;
      googleCalendarId?: string | null;
      error?: string | null;
    },
  ): Promise<void> {
    const candidates = await this.pendingRepo.find({
      where: { userId, operation },
      take: 50,
    });
    const existing = candidates.find((row) => {
      if (opts.taskId) return row.taskId === opts.taskId;
      return (
        !!opts.googleEventId && row.googleEventId === opts.googleEventId
      );
    });
    if (existing) {
      existing.attempts = (existing.attempts ?? 0) + 1;
      existing.lastError = opts.error ?? existing.lastError;
      existing.googleEventId = opts.googleEventId ?? existing.googleEventId;
      existing.googleCalendarId =
        opts.googleCalendarId ?? existing.googleCalendarId;
      await this.pendingRepo.save(existing);
      return;
    }
    await this.pendingRepo.save(
      this.pendingRepo.create({
        userId,
        operation,
        taskId: opts.taskId ?? null,
        googleEventId: opts.googleEventId ?? null,
        googleCalendarId: opts.googleCalendarId ?? null,
        attempts: 0,
        lastError: opts.error ?? null,
      }),
    );
  }

  /**
   * Try to write the task to Google now; on failure enqueue a retry.
   * No open seat → delete any linked Google event (and enqueue delete on failure).
   */
  async syncTask(userId: string, taskId: string): Promise<void> {
    const task = await this.taskRepo.findOne({
      where: { id: taskId, userId },
      relations: ['phase', 'phases'],
    });
    if (!task) return;

    if (!this.canSyncTask(task)) {
      await this.deleteTaskGoogle(userId, task);
      return;
    }

    const conn = await this.google.checkConnection(userId);
    if (!conn.connected) return;

    const payload = this.buildPayload(task);
    const calendarId = task.googleEventCalendarId ?? 'primary';
    const syncOpts = { skipSleepWindowCheck: true as const, calendarId };
    try {
      if (task.googleEventId) {
        await this.google.updateEvent(
          userId,
          task.googleEventId,
          payload,
          syncOpts,
        );
      } else {
        const ev = await this.google.createEvent(userId, payload, syncOpts);
        if (typeof ev?.id === 'string') {
          task.googleEventId = ev.id;
          const appCal = (ev as { appCalendarId?: string }).appCalendarId;
          if (appCal) task.googleEventCalendarId = appCal;
          await this.taskRepo.save(task);
          await this.stampOpenSlotGoogle(task);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Google sync failed for task ${taskId}: ${message}`);
      await this.enqueue(userId, 'upsert', {
        taskId,
        googleEventId: task.googleEventId,
        googleCalendarId: task.googleEventCalendarId,
        error: message,
      });
    }
  }

  async processQueue(limit = 20): Promise<number> {
    const rows = await this.pendingRepo.find({
      order: { enqueuedAt: 'ASC' },
      take: limit,
    });
    let done = 0;
    for (const row of rows) {
      try {
        if (row.operation === 'delete') {
          await this.processDelete(row);
        } else {
          await this.processUpsert(row);
        }
        await this.pendingRepo.remove(row);
        done += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        row.attempts = (row.attempts ?? 0) + 1;
        row.lastError = message;
        await this.pendingRepo.save(row);
        this.logger.warn(
          `Pending Google ${row.operation} ${row.id} failed again: ${message}`,
        );
      }
    }
    return done;
  }

  private async processUpsert(row: PendingGoogleWrite): Promise<void> {
    if (!row.taskId) {
      return;
    }
    const task = await this.taskRepo.findOne({
      where: { id: row.taskId, userId: row.userId },
      relations: ['phase', 'phases'],
    });
    if (!task || !this.canSyncTask(task)) {
      if (task) await this.deleteTaskGoogle(row.userId, task);
      return;
    }

    const calendarId =
      row.googleCalendarId || task.googleEventCalendarId || 'primary';
    const local = {
      summary: task.name,
      description: task.description ?? '',
      startIso: task.scheduledStartTime?.toISOString() ?? null,
      endIso: task.scheduledEndTime?.toISOString() ?? null,
    };

    if (task.googleEventId || row.googleEventId) {
      const eventId = task.googleEventId || row.googleEventId!;
      try {
        const remote = await this.google.getEvent(
          row.userId,
          eventId,
          calendarId,
        );
        const fields = googleEventFieldsFromApi(remote);
        if (
          googleContentDiffers(local, fields) &&
          googleEditedAfterEnqueue(fields.updatedIso, row.enqueuedAt)
        ) {
          await this.pullGoogleOntoTask(task, fields);
          return;
        }
        await this.google.updateEvent(
          row.userId,
          eventId,
          this.buildPayload(task),
          { skipSleepWindowCheck: true, calendarId },
        );
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/404|not found|Failed to fetch event/i.test(message)) {
          await this.handleMissingGoogleEvent(row.userId, task, eventId);
          return;
        }
        throw err;
      }
    }

    const ev = await this.google.createEvent(row.userId, this.buildPayload(task), {
      skipSleepWindowCheck: true,
      calendarId,
    });
    if (typeof ev?.id === 'string') {
      task.googleEventId = ev.id;
      const appCal = (ev as { appCalendarId?: string }).appCalendarId;
      if (appCal) task.googleEventCalendarId = appCal;
      await this.taskRepo.save(task);
      await this.stampOpenSlotGoogle(task);
    }
  }

  private async processDelete(row: PendingGoogleWrite): Promise<void> {
    if (!row.googleEventId) return;
    try {
      await this.google.deleteEvent(
        row.userId,
        row.googleEventId,
        row.googleCalendarId ?? undefined,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/404|not found|Gone/i.test(message)) return;
      throw err;
    }
  }

  private async handleMissingGoogleEvent(
    userId: string,
    task: Task,
    eventId: string,
  ): Promise<void> {
    const settings = await this.settingsRepo.findOne({ where: { userId } });
    if (settings?.syncGoogleDeletions) {
      await this.scheduledRepo.delete({ taskId: task.id });
      await this.taskRepo.remove(task);
      return;
    }
    if (task.googleEventId === eventId) {
      task.googleEventId = null;
      task.googleEventCalendarId = null;
      await this.taskRepo.save(task);
    }
  }

  private async pullGoogleOntoTask(
    task: Task,
    fields: ReturnType<typeof googleEventFieldsFromApi>,
  ): Promise<void> {
    if (fields.summary) task.name = fields.summary;
    if (fields.description !== undefined) {
      task.description = fields.description ?? '';
    }
    if (fields.startIso) task.scheduledStartTime = new Date(fields.startIso);
    if (fields.endIso) task.scheduledEndTime = new Date(fields.endIso);
    await this.taskRepo.save(task);
    const now = Date.now();
    const rows = await this.scheduledRepo.find({ where: { taskId: task.id } });
    const open = rows.filter(
      (row) => new Date(row.scheduledEndTime).getTime() > now,
    );
    if (open.length === 1 && task.scheduledStartTime && task.scheduledEndTime) {
      open[0].scheduledStartTime = task.scheduledStartTime;
      open[0].scheduledEndTime = task.scheduledEndTime;
      await this.scheduledRepo.save(open[0]);
    }
  }

  private async deleteTaskGoogle(userId: string, task: Task): Promise<void> {
    const rows = await this.scheduledRepo.find({ where: { taskId: task.id } });
    const ids = new Set<string>();
    if (task.googleEventId) ids.add(task.googleEventId);
    for (const row of rows) {
      if (row.googleEventId) ids.add(row.googleEventId);
    }
    const calendarId = task.googleEventCalendarId ?? 'primary';
    for (const eventId of ids) {
      try {
        await this.google.deleteEvent(userId, eventId, calendarId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/404|not found|Gone/i.test(message)) continue;
        await this.enqueue(userId, 'delete', {
          taskId: task.id,
          googleEventId: eventId,
          googleCalendarId: calendarId,
          error: message,
        });
      }
    }
    if (task.googleEventId || task.googleEventCalendarId) {
      task.googleEventId = null;
      task.googleEventCalendarId = null;
      await this.taskRepo.save(task);
    }
    for (const row of rows) {
      if (row.googleEventId) {
        row.googleEventId = null;
        row.googleEventCalendarId = null;
        await this.scheduledRepo.save(row);
      }
    }
  }

  private async stampOpenSlotGoogle(task: Task): Promise<void> {
    if (!task.googleEventId || task.isRecurring) return;
    const now = Date.now();
    const rows = await this.scheduledRepo.find({ where: { taskId: task.id } });
    const open = rows.filter(
      (row) => new Date(row.scheduledEndTime).getTime() > now,
    );
    if (open.length !== 1) return;
    open[0].googleEventId = task.googleEventId;
    open[0].googleEventCalendarId = task.googleEventCalendarId;
    await this.scheduledRepo.save(open[0]);
  }

  private buildPayload(task: Task): Record<string, unknown> {
    const phase = task.phases?.[0] ?? task.phase;
    const fallbackColorId = phaseHexToGoogleColorId(phase?.color);
    const payload: Record<string, unknown> = {
      summary: task.name,
      description: task.description || undefined,
      start: {
        dateTime: task.scheduledStartTime?.toISOString(),
        timeZone: task.scheduleTimeZone || 'UTC',
      },
      end: {
        dateTime: task.scheduledEndTime?.toISOString(),
        timeZone: task.scheduleTimeZone || 'UTC',
      },
    };
    return applyTaskGoogleEventFields(payload, task, fallbackColorId);
  }
}
