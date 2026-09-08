import {
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ScheduleJob } from './entities/schedule-job.entity';
import { IntelligentSchedulingEngine, SegmentSnapshot } from './intelligent-scheduling.engine';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service';
import { Task, TaskStatus } from '../tasks/entities/task.entity';
import { TaskEventType } from '../scheduling/event-type.enum';
import { ScheduledTask } from './schedule.entity';
import { phaseHexToGoogleColorId } from '../google-calendar/phase-hex-to-google-color-id.util';
import { effectiveRecurrenceWeekDays } from './recurrence-from-phases.util';
import { buildGoogleRecurrenceRules } from './google-recurrence.util';
import {
  GoogleEventRef,
  partitionEnded,
  planGoogleMasterEventSync,
  planGoogleSegmentSync,
  uniqueGoogleEventRefs,
} from './google-segment-sync.util';

function googleListedEventEndMs(ev: {
  end?: { dateTime?: string | null; date?: string | null };
}): number | null {
  if (ev.end?.dateTime) {
    const t = new Date(ev.end.dateTime).getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (ev.end?.date) {
    const t = Date.parse(`${ev.end.date}T00:00:00.000Z`);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

@Injectable()
export class ScheduleJobService {
  private readonly logger = new Logger(ScheduleJobService.name);

  constructor(
    @InjectRepository(ScheduleJob)
    private readonly jobRepo: Repository<ScheduleJob>,
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    @InjectRepository(ScheduledTask)
    private readonly scheduledRepo: Repository<ScheduledTask>,
    private readonly engine: IntelligentSchedulingEngine,
    private readonly googleCalendarService: GoogleCalendarService,
  ) {}

  async enqueueReplan(userId: string): Promise<ScheduleJob> {
    const job = this.jobRepo.create({
      userId,
      status: 'pending',
      payloadJson: JSON.stringify({ type: 'full_replan', at: new Date().toISOString() }),
    });
    return this.jobRepo.save(job);
  }

  async getJob(jobId: string, userId: string): Promise<ScheduleJob> {
    const job = await this.jobRepo.findOne({ where: { id: jobId } });
    if (!job || job.userId !== userId) {
      throw new NotFoundException('Job not found');
    }
    return job;
  }

  async getLatestDoneJob(userId: string): Promise<ScheduleJob | null> {
    return this.jobRepo.findOne({
      where: { userId, status: 'done' },
      order: { updatedAt: 'DESC' },
    });
  }

  /**
   * Process one pending job (oldest first). Safe to call concurrently only with DB locking in production.
   */
  async processNextPending(): Promise<boolean> {
    const pending = await this.jobRepo.find({
      where: { status: 'pending' },
      order: { createdAt: 'ASC' },
      take: 1,
    });
    const job = pending[0];
    if (!job) return false;
    await this.runPendingJob(job);
    return true;
  }

  /**
   * Process this user's oldest pending replan job (so calendar sync runs right after task changes).
   */
  async processNextPendingForUser(userId: string): Promise<boolean> {
    const pending = await this.jobRepo.find({
      where: { status: 'pending', userId },
      order: { createdAt: 'ASC' },
      take: 1,
    });
    const job = pending[0];
    if (!job) return false;
    await this.runPendingJob(job);
    return true;
  }

  private async setJobProgress(
    job: ScheduleJob,
    stage: string,
    current?: number | null,
    total?: number | null,
  ): Promise<void> {
    job.progressStage = stage;
    job.progressCurrent = current ?? null;
    job.progressTotal = total ?? null;
    await this.jobRepo.save(job);
  }

  private async runPendingJob(job: ScheduleJob): Promise<void> {
    job.status = 'running';
    job.progressStage = 'preparing';
    job.progressCurrent = null;
    job.progressTotal = null;
    await this.jobRepo.save(job);

    try {
      const snapshotRows = await this.engine.captureAutoSegmentsSnapshot(
        job.userId,
      );

      await this.setJobProgress(job, 'computing');
      const result = await this.engine.run(job.userId);

      await this.setJobProgress(job, 'syncing_google');
      await this.syncGoogleAfterReplan(
        job.userId,
        snapshotRows,
        async (current, total) => {
          await this.setJobProgress(job, 'syncing_google', current, total);
        },
      );

      job.status = 'done';
      job.progressStage = 'done';
      job.resultDiffJson = JSON.stringify({
        diff: result.diff,
        warnings: result.warnings,
        errors: result.errors,
      });
      job.errorMessage = null;
      await this.jobRepo.save(job);
    } catch (e: any) {
      job.status = 'failed';
      job.progressStage = 'failed';
      job.errorMessage = e?.message ?? String(e);
      await this.jobRepo.save(job);
    }
  }

  private fallbackCalendarId(task: Task, appCal?: string | null): string {
    return task.googleEventCalendarId ?? appCal ?? 'primary';
  }

  private buildFlexibleSegmentPayload(
    task: Task,
    start: Date,
    end: Date,
  ): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      summary: task.name,
      description: task.description || undefined,
      start: {
        dateTime: start.toISOString(),
        timeZone: task.scheduleTimeZone || 'UTC',
      },
      end: {
        dateTime: end.toISOString(),
        timeZone: task.scheduleTimeZone || 'UTC',
      },
    };
    const phaseForColor =
      task.phases?.length && task.phases[0] ? task.phases[0] : task.phase;
    const colorId = phaseHexToGoogleColorId(phaseForColor?.color);
    if (colorId) {
      payload.colorId = colorId;
    }
    return payload;
  }

  private refsFromSnapshotAndTask(
    task: Task,
    snapshot: SegmentSnapshot[],
  ): GoogleEventRef[] {
    return uniqueGoogleEventRefs([
      ...snapshot.map((s) =>
        s.googleEventId
          ? {
              eventId: s.googleEventId,
              calendarId:
                s.googleEventCalendarId ?? this.fallbackCalendarId(task),
            }
          : null,
      ),
      task.googleEventId
        ? {
            eventId: task.googleEventId,
            calendarId: this.fallbackCalendarId(task),
          }
        : null,
    ]);
  }

  private refsFromScheduledRows(
    task: Task,
    rows: ScheduledTask[],
    appCal?: string | null,
  ): GoogleEventRef[] {
    return uniqueGoogleEventRefs([
      ...rows.map((r) =>
        r.googleEventId
          ? {
              eventId: r.googleEventId,
              calendarId:
                r.googleEventCalendarId ?? this.fallbackCalendarId(task, appCal),
            }
          : null,
      ),
      task.googleEventId
        ? {
            eventId: task.googleEventId,
            calendarId: this.fallbackCalendarId(task, appCal),
          }
        : null,
    ]);
  }

  private async deleteGoogleRef(
    userId: string,
    ref: GoogleEventRef,
    taskId: string,
  ): Promise<void> {
    try {
      await this.googleCalendarService.deleteEvent(
        userId,
        ref.eventId,
        ref.calendarId,
      );
    } catch (e: any) {
      this.logger.warn(
        `Google delete skipped for task ${taskId} event ${ref.eventId}: ${e?.message ?? e}`,
      );
    }
  }

  /**
   * Delete every Google event stored on the task or its scheduled segments.
   */
  async deleteSyncedGoogleEventsForTask(userId: string, task: Task): Promise<void> {
    const rows = await this.scheduledRepo.find({ where: { taskId: task.id } });
    for (const ref of this.refsFromScheduledRows(task, rows)) {
      await this.deleteGoogleRef(userId, ref, task.id);
    }
  }

  /**
   * Recurring tasks: keep a capped historical series for ended occurrences,
   * plus a new series for still-open slots. Other flexible tasks: one event per segment.
   */
  private async reconcileGoogleEventsForTask(
    userId: string,
    task: Task,
    desiredRows: ScheduledTask[],
    existingRefs: GoogleEventRef[],
  ): Promise<void> {
    if (task.eventType === TaskEventType.FIXED) return;

    const desired = [...desiredRows].sort(
      (a, b) =>
        a.scheduledStartTime.getTime() - b.scheduledStartTime.getTime(),
    );
    const nowMs = Date.now();
    const { ended: pastDesired, open: futureDesired } = partitionEnded(
      desired,
      (s) => s.scheduledEndTime,
      nowMs,
    );

    if (task.isRecurring) {
      await this.reconcileRecurringGoogleMaster(
        userId,
        task,
        pastDesired,
        futureDesired,
        existingRefs,
      );
      return;
    }

    const pastIds = new Set(
      pastDesired
        .map((s) => s.googleEventId)
        .filter((id): id is string => Boolean(id)),
    );
    const futureRefs = existingRefs.filter((r) => !pastIds.has(r.eventId));
    const plan = planGoogleSegmentSync(futureDesired.length, futureRefs);

    for (const ref of plan.deleteRefs) {
      if (pastIds.has(ref.eventId)) continue;
      await this.deleteGoogleRef(userId, ref, task.id);
    }

    const assigned: GoogleEventRef[] = [];
    let reuseIdx = 0;
    for (const seg of futureDesired) {
      const payload = this.buildFlexibleSegmentPayload(
        task,
        seg.scheduledStartTime,
        seg.scheduledEndTime,
      );
      try {
        if (reuseIdx < plan.reuse.length) {
          const ref = plan.reuse[reuseIdx++];
          await this.googleCalendarService.updateEvent(
            userId,
            ref.eventId,
            { ...payload, recurrence: [] },
            { skipSleepWindowCheck: true, calendarId: ref.calendarId },
          );
          seg.googleEventId = ref.eventId;
          seg.googleEventCalendarId = ref.calendarId;
          assigned.push(ref);
        } else {
          const ev = await this.googleCalendarService.createEvent(userId, payload, {
            skipSleepWindowCheck: true,
          });
          if (typeof ev?.id !== 'string') continue;
          const cal =
            (ev as { appCalendarId?: string }).appCalendarId ??
            this.fallbackCalendarId(task);
          seg.googleEventId = ev.id;
          seg.googleEventCalendarId = cal;
          assigned.push({ eventId: ev.id, calendarId: cal });
        }
        await this.scheduledRepo.save(seg);
      } catch (e: any) {
        this.logger.warn(
          `Google sync skipped for task ${task.id} segment ${seg.id}: ${e?.message ?? e}`,
        );
      }
    }

    const firstFuture = assigned[0];
    const firstPast = pastDesired.find((s) => s.googleEventId);
    task.googleEventId =
      firstFuture?.eventId ?? firstPast?.googleEventId ?? null;
    task.googleEventCalendarId =
      firstFuture?.calendarId ?? firstPast?.googleEventCalendarId ?? null;
    await this.taskRepo.save(task);
  }

  private async capHistoricalSeries(
    userId: string,
    task: Task,
    historical: GoogleEventRef | null,
    pastDesired: ScheduledTask[],
  ): Promise<void> {
    if (!historical || !pastDesired.length) return;
    const lastPast = pastDesired[pastDesired.length - 1];
    try {
      await this.googleCalendarService.capRecurringSeriesUntil(
        userId,
        historical.eventId,
        lastPast.scheduledStartTime,
        historical.calendarId,
      );
    } catch (e: any) {
      this.logger.warn(
        `Google series cap skipped for task ${task.id}: ${e?.message ?? e}`,
      );
    }
    for (const seg of pastDesired) {
      seg.googleEventId = historical.eventId;
      seg.googleEventCalendarId = historical.calendarId;
      await this.scheduledRepo.save(seg);
    }
  }

  private async writeRecurringFutureMaster(
    userId: string,
    task: Task,
    futureDesired: ScheduledTask[],
    reuse: GoogleEventRef | null,
  ): Promise<GoogleEventRef | null> {
    if (!futureDesired.length) return null;
    const first = futureDesired[0];
    const last = futureDesired[futureDesired.length - 1];
    const phases =
      task.phases?.length ? task.phases : task.phase ? [task.phase] : [];
    const payload = {
      ...this.buildFlexibleSegmentPayload(
        task,
        first.scheduledStartTime,
        first.scheduledEndTime,
      ),
      recurrence: buildGoogleRecurrenceRules({
        pattern: task.recurrencePattern,
        firstStart: first.scheduledStartTime,
        lastStart: last.scheduledStartTime,
        weekDays: effectiveRecurrenceWeekDays(task.recurrenceWeekDays, phases),
      }),
    };

    try {
      let master: GoogleEventRef | null = null;
      if (reuse) {
        await this.googleCalendarService.updateEvent(
          userId,
          reuse.eventId,
          payload,
          { skipSleepWindowCheck: true, calendarId: reuse.calendarId },
        );
        master = reuse;
      } else {
        const ev = await this.googleCalendarService.createEvent(userId, payload, {
          skipSleepWindowCheck: true,
        });
        if (typeof ev?.id !== 'string') return null;
        master = {
          eventId: ev.id,
          calendarId:
            (ev as { appCalendarId?: string }).appCalendarId ??
            this.fallbackCalendarId(task),
        };
      }

      for (const seg of futureDesired) {
        seg.googleEventId = master.eventId;
        seg.googleEventCalendarId = master.calendarId;
        await this.scheduledRepo.save(seg);
      }
      return master;
    } catch (e: any) {
      this.logger.warn(
        `Google recurring sync skipped for task ${task.id}: ${e?.message ?? e}`,
      );
      return null;
    }
  }

  private async reconcileRecurringGoogleMaster(
    userId: string,
    task: Task,
    pastDesired: ScheduledTask[],
    futureDesired: ScheduledTask[],
    existingRefs: GoogleEventRef[],
  ): Promise<void> {
    const unique = uniqueGoogleEventRefs(existingRefs);
    const historical = unique[0] ?? null;
    const extras = unique.slice(1);

    const deleteExtras = async (keepId?: string) => {
      for (const ref of extras) {
        if (keepId && ref.eventId === keepId) continue;
        await this.deleteGoogleRef(userId, ref, task.id);
      }
    };

    if (pastDesired.length && futureDesired.length) {
      await this.capHistoricalSeries(userId, task, historical, pastDesired);
      await deleteExtras(historical?.eventId);
      const created = await this.writeRecurringFutureMaster(
        userId,
        task,
        futureDesired,
        null,
      );
      task.googleEventId = created?.eventId ?? historical?.eventId ?? null;
      task.googleEventCalendarId =
        created?.calendarId ?? historical?.calendarId ?? null;
      await this.taskRepo.save(task);
      return;
    }

    if (futureDesired.length) {
      const plan = planGoogleMasterEventSync(futureDesired.length, unique);
      for (const ref of plan.deleteRefs) {
        await this.deleteGoogleRef(userId, ref, task.id);
      }
      const master = await this.writeRecurringFutureMaster(
        userId,
        task,
        futureDesired,
        plan.reuse[0] ?? null,
      );
      task.googleEventId = master?.eventId ?? null;
      task.googleEventCalendarId = master?.calendarId ?? null;
      await this.taskRepo.save(task);
      return;
    }

    if (pastDesired.length) {
      await this.capHistoricalSeries(userId, task, historical, pastDesired);
      await deleteExtras(historical?.eventId);
      task.googleEventId = historical?.eventId ?? null;
      task.googleEventCalendarId = historical?.calendarId ?? null;
      await this.taskRepo.save(task);
      return;
    }

    for (const ref of unique) {
      await this.deleteGoogleRef(userId, ref, task.id);
    }
    task.googleEventId = null;
    task.googleEventCalendarId = null;
    await this.taskRepo.save(task);
  }

  /**
   * After replan, rewrite Google events to match every auto segment (not the diff only:
   * the engine recreates rows and would otherwise drop stored event ids).
   */
  private async syncGoogleAfterReplan(
    userId: string,
    snapshotRows: SegmentSnapshot[],
    onTaskProgress?: (current: number, total: number) => Promise<void>,
  ): Promise<void> {
    const conn = await this.googleCalendarService.checkConnection(userId);
    if (!conn.connected) {
      this.logger.warn(
        `Google Calendar not connected for user ${userId}; skipped post-replan sync.`,
      );
      return;
    }

    const tasks = await this.taskRepo.find({
      where: { userId },
      relations: ['phase', 'phases'],
    });
    const ids = tasks.map((t) => t.id);
    const autoRows = ids.length
      ? await this.scheduledRepo.find({
          where: { taskId: In(ids), isAutoGenerated: true },
          order: { scheduledStartTime: 'ASC' },
        })
      : [];
    const afterByTask = new Map<string, ScheduledTask[]>();
    for (const row of autoRows) {
      const list = afterByTask.get(row.taskId) ?? [];
      list.push(row);
      afterByTask.set(row.taskId, list);
    }
    const snapByTask = new Map<string, SegmentSnapshot[]>();
    for (const row of snapshotRows) {
      const list = snapByTask.get(row.taskId) ?? [];
      list.push(row);
      snapByTask.set(row.taskId, list);
    }

    const toSync = tasks.filter((task) => {
      if (task.eventType === TaskEventType.FIXED) return false;
      if (task.status !== TaskStatus.TODO) return false;
      const after = afterByTask.get(task.id) ?? [];
      const snap = snapByTask.get(task.id) ?? [];
      return after.length > 0 || snap.length > 0 || Boolean(task.googleEventId);
    });

    let index = 0;
    for (const task of toSync) {
      index += 1;
      if (onTaskProgress) {
        await onTaskProgress(index, toSync.length);
      }
      const after = afterByTask.get(task.id) ?? [];
      const snap = snapByTask.get(task.id) ?? [];
      await this.reconcileGoogleEventsForTask(
        userId,
        task,
        after,
        this.refsFromSnapshotAndTask(task, snap),
      );
    }
  }

  /**
   * Delete still-open app-calendar events in [start, end). Ended events stay.
   * Recurring series with kept (ended) instances are capped via RRULE UNTIL
   * instead of deleting the master.
   */
  async wipeAppCalendarEventsInRange(
    userId: string,
    start: Date,
    end: Date,
    opts?: {
      now?: Date;
      keepEventIds?: Set<string>;
      untilByEventId?: Map<string, Date>;
    },
  ): Promise<number> {
    const conn = await this.googleCalendarService.checkConnection(userId);
    if (!conn.connected) {
      this.logger.warn(
        `Google Calendar not connected for user ${userId}; skipped app-calendar clear.`,
      );
      return 0;
    }

    const nowMs = (opts?.now ?? new Date()).getTime();
    const keep = opts?.keepEventIds ?? new Set<string>();
    const untilByEventId = opts?.untilByEventId ?? new Map<string, Date>();

    const seriesToCap = new Set<string>();
    const seriesToDelete = new Set<string>();
    const singlesToDelete = new Set<string>();
    let pageToken: string | undefined;
    do {
      const page = await this.googleCalendarService.getEvents(
        userId,
        start.toISOString(),
        end.toISOString(),
        250,
        pageToken,
      );
      for (const ev of page.events ?? []) {
        if (!ev?.id || ev.status === 'cancelled') continue;
        const endMs = googleListedEventEndMs(ev);
        if (endMs != null && endMs <= nowMs) continue;

        const masterId =
          typeof ev.recurringEventId === 'string' && ev.recurringEventId
            ? ev.recurringEventId
            : null;
        if (masterId) {
          if (keep.has(masterId)) seriesToCap.add(masterId);
          else seriesToDelete.add(masterId);
          continue;
        }
        if (!keep.has(ev.id)) singlesToDelete.add(ev.id);
      }
      pageToken = page.nextPageToken ?? undefined;
    } while (pageToken);

    for (const id of seriesToCap) {
      seriesToDelete.delete(id);
    }

    let deleted = 0;
    for (const eventId of seriesToCap) {
      const until = untilByEventId.get(eventId);
      if (!until) continue;
      try {
        await this.googleCalendarService.capRecurringSeriesUntil(
          userId,
          eventId,
          until,
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.warn(`Cap Google series ${eventId}: ${msg}`);
      }
    }

    const deleteIds = [...seriesToDelete, ...singlesToDelete];
    for (const eventId of deleteIds) {
      try {
        await this.googleCalendarService.deleteEvent(userId, eventId);
        deleted += 1;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.warn(`Clear Google event ${eventId}: ${msg}`);
      }
    }

    if (deleteIds.length > 0) {
      await this.taskRepo
        .createQueryBuilder()
        .update(Task)
        .set({ googleEventId: null, googleEventCalendarId: null })
        .where('userId = :userId', { userId })
        .andWhere('googleEventId IN (:...ids)', { ids: deleteIds })
        .execute();
    }

    this.logger.log(
      `Cleared ${deleted} upcoming app-calendar event(s) for user ${userId} from ${start.toISOString()} to ${end.toISOString()}.`,
    );
    return deleted;
  }
}
