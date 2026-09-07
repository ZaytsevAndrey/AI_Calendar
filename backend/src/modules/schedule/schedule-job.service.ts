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
  planGoogleMasterEventSync,
  planGoogleSegmentSync,
  uniqueGoogleEventRefs,
} from './google-segment-sync.util';

/** Drives Google Calendar payload for non-FIXED tasks (before vs after user edit / replan). */
export type FlexibleGoogleSyncSnapshot = {
  name: string;
  description: string | null;
  isRecurring: boolean;
  recurrencePattern: string | null;
  recurrenceWeekDays: number[] | null;
  phaseIdsSorted: string[];
  segments: { start: string; end: string }[];
};

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

  private async runPendingJob(job: ScheduleJob): Promise<void> {
    job.status = 'running';
    await this.jobRepo.save(job);

    try {
      const snapshotRows = await this.engine.captureAutoSegmentsSnapshot(
        job.userId,
      );

      const result = await this.engine.run(job.userId);
      await this.syncGoogleAfterReplan(job.userId, snapshotRows);

      job.status = 'done';
      job.resultDiffJson = JSON.stringify({
        diff: result.diff,
        warnings: result.warnings,
        errors: result.errors,
      });
      job.errorMessage = null;
      await this.jobRepo.save(job);
    } catch (e: any) {
      job.status = 'failed';
      job.errorMessage = e?.message ?? String(e);
      await this.jobRepo.save(job);
    }
  }

  private flexibleGoogleSnapshotFingerprint(s: FlexibleGoogleSyncSnapshot): string {
    return JSON.stringify({
      name: s.name,
      description: s.description ?? '',
      isRecurring: s.isRecurring,
      recurrencePattern: s.recurrencePattern ?? '',
      recurrenceWeekDays: s.recurrenceWeekDays ?? [],
      phaseIds: s.phaseIdsSorted,
      segments: s.segments.map((x) => [x.start, x.end]),
    });
  }

  /**
   * Captures DB state used for Google Calendar for one non-FIXED task (metadata + auto segments).
   */
  async captureFlexibleGoogleSnapshotForTask(
    userId: string,
    taskId: string,
  ): Promise<FlexibleGoogleSyncSnapshot | null> {
    const task = await this.taskRepo.findOne({
      where: { id: taskId, userId },
      relations: ['phases'],
    });
    if (!task || task.eventType === TaskEventType.FIXED) return null;

    const rows = await this.scheduledRepo.find({
      where: { taskId, isAutoGenerated: true },
      order: { scheduledStartTime: 'ASC' },
    });

    const phaseIdsSorted = (task.phases?.map((p) => p.id) ?? []).slice().sort();

    return {
      name: task.name,
      description: task.description ?? null,
      isRecurring: task.isRecurring,
      recurrencePattern: task.recurrencePattern ?? null,
      recurrenceWeekDays: task.recurrenceWeekDays ?? null,
      phaseIdsSorted,
      segments: rows.map((r) => ({
        start: r.scheduledStartTime.toISOString(),
        end: r.scheduledEndTime.toISOString(),
      })),
    };
  }

  /**
   * After PATCH + optional replan: sync Google if calendar-relevant state changed vs pre-edit snapshot
   * (e.g. title/description changed while segment times stayed the same and replan produced an empty diff).
   */
  async syncFlexibleTaskAfterUserEditIfNeeded(
    userId: string,
    taskId: string,
    previous: FlexibleGoogleSyncSnapshot | null,
  ): Promise<void> {
    if (!previous) return;
    const current = await this.captureFlexibleGoogleSnapshotForTask(userId, taskId);
    if (!current) return;
    if (
      this.flexibleGoogleSnapshotFingerprint(previous) ===
      this.flexibleGoogleSnapshotFingerprint(current)
    ) {
      return;
    }

    const conn = await this.googleCalendarService.checkConnection(userId);
    if (!conn.connected) {
      this.logger.warn(
        `Google Calendar not connected for user ${userId}; skipped post-edit Google sync for task ${taskId}.`,
      );
      return;
    }

    await this.syncNonFixedTaskGoogleFromAfterSegments(userId, taskId);
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
   * Recurring tasks: one Google series (RRULE). Other flexible tasks: one event per segment.
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

    if (task.isRecurring) {
      await this.reconcileRecurringGoogleMaster(
        userId,
        task,
        desired,
        existingRefs,
      );
      return;
    }

    const plan = planGoogleSegmentSync(desired.length, existingRefs);

    for (const ref of plan.deleteRefs) {
      await this.deleteGoogleRef(userId, ref, task.id);
    }

    const assigned: GoogleEventRef[] = [];
    let reuseIdx = 0;
    for (const seg of desired) {
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

    const first = assigned[0];
    task.googleEventId = first?.eventId ?? null;
    task.googleEventCalendarId = first?.calendarId ?? null;
    await this.taskRepo.save(task);
  }

  private async reconcileRecurringGoogleMaster(
    userId: string,
    task: Task,
    desired: ScheduledTask[],
    existingRefs: GoogleEventRef[],
  ): Promise<void> {
    const plan = planGoogleMasterEventSync(desired.length, existingRefs);
    for (const ref of plan.deleteRefs) {
      await this.deleteGoogleRef(userId, ref, task.id);
    }

    if (!desired.length) {
      task.googleEventId = null;
      task.googleEventCalendarId = null;
      await this.taskRepo.save(task);
      return;
    }

    const first = desired[0];
    const last = desired[desired.length - 1];
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
      if (plan.reuse.length) {
        const ref = plan.reuse[0];
        await this.googleCalendarService.updateEvent(
          userId,
          ref.eventId,
          payload,
          { skipSleepWindowCheck: true, calendarId: ref.calendarId },
        );
        master = ref;
      } else {
        const ev = await this.googleCalendarService.createEvent(userId, payload, {
          skipSleepWindowCheck: true,
        });
        if (typeof ev?.id !== 'string') return;
        master = {
          eventId: ev.id,
          calendarId:
            (ev as { appCalendarId?: string }).appCalendarId ??
            this.fallbackCalendarId(task),
        };
      }

      for (const seg of desired) {
        seg.googleEventId = master.eventId;
        seg.googleEventCalendarId = master.calendarId;
        await this.scheduledRepo.save(seg);
      }
      task.googleEventId = master.eventId;
      task.googleEventCalendarId = master.calendarId;
      await this.taskRepo.save(task);
    } catch (e: any) {
      this.logger.warn(
        `Google recurring sync skipped for task ${task.id}: ${e?.message ?? e}`,
      );
    }
  }

  /**
   * Create/update/delete Google events for a non-FIXED task from current auto segments.
   */
  private async syncNonFixedTaskGoogleFromAfterSegments(
    userId: string,
    taskId: string,
  ): Promise<void> {
    const task = await this.taskRepo.findOne({
      where: { id: taskId, userId },
      relations: ['phase', 'phases'],
    });
    if (!task) return;
    if (task.eventType === TaskEventType.FIXED) return;

    const rows = await this.scheduledRepo.find({
      where: { taskId, isAutoGenerated: true },
      order: { scheduledStartTime: 'ASC' },
    });

    await this.reconcileGoogleEventsForTask(
      userId,
      task,
      rows,
      this.refsFromScheduledRows(task, rows),
    );
  }

  /**
   * After replan, rewrite Google events to match every auto segment (not the diff only:
   * the engine recreates rows and would otherwise drop stored event ids).
   */
  private async syncGoogleAfterReplan(
    userId: string,
    snapshotRows: SegmentSnapshot[],
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

    for (const task of tasks) {
      if (task.eventType === TaskEventType.FIXED) continue;
      if (task.status !== TaskStatus.TODO) continue;
      const after = afterByTask.get(task.id) ?? [];
      const snap = snapByTask.get(task.id) ?? [];
      if (!after.length && !snap.length && !task.googleEventId) continue;
      await this.reconcileGoogleEventsForTask(
        userId,
        task,
        after,
        this.refsFromSnapshotAndTask(task, snap),
      );
    }
  }

  /**
   * Delete every event on the app calendar in [start, end).
   * Clear cannot rely on scheduled_tasks alone — leftover Google events
   * remain after a previous DB-only clear.
   */
  async wipeAppCalendarEventsInRange(
    userId: string,
    start: Date,
    end: Date,
  ): Promise<number> {
    const conn = await this.googleCalendarService.checkConnection(userId);
    if (!conn.connected) {
      this.logger.warn(
        `Google Calendar not connected for user ${userId}; skipped app-calendar clear.`,
      );
      return 0;
    }

    const ids = new Set<string>();
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
        ids.add(ev.recurringEventId || ev.id);
      }
      pageToken = page.nextPageToken ?? undefined;
    } while (pageToken);

    let deleted = 0;
    for (const eventId of ids) {
      try {
        await this.googleCalendarService.deleteEvent(userId, eventId);
        deleted += 1;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.warn(`Clear Google event ${eventId}: ${msg}`);
      }
    }

    if (ids.size > 0) {
      await this.taskRepo
        .createQueryBuilder()
        .update(Task)
        .set({ googleEventId: null, googleEventCalendarId: null })
        .where('userId = :userId', { userId })
        .andWhere('googleEventId IN (:...ids)', { ids: [...ids] })
        .execute();
    }

    this.logger.log(
      `Cleared ${deleted} app-calendar event(s) for user ${userId} from ${start.toISOString()} to ${end.toISOString()}.`,
    );
    return deleted;
  }
}
