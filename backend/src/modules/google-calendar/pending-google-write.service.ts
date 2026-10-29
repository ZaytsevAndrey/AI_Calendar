import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { resolveIanaTimeZone } from '../../common/iana-time-zone';
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
import { excludeStartsForSkippedYmds } from '../tasks/skipped-occurrence.util';
import { buildGoogleRecurrenceRules } from '../schedule/google-recurrence.util';
import { effectiveRecurrenceWeekDays } from '../schedule/recurrence-from-phases.util';
import { pickMajorityClockSlot } from '../schedule/series-group.util';
import { ScheduledTask } from '../schedule/schedule.entity';
import { localHm, localYmd } from '../voice/voice-local-date.util';
import { UserSettings } from '../user-settings/entities/user-settings.entity';

@Injectable()
export class PendingGoogleWriteService {
  private readonly logger = new Logger(PendingGoogleWriteService.name);
  /** Serialize syncs per task so two createEvent calls cannot race. */
  private readonly inflight = new Map<string, Promise<void>>();

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
    // Keep completed on the calendar (styled in the app). Canceled drops the event.
    if (task.status === 'canceled') {
      return false;
    }
    return true;
  }

  /** Series with no open seats should only drop Google after it has ended. */
  private recurringSeriesEnded(task: Task): boolean {
    if (!task.scheduledStartTime || !task.scheduledEndTime) return true;
    if (task.deadline && new Date(task.deadline).getTime() <= Date.now()) {
      return true;
    }
    return false;
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
   * Kick Google sync without blocking the HTTP/placement caller.
   * Failures still enqueue retries inside `syncTask`.
   */
  syncTaskSoon(userId: string, taskId: string): void {
    void this.syncTask(userId, taskId).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Background Google sync failed for task ${taskId}: ${message}`,
      );
    });
  }

  /**
   * Drop queued upserts for a task that is being removed so the retry worker
   * cannot recreate its Google event after local delete.
   */
  async discardPendingUpserts(userId: string, taskId: string): Promise<void> {
    const rows = await this.pendingRepo.find({
      where: { userId, taskId, operation: 'upsert' },
      take: 50,
    });
    if (rows.length) await this.pendingRepo.remove(rows);
  }

  /** Wait until any in-flight `syncTask` for this id finishes. */
  async waitForInflight(userId: string, taskId: string): Promise<void> {
    const key = `${userId}:${taskId}`;
    const run = this.inflight.get(key);
    if (!run) return;
    await run.catch(() => undefined);
  }

  /**
   * Try to write the task to Google now; on failure enqueue a retry.
   * No open seat → delete any linked Google event (and enqueue delete on failure).
   * Concurrent calls for the same task wait and reload so only one createEvent runs.
   */
  async syncTask(userId: string, taskId: string): Promise<void> {
    const key = `${userId}:${taskId}`;
    const previous = this.inflight.get(key) ?? Promise.resolve();
    const run = previous
      .catch(() => undefined)
      .then(() => this.syncTaskUnlocked(userId, taskId));
    this.inflight.set(key, run);
    try {
      await run;
    } finally {
      if (this.inflight.get(key) === run) this.inflight.delete(key);
    }
  }

  private async syncTaskUnlocked(userId: string, taskId: string): Promise<void> {
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

    const calendarId = task.googleEventCalendarId ?? 'primary';
    const syncOpts = { skipSleepWindowCheck: true as const, calendarId };
    try {
      if (task.isRecurring) {
        await this.writeRecurringSeries(userId, task, calendarId);
        return;
      }
      const payload = await this.buildPayload(task);
      if (task.googleEventId) {
        await this.google.updateEvent(
          userId,
          task.googleEventId,
          payload,
          syncOpts,
        );
        if (!(await this.taskStillExists(userId, taskId))) {
          await this.deleteGoogleEventQuietly(
            userId,
            task.googleEventId,
            calendarId,
          );
          return;
        }
        await this.stampOpenSlotGoogle(task);
      } else {
        const ev = await this.google.createEvent(userId, payload, syncOpts);
        await this.attachCreatedGoogleEvent(userId, task, ev, calendarId);
      }
    } catch (err) {
      if (!(await this.taskStillExists(userId, taskId))) return;
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
    // Fewest attempts first: rows that keep failing (revoked access) must not
    // fill every batch and starve everyone else's writes.
    const rows = await this.pendingRepo.find({
      order: { attempts: 'ASC', enqueuedAt: 'ASC' },
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
    if (!task) {
      // Task was deleted while this upsert was queued — drop any stale Google id.
      if (row.googleEventId) {
        await this.deleteGoogleEventQuietly(
          row.userId,
          row.googleEventId,
          row.googleCalendarId ?? 'primary',
        );
      }
      return;
    }
    if (!this.canSyncTask(task)) {
      await this.deleteTaskGoogle(row.userId, task);
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
        if (task.isRecurring) {
          await this.writeRecurringSeries(row.userId, task, calendarId);
          return;
        }
        await this.google.updateEvent(
          row.userId,
          eventId,
          await this.buildPayload(task),
          { skipSleepWindowCheck: true, calendarId },
        );
        await this.stampOpenSlotGoogle(task);
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

    if (task.isRecurring) {
      await this.writeRecurringSeries(row.userId, task, calendarId);
      return;
    }
    const ev = await this.google.createEvent(
      row.userId,
      await this.buildPayload(task),
      {
        skipSleepWindowCheck: true,
        calendarId,
      },
    );
    await this.attachCreatedGoogleEvent(row.userId, task, ev, calendarId);
  }

  private async taskStillExists(
    userId: string,
    taskId: string,
  ): Promise<boolean> {
    const row = await this.taskRepo.findOne({
      where: { id: taskId, userId },
      select: ['id'],
    });
    return !!row;
  }

  /**
   * Persist a newly created Google event only if the local task still exists.
   * Otherwise delete the orphan so a racing task-delete cannot resurrect it.
   */
  private async attachCreatedGoogleEvent(
    userId: string,
    task: Task,
    ev: { id?: string; appCalendarId?: string } | null | undefined,
    calendarId: string,
  ): Promise<void> {
    if (typeof ev?.id !== 'string') return;
    if (!(await this.taskStillExists(userId, task.id))) {
      await this.deleteGoogleEventQuietly(userId, ev.id, calendarId);
      return;
    }
    task.googleEventId = ev.id;
    if (ev.appCalendarId) task.googleEventCalendarId = ev.appCalendarId;
    await this.taskRepo.save(task);
    await this.stampOpenSlotGoogle(task);
  }

  private async deleteGoogleEventQuietly(
    userId: string,
    eventId: string,
    calendarId: string,
  ): Promise<void> {
    try {
      await this.google.deleteEvent(userId, eventId, calendarId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/404|not found|Gone/i.test(message)) return;
      await this.enqueue(userId, 'delete', {
        googleEventId: eventId,
        googleCalendarId: calendarId,
        error: message,
      });
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
    if (!task.googleEventId) return;
    const now = Date.now();
    const rows = await this.scheduledRepo.find({ where: { taskId: task.id } });
    const open = rows.filter(
      (row) => new Date(row.scheduledEndTime).getTime() > now,
    );
    if (!task.isRecurring) {
      if (open.length !== 1) return;
      open[0].googleEventId = task.googleEventId;
      open[0].googleEventCalendarId = task.googleEventCalendarId;
      await this.scheduledRepo.save(open[0]);
      return;
    }
    for (const row of open) {
      row.googleEventId = task.googleEventId;
      row.googleEventCalendarId = task.googleEventCalendarId;
      await this.scheduledRepo.save(row);
    }
  }

  /**
   * Extend the Google series that already exists: keep its DTSTART and move
   * only RRULE UNTIL to the last open day. A new event is created only when
   * this segment has never been written. An earlier segment with no open days
   * is capped in place so its past instances stay.
   */
  private async writeRecurringSeries(
    userId: string,
    task: Task,
    calendarId: string,
  ): Promise<void> {
    const syncOpts = { skipSleepWindowCheck: true as const, calendarId };
    const open = await this.openSlots(task.id);
    const all = await this.allSlots(task.id);
    if (!open.length) {
      const past = all.filter(
        (row) => new Date(row.scheduledEndTime).getTime() <= Date.now(),
      );
      if (past.length && task.googleEventId) {
        await this.google.capRecurringSeriesUntil(
          userId,
          task.googleEventId,
          new Date(past[past.length - 1].scheduledStartTime),
          calendarId,
        );
        return;
      }
      // No seats yet during a move: keep the event. Delete only a finished series.
      if (this.recurringSeriesEnded(task)) {
        await this.deleteTaskGoogle(userId, task);
      }
      return;
    }

    const timeZone = resolveIanaTimeZone(task.scheduleTimeZone);
    const preferredHm = task.scheduledStartTime
      ? localHm(new Date(task.scheduledStartTime).toISOString(), timeZone)
      : null;
    const openAnchor =
      pickMajorityClockSlot(open, timeZone, preferredHm) ?? open[0];
    const openStart = new Date(openAnchor.scheduledStartTime);
    const openEnd = new Date(openAnchor.scheduledEndTime);
    const duration = Math.max(60_000, openEnd.getTime() - openStart.getTime());
    const openHm = localHm(openStart.toISOString(), timeZone);
    const sameClock = all.filter(
      (row) =>
        localHm(new Date(row.scheduledStartTime).toISOString(), timeZone) ===
        openHm,
    );
    const earliest =
      pickMajorityClockSlot(sameClock, timeZone, preferredHm) ?? openAnchor;
    let start = new Date(earliest.scheduledStartTime);
    let end = new Date(start.getTime() + duration);
    if (task.googleEventId) {
      const remoteStart = await this.remoteSeriesStart(
        userId,
        task.googleEventId,
        calendarId,
      );
      if (remoteStart) {
        start = remoteStart;
        end = new Date(remoteStart.getTime() + duration);
      }
    }

    const payload = this.seriesPayload(task, start, end, open, all, timeZone);
    if (task.googleEventId) {
      await this.google.updateEvent(
        userId,
        task.googleEventId,
        payload,
        syncOpts,
      );
      if (!(await this.taskStillExists(userId, task.id))) {
        await this.deleteGoogleEventQuietly(
          userId,
          task.googleEventId,
          calendarId,
        );
        return;
      }
      await this.stampOpenSlotGoogle(task);
      return;
    }
    const ev = await this.google.createEvent(userId, payload, syncOpts);
    await this.attachCreatedGoogleEvent(userId, task, ev, calendarId);
  }

  private seriesPayload(
    task: Task,
    start: Date,
    end: Date,
    open: ScheduledTask[],
    all: ScheduledTask[],
    timeZone: string,
  ): Record<string, unknown> {
    const phase = task.phases?.[0] ?? task.phase;
    const fallbackColorId = phaseHexToGoogleColorId(phase?.color);
    const payload: Record<string, unknown> = {
      summary: task.name,
      description: task.description || undefined,
      start: { dateTime: start.toISOString(), timeZone },
      end: { dateTime: end.toISOString(), timeZone },
    };
    applyTaskGoogleEventFields(payload, task, fallbackColorId);
    const last = open[open.length - 1];
    const phases = [
      ...(task.phases ?? []),
      ...(task.phase ? [task.phase] : []),
    ];
    payload.recurrence = buildGoogleRecurrenceRules({
      pattern: task.recurrencePattern,
      timeZone,
      anchorStart: task.earliestStartTime,
      firstStart: start,
      lastStart: new Date(last.scheduledStartTime),
      weekDays: effectiveRecurrenceWeekDays(task.recurrenceWeekDays, phases),
      excludeStarts: excludeStartsForSkippedYmds({
        skippedYmds: task.skippedOccurrenceYmds,
        firstStart: start,
        lastStart: new Date(last.scheduledStartTime),
        timeZone,
        placedYmds: all.map((row) =>
          localYmd(new Date(row.scheduledStartTime).toISOString(), timeZone),
        ),
      }),
    });
    return payload;
  }

  private async remoteSeriesStart(
    userId: string,
    eventId: string,
    calendarId: string,
  ): Promise<Date | null> {
    try {
      const ev = (await this.google.getEvent(userId, eventId, calendarId)) as {
        start?: { dateTime?: string | null };
      } | null;
      const iso = ev?.start?.dateTime;
      if (typeof iso !== 'string') return null;
      const ms = Date.parse(iso);
      return Number.isFinite(ms) ? new Date(ms) : null;
    } catch {
      return null;
    }
  }

  private async buildPayload(task: Task): Promise<Record<string, unknown>> {
    const phase = task.phases?.[0] ?? task.phase;
    const fallbackColorId = phaseHexToGoogleColorId(phase?.color);
    const timeZone = resolveIanaTimeZone(task.scheduleTimeZone);
    const open = await this.openSlots(task.id);
    const preferredHm = task.scheduledStartTime
      ? localHm(new Date(task.scheduledStartTime).toISOString(), timeZone)
      : null;
    const anchor =
      task.isRecurring && open.length
        ? pickMajorityClockSlot(open, timeZone, preferredHm)
        : open[0] ?? null;
    const start =
      anchor?.scheduledStartTime ?? task.scheduledStartTime ?? null;
    const end = anchor?.scheduledEndTime ?? task.scheduledEndTime ?? null;
    if (
      task.scheduledStartTime &&
      task.scheduledEndTime &&
      start &&
      end &&
      (Math.abs(new Date(start).getTime() - new Date(task.scheduledStartTime).getTime()) >
        1000 ||
        Math.abs(new Date(end).getTime() - new Date(task.scheduledEndTime).getTime()) >
          1000)
    ) {
      this.logger.warn(
        `Google sync for "${task.name}" publishes slot ${new Date(start).toISOString()}–${new Date(end).toISOString()} instead of task ${new Date(task.scheduledStartTime).toISOString()}–${new Date(task.scheduledEndTime).toISOString()}`,
      );
    }
    const payload: Record<string, unknown> = {
      summary: task.name,
      description: task.description || undefined,
      start: {
        dateTime: start?.toISOString(),
        timeZone,
      },
      end: {
        dateTime: end?.toISOString(),
        timeZone,
      },
    };
    applyTaskGoogleEventFields(payload, task, fallbackColorId);
    if (task.isRecurring && open.length) {
      const first = anchor ?? open[0];
      const last = open[open.length - 1];
      const phases = [
        ...(task.phases ?? []),
        ...(task.phase ? [task.phase] : []),
      ];
      payload.recurrence = buildGoogleRecurrenceRules({
        pattern: task.recurrencePattern,
        timeZone,
        anchorStart: task.earliestStartTime,
        firstStart: first.scheduledStartTime,
        lastStart: last.scheduledStartTime,
        weekDays: effectiveRecurrenceWeekDays(task.recurrenceWeekDays, phases),
        excludeStarts: excludeStartsForSkippedYmds({
          skippedYmds: task.skippedOccurrenceYmds,
          firstStart: open[0].scheduledStartTime,
          lastStart: last.scheduledStartTime,
          timeZone,
          placedYmds: open.map((row) =>
            localYmd(row.scheduledStartTime.toISOString(), timeZone),
          ),
        }),
      });
    }
    return payload;
  }

  private async allSlots(taskId: string): Promise<ScheduledTask[]> {
    const rows = await this.scheduledRepo.find({ where: { taskId } });
    return [...rows].sort(
      (a, b) =>
        new Date(a.scheduledStartTime).getTime() -
        new Date(b.scheduledStartTime).getTime(),
    );
  }

  private async openSlots(taskId: string): Promise<ScheduledTask[]> {
    const now = Date.now();
    const rows = await this.allSlots(taskId);
    return rows.filter((row) => new Date(row.scheduledEndTime).getTime() > now);
  }
}
