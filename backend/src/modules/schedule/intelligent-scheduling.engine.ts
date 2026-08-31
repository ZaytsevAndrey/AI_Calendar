import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Task, TaskPriority, TaskStatus } from '../tasks/entities/task.entity';
import { UserSettings } from '../user-settings/entities/user-settings.entity';
import { ScheduledTask } from './schedule.entity';
import { Phase } from '../event-phases/entities/phase.entity';
import { UserSettingsService } from '../user-settings/user-settings.service';
import {
  TaskEventType,
  getEventTypeRules,
} from '../scheduling/event-type.enum';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service';
import { effectiveRecurrenceWeekDaysFromPhases } from './recurrence-from-phases.util';

const DEFAULT_HORIZON_DAYS = 30;
const BEYOND_HORIZON_EXTRA_DAYS = 30;
const MIN_HORIZON_DAYS = 1;
const MAX_HORIZON_DAYS = 365;

export type SegmentSnapshot = {
  id: string;
  taskId: string;
  scheduledStartTime: string;
  scheduledEndTime: string;
};

export type DiffItem = {
  taskId: string;
  taskName: string;
  before: { id?: string; start: string; end: string }[];
  after: { id?: string; start: string; end: string }[];
};

export enum SchedulingWarningCode {
  GOOGLE_BUSY_UNAVAILABLE = 'SCHEDULING_GOOGLE_BUSY_UNAVAILABLE',
  OUTSIDE_HORIZON = 'SCHEDULING_HORIZON_EXCEEDED',
  OCCURRENCE_SKIPPED = 'SCHEDULING_OCCURRENCE_SKIPPED',
}

export type SchedulingWarning = {
  code: SchedulingWarningCode;
  taskId?: string;
  taskName?: string;
  meta?: Record<string, unknown>;
  message: string;
};

type MsInterval = { start: number; end: number };

type RecurrencePattern = 'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';

function atDayWithTime(day: Date, timeStr: string): Date {
  const [h, m] = timeStr.split(':').map(Number);
  const d = new Date(day);
  d.setHours(h, m, 0, 0);
  return d;
}

function dayWakeSleep(day: Date, wake: string, sleep: string): MsInterval {
  const s = atDayWithTime(day, wake).getTime();
  let e = atDayWithTime(day, sleep).getTime();
  if (e <= s) e += 24 * 60 * 60 * 1000;
  return { start: s, end: e };
}

function phaseAppliesOnDay(phase: Phase, day: Date): boolean {
  const wd = day.getDay();
  if (!phase.weekDays || phase.weekDays.length === 0) return true;
  return phase.weekDays.includes(wd);
}

function phaseWindowOnDay(
  phase: Phase,
  day: Date,
  ws: MsInterval,
): MsInterval | null {
  if (!phaseAppliesOnDay(phase, day)) return null;
  if (phase.type === 'sleep_time') return null;
  let ps = atDayWithTime(day, phase.startTime).getTime();
  let pe = atDayWithTime(day, phase.endTime).getTime();
  if (pe <= ps) pe += 24 * 60 * 60 * 1000;
  const start = Math.max(ps, ws.start);
  const end = Math.min(pe, ws.end);
  if (end <= start) return null;
  return { start, end };
}

function mergeIntervals(intervals: MsInterval[]): MsInterval[] {
  if (!intervals.length) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const out: MsInterval[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    const last = out[out.length - 1];
    if (cur.start <= last.end) last.end = Math.max(last.end, cur.end);
    else out.push({ ...cur });
  }
  return out;
}

function subtractInterval(free: MsInterval[], busy: MsInterval): MsInterval[] {
  const out: MsInterval[] = [];
  for (const f of free) {
    if (busy.end <= f.start || busy.start >= f.end) {
      out.push(f);
      continue;
    }
    if (busy.start > f.start)
      out.push({ start: f.start, end: Math.min(busy.start, f.end) });
    if (busy.end < f.end)
      out.push({ start: Math.max(busy.end, f.start), end: f.end });
  }
  return out.filter((x) => x.end > x.start);
}

function subtractMany(free: MsInterval[], busyList: MsInterval[]): MsInterval[] {
  let cur = free;
  for (const b of busyList) {
    cur = cur.flatMap((f) => subtractInterval([f], b));
  }
  return mergeIntervals(cur);
}

function priorityWeight(p: TaskPriority): number {
  switch (p) {
    case TaskPriority.URGENT:
      return 4;
    case TaskPriority.HIGH:
      return 3;
    case TaskPriority.MEDIUM:
      return 2;
    default:
      return 1;
  }
}

function normalizeHorizonDays(value?: number | null): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return DEFAULT_HORIZON_DAYS;
  return Math.min(MAX_HORIZON_DAYS, Math.max(MIN_HORIZON_DAYS, Math.floor(value)));
}

function normalizeRecurrencePattern(value?: string | null): RecurrencePattern | null {
  if (!value) return null;
  const upper = value.toUpperCase();
  if (upper === 'DAILY' || upper === 'WEEKLY' || upper === 'BIWEEKLY' || upper === 'MONTHLY') {
    return upper;
  }
  return null;
}

function taskPreferredIntervalOnDay(task: Task, day: Date): MsInterval | null {
  if (!task.scheduledStartTime || !task.scheduledEndTime) return null;
  const startRef = new Date(task.scheduledStartTime);
  const endRef = new Date(task.scheduledEndTime);
  const start = new Date(day);
  start.setHours(startRef.getHours(), startRef.getMinutes(), 0, 0);
  const end = new Date(day);
  end.setHours(endRef.getHours(), endRef.getMinutes(), 0, 0);
  let startMs = start.getTime();
  let endMs = end.getTime();
  if (endMs <= startMs) {
    endMs += 24 * 60 * 60 * 1000;
  }
  return { start: startMs, end: endMs };
}

function advanceOccurrenceStart(from: Date, pattern: RecurrencePattern): Date {
  const next = new Date(from);
  if (pattern === 'DAILY') next.setDate(next.getDate() + 1);
  if (pattern === 'WEEKLY') next.setDate(next.getDate() + 7);
  if (pattern === 'BIWEEKLY') next.setDate(next.getDate() + 14);
  if (pattern === 'MONTHLY') next.setMonth(next.getMonth() + 1);
  next.setHours(0, 0, 0, 0);
  return next;
}

@Injectable()
export class IntelligentSchedulingEngine {
  constructor(
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    @InjectRepository(ScheduledTask)
    private readonly scheduledRepo: Repository<ScheduledTask>,
    private readonly userSettingsService: UserSettingsService,
    private readonly googleCalendarService: GoogleCalendarService,
  ) {}

  async captureAutoSegmentsSnapshot(userId: string): Promise<SegmentSnapshot[]> {
    const tasks = await this.taskRepo.find({ where: { userId }, select: ['id'] });
    const ids = tasks.map((t) => t.id);
    if (!ids.length) return [];
    const rows = await this.scheduledRepo.find({
      where: { taskId: In(ids), isAutoGenerated: true },
    });
    return rows.map((r) => ({
      id: r.id,
      taskId: r.taskId,
      scheduledStartTime: r.scheduledStartTime.toISOString(),
      scheduledEndTime: r.scheduledEndTime.toISOString(),
    }));
  }

  async run(userId: string): Promise<{
    diff: DiffItem[];
    warnings: SchedulingWarning[];
    errors: { taskId: string; message: string }[];
  }> {
    const settings = await this.userSettingsService.getSettings(userId);

    const autoBefore = await this.scheduledRepo
      .createQueryBuilder('st')
      .innerJoin('st.task', 't')
      .where('t.userId = :userId', { userId })
      .andWhere('st.isAutoGenerated = :ig', { ig: true })
      .getMany();

    const beforeByTask = new Map<string, ScheduledTask[]>();
    for (const row of autoBefore) {
      const list = beforeByTask.get(row.taskId) ?? [];
      list.push(row);
      beforeByTask.set(row.taskId, list);
    }

    const allTasks = await this.taskRepo.find({
      where: { userId },
      relations: ['phases', 'phase'],
      order: { createdAt: 'ASC' },
    });

    const movable = allTasks
      .filter(
        (t) =>
          t.status === TaskStatus.TODO &&
          !t.isFixedExternal &&
          t.eventType !== TaskEventType.FIXED,
      )
      .sort((a, b) => {
        const d = priorityWeight(b.priority) - priorityWeight(a.priority);
        if (d !== 0) return d;
        return (
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
      });

    const movableIds = movable.map((t) => t.id);
    if (movableIds.length) {
      await this.scheduledRepo
        .createQueryBuilder()
        .delete()
        .from(ScheduledTask)
        .where('taskId IN (:...ids)', { ids: movableIds })
        .andWhere('isAutoGenerated = :ig', { ig: true })
        .execute();
    }

    const startDay = new Date();
    startDay.setHours(0, 0, 0, 0);
    const horizonDays = normalizeHorizonDays(settings.recurringScheduleHorizonDays);
    const horizonEnd = new Date(startDay);
    horizonEnd.setDate(horizonEnd.getDate() + horizonDays);
    const extendedEnd = new Date(startDay);
    extendedEnd.setDate(
      extendedEnd.getDate() + horizonDays + BEYOND_HORIZON_EXTRA_DAYS,
    );

    const warnings: SchedulingWarning[] = [];
    let googleBusy: MsInterval[] = [];
    const ourGoogleEventIds = new Set(
      allTasks
        .map((t) => t.googleEventId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    );
    if (settings.googleCalendarLinked) {
      try {
        googleBusy = await this.collectGoogleBusyIntervals(
          userId,
          startDay,
          extendedEnd,
          ourGoogleEventIds,
        );
      } catch {
        warnings.push({
          code: SchedulingWarningCode.GOOGLE_BUSY_UNAVAILABLE,
          message:
            'Could not load Google Calendar; external events were not treated as busy.',
        });
      }
    }

    const anchorBusy = await this.buildAnchorBusyIntervals(allTasks, googleBusy);

    const errors: { taskId: string; message: string }[] = [];
    const newSegments = new Map<string, { start: Date; end: Date }[]>();

    const nowMs = Date.now();
    const tiers = this.groupMovableIntoPriorityTiers(movable);

    for (const tier of tiers) {
      const tierStack: Task[] = [];
      for (const task of tier) {
        const res = this.tryPlaceWithDisplacement(
          task,
          tierStack,
          newSegments,
          anchorBusy,
          settings,
          startDay,
          horizonEnd,
          extendedEnd,
          nowMs,
        );
        if (!res.ok) {
          errors.push({
            taskId: task.id,
            message: task.deadline
              ? `Cannot fit "${task.name}" before deadline; adjust priority, phases, split settings, or deadline.`
              : `Cannot fit "${task.name}" in the available window.`,
          });
        } else {
          if (res.beyondHorizon) {
            warnings.push({
              code: SchedulingWarningCode.OUTSIDE_HORIZON,
              taskId: task.id,
              taskName: task.name,
              meta: { horizonDays },
              message: `Task "${task.name}" was placed outside the ${horizonDays}-day window.`,
            });
          }
          if (res.skippedOccurrences > 0) {
            warnings.push({
              code: SchedulingWarningCode.OCCURRENCE_SKIPPED,
              taskId: task.id,
              taskName: task.name,
              meta: { skippedOccurrences: res.skippedOccurrences },
              message: `Task "${task.name}" skipped ${res.skippedOccurrences} recurring occurrence(s) because no eligible slot was available in the phase window.`,
            });
          }
        }
      }
    }

    const runId = `intel-${Date.now()}`;
    for (const task of movable) {
      const segs = newSegments.get(task.id);
      if (!segs?.length) continue;
      const first = segs[0];
      const last = segs[segs.length - 1];
      task.scheduledStartTime = first.start;
      task.scheduledEndTime = last.end;
      await this.taskRepo.save(task);

      for (const s of segs) {
        await this.scheduledRepo.save(
          this.scheduledRepo.create({
            taskId: task.id,
            scheduledStartTime: s.start,
            scheduledEndTime: s.end,
            isAutoGenerated: true,
            generationRun: runId,
          }),
        );
      }
    }

    const autoAfter = await this.scheduledRepo
      .createQueryBuilder('st')
      .innerJoin('st.task', 't')
      .where('t.userId = :userId', { userId })
      .andWhere('st.isAutoGenerated = :ig', { ig: true })
      .getMany();
    autoAfter.sort(
      (a, b) =>
        a.scheduledStartTime.getTime() - b.scheduledStartTime.getTime(),
    );

    const afterByTask = new Map<string, ScheduledTask[]>();
    for (const row of autoAfter) {
      const list = afterByTask.get(row.taskId) ?? [];
      list.push(row);
      afterByTask.set(row.taskId, list);
    }

    const diff = this.buildDiff(allTasks, beforeByTask, afterByTask);
    return { diff, warnings, errors };
  }

  private groupMovableIntoPriorityTiers(movable: Task[]): Task[][] {
    const tiers: Task[][] = [];
    for (const t of movable) {
      const w = priorityWeight(t.priority);
      const last = tiers[tiers.length - 1];
      if (!last || priorityWeight(last[0].priority) !== w) {
        tiers.push([t]);
      } else {
        last.push(t);
      }
    }
    return tiers;
  }

  private isTaskSplittable(task: Task, settings: UserSettings): boolean {
    const rules = getEventTypeRules(task.eventType);
    return (
      rules.splittable &&
      settings.allowSplitScheduling !== false &&
      task.allowSplit !== false
    );
  }

  private rebuildBusy(
    anchorBusy: MsInterval[],
    newSegments: Map<string, { start: Date; end: Date }[]>,
  ): MsInterval[] {
    const intervals: MsInterval[] = anchorBusy.map((x) => ({ ...x }));
    for (const segs of newSegments.values()) {
      for (const s of segs) {
        intervals.push({ start: s.start.getTime(), end: s.end.getTime() });
      }
    }
    return mergeIntervals(intervals);
  }

  private attemptPlaceTask(
    task: Task,
    settings: UserSettings,
    horizonEnd: Date,
    extendedEnd: Date,
    startDay: Date,
    newSegments: Map<string, { start: Date; end: Date }[]>,
    anchorBusy: MsInterval[],
    nowMs: number,
  ): {
    ok: boolean;
    segments: { start: Date; end: Date }[];
    beyondHorizon: boolean;
    skippedOccurrences: number;
  } {
    const recurrencePattern =
      task.isRecurring ? normalizeRecurrencePattern(task.recurrencePattern) : null;
    if (task.isRecurring && recurrencePattern) {
      return this.attemptPlaceRecurringTask(
        task,
        settings,
        horizonEnd,
        extendedEnd,
        startDay,
        newSegments,
        anchorBusy,
        nowMs,
        recurrencePattern,
      );
    }

    const rules = getEventTypeRules(task.eventType);
    const durationMin = task.estimatedTimeInMinutes;
    const minChunk =
      settings.allowSplitScheduling && rules.splittable && task.allowSplit
        ? Math.max(5, settings.minSplitMinutes ?? 30)
        : durationMin;
    const maxChunk =
      settings.allowSplitScheduling && rules.splittable && task.allowSplit
        ? Math.max(minChunk, settings.maxSplitMinutes ?? minChunk)
        : durationMin;
    const effectiveSplittable = this.isTaskSplittable(task, settings);
    const deadlineMs = task.deadline
      ? new Date(task.deadline).getTime()
      : null;
    const phases = this.resolvePhasesForTask(task);
    const placedBusy = this.rebuildBusy(anchorBusy, newSegments);

    let result = this.placeTaskGreedy(
      durationMin,
      minChunk,
      maxChunk,
      effectiveSplittable,
      phases,
      startDay,
      horizonEnd,
      deadlineMs,
      settings.wakeTime,
      settings.sleepTime,
      settings.weekendWorkEnabled,
      placedBusy,
      nowMs,
    );
    let beyondHorizon = false;
    if (!result.ok) {
      result = this.placeTaskGreedy(
        durationMin,
        minChunk,
        maxChunk,
        effectiveSplittable,
        phases,
        startDay,
        extendedEnd,
        deadlineMs,
        settings.wakeTime,
        settings.sleepTime,
        settings.weekendWorkEnabled,
        placedBusy,
        nowMs,
      );
      beyondHorizon = result.ok;
    }
    return {
      ok: result.ok,
      segments: result.segments,
      beyondHorizon,
      skippedOccurrences: 0,
    };
  }

  private attemptPlaceRecurringTask(
    task: Task,
    settings: UserSettings,
    horizonEnd: Date,
    extendedEnd: Date,
    startDay: Date,
    newSegments: Map<string, { start: Date; end: Date }[]>,
    anchorBusy: MsInterval[],
    nowMs: number,
    recurrencePattern: RecurrencePattern,
  ): {
    ok: boolean;
    segments: { start: Date; end: Date }[];
    beyondHorizon: boolean;
    skippedOccurrences: number;
  } {
    const rules = getEventTypeRules(task.eventType);
    const durationMin = task.estimatedTimeInMinutes;
    const minChunk =
      settings.allowSplitScheduling && rules.splittable && task.allowSplit
        ? Math.max(5, settings.minSplitMinutes ?? 30)
        : durationMin;
    const maxChunk =
      settings.allowSplitScheduling && rules.splittable && task.allowSplit
        ? Math.max(minChunk, settings.maxSplitMinutes ?? minChunk)
        : durationMin;
    const effectiveSplittable = this.isTaskSplittable(task, settings);
    const deadlineMs = task.deadline ? new Date(task.deadline).getTime() : null;
    const phases = this.resolvePhasesForTask(task);
    const segments: { start: Date; end: Date }[] = [];
    const restrictedWeekDays =
      recurrencePattern === 'DAILY'
        ? effectiveRecurrenceWeekDaysFromPhases(phases)
        : null;

    let beyondHorizon = false;
    let skippedOccurrences = 0;
    let occurrenceStart = new Date(startDay);
    occurrenceStart.setHours(0, 0, 0, 0);

    while (occurrenceStart < horizonEnd) {
      if (
        recurrencePattern === 'DAILY' &&
        restrictedWeekDays?.length &&
        !restrictedWeekDays.includes(occurrenceStart.getDay())
      ) {
        occurrenceStart = advanceOccurrenceStart(occurrenceStart, recurrencePattern);
        continue;
      }

      const placedBusy = this.rebuildBusy(anchorBusy, newSegments);
      for (const seg of segments) {
        placedBusy.push({ start: seg.start.getTime(), end: seg.end.getTime() });
      }
      const mergedBusy = mergeIntervals(placedBusy);

      const occurrenceEnd = advanceOccurrenceStart(occurrenceStart, recurrencePattern);
      const preferredInterval =
        recurrencePattern === 'DAILY' && task.eventType === TaskEventType.DAILY_ROUTINE
          ? taskPreferredIntervalOnDay(task, occurrenceStart)
          : null;
      if (preferredInterval) {
        const eligible = subtractMany(
          this.eligibleIntervalsForDay(
            occurrenceStart,
            phases,
            settings.wakeTime,
            settings.sleepTime,
            settings.weekendWorkEnabled,
          ),
          mergedBusy,
        );

        const fitsEligible = eligible.some(
          (slot) =>
            preferredInterval.start >= slot.start &&
            preferredInterval.end <= slot.end,
        );
        const durationMin = (preferredInterval.end - preferredInterval.start) / 60000;
        const canPlaceByNow = preferredInterval.start >= nowMs;
        const canPlaceByDeadline =
          deadlineMs == null || preferredInterval.end <= deadlineMs;

        if (fitsEligible && canPlaceByNow && canPlaceByDeadline && durationMin > 0) {
          segments.push({
            start: new Date(preferredInterval.start),
            end: new Date(preferredInterval.end),
          });
          occurrenceStart = occurrenceEnd;
          continue;
        }
        skippedOccurrences += 1;
        occurrenceStart = occurrenceEnd;
        continue;
      }

      let result = this.placeTaskGreedy(
        durationMin,
        minChunk,
        maxChunk,
        effectiveSplittable,
        phases,
        occurrenceStart,
        occurrenceEnd,
        deadlineMs,
        settings.wakeTime,
        settings.sleepTime,
        settings.weekendWorkEnabled,
        mergedBusy,
        nowMs,
      );

      if (!result.ok) {
        skippedOccurrences += 1;
        occurrenceStart = occurrenceEnd;
        continue;
      }

      segments.push(...result.segments);
      occurrenceStart = occurrenceEnd;
    }

    return { ok: true, segments, beyondHorizon, skippedOccurrences };
  }

  /**
   * Same-priority tier: if a task does not fit, temporarily unplace splittable peers (LIFO)
   * and replan them after the newcomer (intra-priority combination).
   */
  private tryPlaceWithDisplacement(
    task: Task,
    tierStack: Task[],
    newSegments: Map<string, { start: Date; end: Date }[]>,
    anchorBusy: MsInterval[],
    settings: UserSettings,
    startDay: Date,
    horizonEnd: Date,
    extendedEnd: Date,
    nowMs: number,
  ): { ok: boolean; beyondHorizon: boolean; skippedOccurrences: number } {
    const att = this.attemptPlaceTask(
      task,
      settings,
      horizonEnd,
      extendedEnd,
      startDay,
      newSegments,
      anchorBusy,
      nowMs,
    );
    if (att.ok) {
      newSegments.set(task.id, att.segments);
      tierStack.push(task);
      return {
        ok: true,
        beyondHorizon: att.beyondHorizon,
        skippedOccurrences: att.skippedOccurrences,
      };
    }

    const displaced: { task: Task; segments: { start: Date; end: Date }[] }[] =
      [];

    while (tierStack.length > 0) {
      const P = tierStack[tierStack.length - 1];
      if (!this.isTaskSplittable(P, settings)) {
        break;
      }

      tierStack.pop();
      const pSegs = newSegments.get(P.id);
      if (!pSegs) {
        tierStack.push(P);
        break;
      }
      newSegments.delete(P.id);
      displaced.push({ task: P, segments: pSegs });

      const att2 = this.attemptPlaceTask(
        task,
        settings,
        horizonEnd,
        extendedEnd,
        startDay,
        newSegments,
        anchorBusy,
        nowMs,
      );
      if (att2.ok) {
        newSegments.set(task.id, att2.segments);
        tierStack.push(task);

        const replanned: Task[] = [];
        let fatal = false;
        for (let i = displaced.length - 1; i >= 0; i--) {
          const Q = displaced[i].task;
          const qAtt = this.attemptPlaceTask(
            Q,
            settings,
            horizonEnd,
            extendedEnd,
            startDay,
            newSegments,
            anchorBusy,
            nowMs,
          );
          if (!qAtt.ok) {
            fatal = true;
            break;
          }
          newSegments.set(Q.id, qAtt.segments);
          tierStack.push(Q);
          replanned.push(Q);
        }

        if (!fatal) {
          return {
            ok: true,
            beyondHorizon: att2.beyondHorizon,
            skippedOccurrences: att2.skippedOccurrences,
          };
        }

        for (const R of replanned.slice().reverse()) {
          newSegments.delete(R.id);
          tierStack.pop();
        }
        newSegments.delete(task.id);
        tierStack.pop();
        for (let i = displaced.length - 1; i >= 0; i--) {
          const d = displaced[i];
          newSegments.set(d.task.id, d.segments);
          tierStack.push(d.task);
        }
        return { ok: false, beyondHorizon: false, skippedOccurrences: 0 };
      }
    }

    for (let i = displaced.length - 1; i >= 0; i--) {
      const d = displaced[i];
      newSegments.set(d.task.id, d.segments);
      tierStack.push(d.task);
    }
    return { ok: false, beyondHorizon: false, skippedOccurrences: 0 };
  }

  private resolvePhasesForTask(task: Task): Phase[] {
    if (task.phases?.length) return task.phases;
    if (task.phase) return [task.phase];
    return [];
  }

  private async buildAnchorBusyIntervals(
    tasks: Task[],
    googleBusy: MsInterval[] = [],
  ): Promise<MsInterval[]> {
    const busy: MsInterval[] = [...googleBusy];
    const taskIds = tasks.map((t) => t.id);
    if (!taskIds.length) {
      return mergeIntervals(busy);
    }

    const scheduled = await this.scheduledRepo.find({
      where: { taskId: In(taskIds) },
      relations: ['task'],
    });

    for (const st of scheduled) {
      const t = st.task;
      if (!t) continue;
      const isAnchor =
        !st.isAutoGenerated ||
        t.isFixedExternal ||
        t.eventType === TaskEventType.FIXED;
      if (isAnchor) {
        busy.push({
          start: st.scheduledStartTime.getTime(),
          end: st.scheduledEndTime.getTime(),
        });
      }
    }

    for (const t of tasks) {
      if (t.eventType === TaskEventType.FIXED && t.scheduledStartTime && t.scheduledEndTime) {
        busy.push({
          start: new Date(t.scheduledStartTime).getTime(),
          end: new Date(t.scheduledEndTime).getTime(),
        });
      }
    }

    return mergeIntervals(busy);
  }

  /**
   * Google list uses singleEvents=true — instances have their own id and may set recurringEventId.
   * We must not treat our own synced events as external busy, or replan cannot re-place the same slots.
   */
  private isGoogleEventFromOurSyncedTasks(
    ev: { id?: string | null; recurringEventId?: string | null },
    ourGoogleEventIds: Set<string>,
  ): boolean {
    if (!ourGoogleEventIds.size) return false;
    if (ev.id && ourGoogleEventIds.has(ev.id)) return true;
    if (ev.recurringEventId && ourGoogleEventIds.has(ev.recurringEventId)) {
      return true;
    }
    return false;
  }

  private googleEventToBusyInterval(ev: {
    status?: string | null;
    start?: { dateTime?: string | null; date?: string | null };
    end?: { dateTime?: string | null; date?: string | null };
  }): MsInterval | null {
    if (!ev || ev.status === 'cancelled') return null;
    if (ev.start?.dateTime && ev.end?.dateTime) {
      const s = new Date(ev.start.dateTime).getTime();
      const e = new Date(ev.end.dateTime).getTime();
      if (e > s) return { start: s, end: e };
      return null;
    }
    if (ev.start?.date && ev.end?.date) {
      const s = new Date(`${ev.start.date}T00:00:00.000Z`).getTime();
      const e = new Date(`${ev.end.date}T00:00:00.000Z`).getTime();
      if (e > s) return { start: s, end: e };
    }
    return null;
  }

  private async collectGoogleBusyIntervals(
    userId: string,
    rangeStart: Date,
    rangeEnd: Date,
    excludeGoogleEventIds?: Set<string>,
  ): Promise<MsInterval[]> {
    const busy: MsInterval[] = [];
    const calendarIds = ['primary'];
    const appCalId =
      await this.googleCalendarService.getStoredAppCalendarId(userId);
    if (appCalId) {
      calendarIds.push(appCalId);
    }
    for (const calId of calendarIds) {
      let pageToken: string | undefined;
      do {
        const page = await this.googleCalendarService.getEvents(
          userId,
          rangeStart.toISOString(),
          rangeEnd.toISOString(),
          2500,
          pageToken,
          calId,
        );
        for (const ev of page.events) {
          if (
            excludeGoogleEventIds?.size &&
            this.isGoogleEventFromOurSyncedTasks(ev, excludeGoogleEventIds)
          ) {
            continue;
          }
          const iv = this.googleEventToBusyInterval(ev);
          if (iv) busy.push(iv);
        }
        pageToken = page.nextPageToken ?? undefined;
      } while (pageToken);
    }
    return mergeIntervals(busy);
  }

  private eligibleIntervalsForDay(
    day: Date,
    phases: Phase[],
    wake: string,
    sleep: string,
    weekendOk: boolean,
  ): MsInterval[] {
    const ws = dayWakeSleep(day, wake, sleep);
    if (!phases.length) {
      const dow = day.getDay();
      if ((dow === 0 || dow === 6) && !weekendOk) return [];
      return [ws];
    }
    const parts: MsInterval[] = [];
    for (const ph of phases) {
      const w = phaseWindowOnDay(ph, day, ws);
      if (w) parts.push(w);
    }
    return mergeIntervals(parts);
  }

  /**
   * Greedy: earliest slots first; split only when allowed and necessary.
   */
  private placeTaskGreedy(
    durationMin: number,
    minChunk: number,
    maxChunk: number,
    splittable: boolean,
    phases: Phase[],
    rangeStart: Date,
    rangeEnd: Date,
    deadlineMs: number | null,
    wake: string,
    sleep: string,
    weekendOk: boolean,
    globalBusy: MsInterval[],
    nowMs: number,
  ): { ok: boolean; segments: { start: Date; end: Date }[] } {
    let remaining = durationMin;
    const segments: { start: Date; end: Date }[] = [];
    const myBusy: MsInterval[] = [...globalBusy];

    const day = new Date(rangeStart);
    while (day < rangeEnd && remaining > 0) {
      if (deadlineMs && day.getTime() > deadlineMs) {
        return { ok: false, segments: [] };
      }

      let eligible = this.eligibleIntervalsForDay(
        day,
        phases,
        wake,
        sleep,
        weekendOk,
      );
      eligible = subtractMany(eligible, myBusy);

      for (const slot of eligible) {
        let cursor = Math.max(slot.start, nowMs);
        while (remaining > 0 && cursor < slot.end) {
          const roomMin = (slot.end - cursor) / 60000;
          if (roomMin < 1) break;

          let takeMin: number;
          if (!splittable) {
            if (roomMin < remaining) break;
            takeMin = remaining;
          } else {
            if (remaining <= minChunk) {
              takeMin = remaining;
            } else {
              takeMin = Math.min(remaining, Math.floor(roomMin), Math.floor(maxChunk));
              if (takeMin < minChunk) break;
            }
          }

          const endMs = cursor + takeMin * 60000;
          if (endMs > slot.end) break;
          if (deadlineMs && endMs > deadlineMs) {
            return { ok: false, segments: [] };
          }

          segments.push({ start: new Date(cursor), end: new Date(endMs) });
          myBusy.push({ start: cursor, end: endMs });
          myBusy.sort((a, b) => a.start - b.start);
          remaining -= takeMin;
          cursor = endMs;
          if (!splittable) break;
        }
      }
      day.setDate(day.getDate() + 1);
    }

    return { ok: remaining <= 0, segments };
  }

  private buildDiff(
    tasks: Task[],
    beforeByTask: Map<string, ScheduledTask[]>,
    afterByTask: Map<string, ScheduledTask[]>,
  ): DiffItem[] {
    const diff: DiffItem[] = [];
    const taskMap = new Map(tasks.map((t) => [t.id, t]));

    const taskIds = new Set<string>([
      ...beforeByTask.keys(),
      ...afterByTask.keys(),
    ]);

    for (const id of taskIds) {
      const t = taskMap.get(id);
      const name = t?.name ?? id;
      const before = (beforeByTask.get(id) ?? []).map((r) => ({
        id: r.id,
        start: r.scheduledStartTime.toISOString(),
        end: r.scheduledEndTime.toISOString(),
      }));
      const aft = (afterByTask.get(id) ?? []).map((r) => ({
        id: r.id,
        start: r.scheduledStartTime.toISOString(),
        end: r.scheduledEndTime.toISOString(),
      }));

      const changed =
        JSON.stringify(before.map((x) => [x.start, x.end])) !==
        JSON.stringify(aft.map((x) => [x.start, x.end]));
      if (changed) diff.push({ taskId: id, taskName: name, before, after: aft });
    }

    return diff;
  }

  async restoreSnapshot(userId: string, snapshot: SegmentSnapshot[]) {
    const tasks = await this.taskRepo.find({ where: { userId }, select: ['id'] });
    const ids = tasks.map((t) => t.id);
    if (!ids.length) return;

    await this.scheduledRepo
      .createQueryBuilder()
      .delete()
      .from(ScheduledTask)
      .where('taskId IN (:...ids)', { ids })
      .andWhere('isAutoGenerated = :ig', { ig: true })
      .execute();

    for (const seg of snapshot) {
      const row = this.scheduledRepo.create({
        id: seg.id,
        taskId: seg.taskId,
        scheduledStartTime: new Date(seg.scheduledStartTime),
        scheduledEndTime: new Date(seg.scheduledEndTime),
        isAutoGenerated: true,
        generationRun: 'undo-restore',
      });
      await this.scheduledRepo.save(row);
    }
  }
}
