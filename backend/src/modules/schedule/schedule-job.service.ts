import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ScheduleJob } from './entities/schedule-job.entity';
import { ScheduleUndoSnapshot } from './entities/schedule-undo-snapshot.entity';
import { IntelligentSchedulingEngine } from './intelligent-scheduling.engine';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service';
import { Task } from '../tasks/entities/task.entity';
import { TaskEventType } from '../scheduling/event-type.enum';
import { ScheduledTask } from './schedule.entity';
import {
  effectiveRecurrenceWeekDaysFromPhases,
  rruleByDayFromJsWeekdays,
} from './recurrence-from-phases.util';

/** Drives Google Calendar payload for non-FIXED tasks (before vs after user edit / replan). */
export type FlexibleGoogleSyncSnapshot = {
  name: string;
  description: string | null;
  isRecurring: boolean;
  recurrencePattern: string | null;
  phaseIdsSorted: string[];
  segments: { start: string; end: string }[];
};

@Injectable()
export class ScheduleJobService {
  private readonly logger = new Logger(ScheduleJobService.name);

  constructor(
    @InjectRepository(ScheduleJob)
    private readonly jobRepo: Repository<ScheduleJob>,
    @InjectRepository(ScheduleUndoSnapshot)
    private readonly snapshotRepo: Repository<ScheduleUndoSnapshot>,
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
      const snap = this.snapshotRepo.create({
        userId: job.userId,
        jobId: job.id,
        payloadJson: JSON.stringify({ segments: snapshotRows }),
      });
      const savedSnap = await this.snapshotRepo.save(snap);

      const result = await this.engine.run(job.userId);
      await this.syncGoogleAfterReplan(job.userId, result.diff);

      job.status = 'done';
      job.resultDiffJson = JSON.stringify({
        diff: result.diff,
        warnings: result.warnings,
        errors: result.errors,
      });
      job.errorMessage = null;
      job.undoSnapshotId = savedSnap.id;
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

    const googleSyncOpts = { skipSleepWindowCheck: true } as const;
    await this.syncNonFixedTaskGoogleFromAfterSegments(
      userId,
      taskId,
      current.segments,
      googleSyncOpts,
    );
  }

  private toGoogleFreq(pattern?: string | null): 'DAILY' | 'WEEKLY' | 'MONTHLY' | null {
    const p = (pattern ?? '').toUpperCase();
    if (p === 'DAILY') return 'DAILY';
    if (p === 'WEEKLY') return 'WEEKLY';
    if (p === 'BIWEEKLY') return 'WEEKLY';
    if (p === 'MONTHLY') return 'MONTHLY';
    return null;
  }

  private buildGoogleRecurrenceRule(
    pattern: string,
    untilIso: string,
    restrictToWeekDays: number[] | null,
  ): string {
    const freq = this.toGoogleFreq(pattern);
    if (!freq) return '';
    const interval = pattern.toUpperCase() === 'BIWEEKLY' ? 2 : 1;
    const until = untilIso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const upper = pattern.toUpperCase();
    if (
      upper === 'DAILY' &&
      restrictToWeekDays?.length &&
      restrictToWeekDays.length < 7
    ) {
      const byday = rruleByDayFromJsWeekdays(restrictToWeekDays);
      return `RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=${byday};UNTIL=${until}`;
    }
    return `RRULE:FREQ=${freq};INTERVAL=${interval};UNTIL=${until}`;
  }

  /**
   * Create/update/delete one Google event for a non-FIXED task from current auto segment list.
   */
  private async syncNonFixedTaskGoogleFromAfterSegments(
    userId: string,
    taskId: string,
    afterSegments: { start: string; end: string }[],
    googleSyncOpts: { skipSleepWindowCheck: true },
  ): Promise<void> {
    const task = await this.taskRepo.findOne({
      where: { id: taskId, userId },
      relations: ['phase', 'phases'],
    });
    if (!task) return;
    if (task.eventType === TaskEventType.FIXED) return;

    if (!afterSegments.length) {
      if (task.googleEventId) {
        try {
          await this.googleCalendarService.deleteEvent(userId, task.googleEventId);
          task.googleEventId = null;
          await this.taskRepo.save(task);
        } catch (e: any) {
          this.logger.warn(
            `Google delete skipped for task ${task.id}: ${e?.message ?? e}`,
          );
        }
      }
      return;
    }

    const sortedSegments = [...afterSegments].sort(
      (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
    );
    const firstSegment = sortedSegments[0];
    const firstStart = firstSegment ? new Date(firstSegment.start).getTime() : NaN;
    const lastSegment = sortedSegments[sortedSegments.length - 1];
    const lastEndMs = lastSegment ? new Date(lastSegment.end).getTime() : NaN;
    const totalDurationMs = sortedSegments.reduce((sum, seg) => {
      const s = new Date(seg.start).getTime();
      const e = new Date(seg.end).getTime();
      if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return sum;
      return sum + (e - s);
    }, 0);
    const defaultDurationMs = Math.max(1, task.estimatedTimeInMinutes || 1) * 60 * 1000;
    const durationMs = totalDurationMs > 0 ? totalDurationMs : defaultDurationMs;

    if (!Number.isFinite(firstStart) || durationMs <= 0) {
      return;
    }

    const payload: Record<string, unknown> = {
      summary: task.name,
      description: task.description || undefined,
      start: { dateTime: new Date(firstStart).toISOString(), timeZone: 'UTC' },
      end: { dateTime: new Date(firstStart + durationMs).toISOString(), timeZone: 'UTC' },
    };

    if (task.isRecurring && task.recurrencePattern) {
      const lastEnd = new Date(
        Number.isFinite(lastEndMs) && lastEndMs > firstStart
          ? lastEndMs
          : firstStart + durationMs,
      ).toISOString();
      const phaseList =
        task.phases?.length ? task.phases : task.phase ? [task.phase] : [];
      const restrictDays = effectiveRecurrenceWeekDaysFromPhases(phaseList);
      const rule = this.buildGoogleRecurrenceRule(
        task.recurrencePattern,
        lastEnd,
        restrictDays,
      );
      if (firstSegment) {
        const firstEnd = firstStart + defaultDurationMs;
        payload.start = {
          dateTime: new Date(firstStart).toISOString(),
          timeZone: 'UTC',
        };
        payload.end = {
          dateTime: new Date(firstEnd).toISOString(),
          timeZone: 'UTC',
        };
      }
      if (rule) {
        payload.recurrence = [rule];
      }
    }

    try {
      if (task.googleEventId) {
        await this.googleCalendarService.updateEvent(
          userId,
          task.googleEventId,
          payload,
          googleSyncOpts,
        );
      } else {
        const ev = await this.googleCalendarService.createEvent(
          userId,
          payload,
          googleSyncOpts,
        );
        if (typeof ev?.id === 'string') {
          task.googleEventId = ev.id;
          await this.taskRepo.save(task);
        }
      }
    } catch (e: any) {
      this.logger.warn(
        `Google sync skipped for task ${task.id}: ${e?.message ?? e}`,
      );
    }
  }

  /**
   * Sync Google Calendar after successful replan for all changed tasks.
   * Uses one Google event per task; event span is min(start)-max(end) over task segments.
   */
  private async syncGoogleAfterReplan(
    userId: string,
    diff: {
      taskId: string;
      taskName: string;
      before: { id?: string; start: string; end: string }[];
      after: { id?: string; start: string; end: string }[];
    }[],
  ): Promise<void> {
    if (!diff.length) return;

    const conn = await this.googleCalendarService.checkConnection(userId);
    if (!conn.connected) {
      this.logger.warn(
        `Google Calendar not connected for user ${userId}; skipped post-replan sync.`,
      );
      return;
    }

    const googleSyncOpts = { skipSleepWindowCheck: true } as const;

    for (const item of diff) {
      const afterIso = item.after.map((s) => ({ start: s.start, end: s.end }));
      await this.syncNonFixedTaskGoogleFromAfterSegments(
        userId,
        item.taskId,
        afterIso,
        googleSyncOpts,
      );
    }
  }

  async undoLast(userId: string): Promise<{ restored: boolean }> {
    const job = await this.jobRepo.findOne({
      where: { userId, status: 'done' },
      order: { updatedAt: 'DESC' },
    });
    if (!job?.undoSnapshotId) {
      throw new BadRequestException('Nothing to undo');
    }

    const snap = await this.snapshotRepo.findOne({
      where: { id: job.undoSnapshotId },
    });
    if (!snap || snap.userId !== userId) {
      throw new NotFoundException('Snapshot not found');
    }

    const data = JSON.parse(snap.payloadJson) as {
      segments: {
        id: string;
        taskId: string;
        scheduledStartTime: string;
        scheduledEndTime: string;
      }[];
    };

    await this.engine.restoreSnapshot(userId, data.segments ?? []);

    job.undoSnapshotId = null;
    await this.jobRepo.save(job);

    await this.syncGoogleAfterUndo(userId, data.segments ?? []);

    return { restored: true };
  }

  /**
   * One Google event per task (`googleEventId`): span = min/max of restored auto segments.
   */
  private async syncGoogleAfterUndo(
    userId: string,
    segments: {
      taskId: string;
      scheduledStartTime: string;
      scheduledEndTime: string;
    }[],
  ): Promise<void> {
    if (!segments.length) return;

    const byTask = new Map<
      string,
      { minStart: number; maxEnd: number }
    >();
    for (const s of segments) {
      const a = new Date(s.scheduledStartTime).getTime();
      const b = new Date(s.scheduledEndTime).getTime();
      const cur = byTask.get(s.taskId);
      if (!cur) {
        byTask.set(s.taskId, { minStart: a, maxEnd: b });
      } else {
        cur.minStart = Math.min(cur.minStart, a);
        cur.maxEnd = Math.max(cur.maxEnd, b);
      }
    }

    for (const [taskId, range] of byTask) {
      const task = await this.taskRepo.findOne({
        where: { id: taskId, userId },
        select: ['id', 'googleEventId'],
      });
      if (!task?.googleEventId) continue;

      try {
        await this.googleCalendarService.patchEventDateTime(
          userId,
          task.googleEventId,
          new Date(range.minStart),
          new Date(range.maxEnd),
        );
      } catch (e: any) {
        this.logger.warn(
          `Google Calendar undo sync skipped for task ${taskId}: ${e?.message ?? e}`,
        );
      }
    }
  }
}
