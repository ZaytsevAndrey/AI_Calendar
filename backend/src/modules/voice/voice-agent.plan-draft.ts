import { t } from '../../i18n/t';
import { isAppLanguage, type AppLanguage } from '../../i18n/types';
import { TaskEventType } from '../scheduling/event-type.enum';
import type { ScheduledTask } from '../schedule/schedule.entity';
import {
  ScheduleState,
  type Task,
  TaskStatus,
} from '../tasks/entities/task.entity';
import type {
  DayPlanProposal,
  PlanDraft,
  PlanItem,
  VoiceWriteIntent,
} from './voice-agent.types';
import {
  endOfLocalDayIso,
  localHm,
  localYmd,
  normalizeClockHm,
} from './voice-local-date.util';

const MAX_INITIAL_UNSCHEDULED = 10;
/** Draft cap. An add or include past it is `plan_full`; the cap is not raised. */
const MAX_PLAN_ITEMS = 16;

/** Why a row is not an applicable edit. The reply counts these and does not read the cause aloud. */
export type InvalidEditCause =
  | 'unknown_op'
  | 'not_an_object'
  | 'not_an_array'
  | 'missing_name'
  | 'missing_task_id'
  | 'missing_item_id'
  | 'missing_item_ids';

/** A plan edit the draft did not apply. The reply must say so. */
export type SkippedPlanEdit =
  | { reason: 'invalid_time' }
  | { reason: 'invalid_duration' }
  | { reason: 'plan_full' }
  | { reason: 'invalid_edit'; cause: InvalidEditCause };

export type PlanEditApplication = {
  draft: PlanDraft;
  skipped: SkippedPlanEdit[];
};

export type PlanEditParse = {
  edits: PlanEdit[];
  skipped: SkippedPlanEdit[];
};

/** Voice edits on a day-plan draft. Clocks are HH:MM on the plan day. */
export type PlanEdit =
  | {
      op: 'add_task';
      name: string;
      durationMinutes: number | null;
      preferredHm: string | null;
      earliestHm: string | null;
      deadlineHm: string | null;
    }
  | { op: 'include_task'; taskId: string }
  | { op: 'remove_item'; itemId: string }
  | { op: 'set_preferred_start'; itemId: string; hm: string | null }
  | {
      op: 'set_window';
      itemId: string;
      earliestHm?: string | null;
      deadlineHm?: string | null;
    }
  | { op: 'set_duration'; itemId: string; minutes: number }
  | { op: 'set_order'; itemIds: string[] };

export type PlanDraftContext = {
  tasks: Task[];
  slots: ScheduledTask[];
  timeZone: string;
  nowIso: string;
  defaultDurationMinutes: number;
};

function isOpen(task: Task): boolean {
  return (
    task.status !== TaskStatus.COMPLETED && task.status !== TaskStatus.CANCELED
  );
}

/** Flexible one-offs the plan may re-seat. Fixed, external, series and locked rows stay put. */
function isReseatable(task: Task): boolean {
  return (
    isOpen(task) &&
    task.status !== TaskStatus.IN_PROGRESS &&
    !task.isUnscheduled &&
    !task.isRecurring &&
    !task.isFixedExternal &&
    task.eventType !== TaskEventType.FIXED &&
    task.scheduleState !== ScheduleState.RESOLVED
  );
}

/** The single future slot a task has on `day`, or null (split / none / past). */
export function daySlotFor(
  taskId: string,
  day: string,
  ctx: Pick<PlanDraftContext, 'slots' | 'timeZone' | 'nowIso'>,
): ScheduledTask | null {
  const nowMs = new Date(ctx.nowIso).getTime();
  const onDay = ctx.slots.filter(
    (slot) =>
      slot.taskId === taskId &&
      localYmd(new Date(slot.scheduledStartTime).toISOString(), ctx.timeZone) === day,
  );
  if (onDay.length !== 1) return null;
  return new Date(onDay[0].scheduledStartTime).getTime() > nowMs ? onDay[0] : null;
}

function durationOf(task: Task, fallback: number): number {
  const minutes = task.estimatedTimeInMinutes;
  return typeof minutes === 'number' && minutes >= 5 ? minutes : fallback;
}

function itemFromTask(
  task: Task,
  day: string,
  ctx: PlanDraftContext,
): PlanItem | null {
  if (!isOpen(task) || task.isRecurring) return null;
  if (task.isUnscheduled) {
    return {
      id: task.id,
      taskId: task.id,
      source: 'unscheduled',
      name: task.name,
      durationMinutes: durationOf(task, ctx.defaultDurationMinutes),
      preferredHm: null,
      earliestHm: null,
      deadlineHm: null,
    };
  }
  if (!isReseatable(task)) return null;
  const slot = daySlotFor(task.id, day, ctx);
  return {
    id: task.id,
    taskId: task.id,
    source: 'flexible',
    name: task.name,
    durationMinutes: durationOf(task, ctx.defaultDurationMinutes),
    preferredHm: slot
      ? normalizeClockHm(
          localHm(new Date(slot.scheduledStartTime).toISOString(), ctx.timeZone),
        )
      : null,
    earliestHm: null,
    deadlineHm: null,
  };
}

/** Open Later tasks (oldest first) + flexible one-offs already on that day. */
export function initialPlanDraft(day: string, ctx: PlanDraftContext): PlanDraft {
  const unscheduled = ctx.tasks
    .filter((task) => isOpen(task) && task.isUnscheduled && !task.isRecurring)
    .sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    )
    .slice(0, MAX_INITIAL_UNSCHEDULED);
  const flexible = ctx.tasks.filter(
    (task) => isReseatable(task) && daySlotFor(task.id, day, ctx) != null,
  );
  const items = [...unscheduled, ...flexible]
    .map((task) => itemFromTask(task, day, ctx))
    .filter((item): item is PlanItem => item != null);
  return {
    day,
    stage: 'review',
    interviewAsked: 0,
    items,
    revision: 0,
    nextNewId: 1,
    lastProposal: null,
  };
}

type ClockField =
  | { state: 'absent' }
  | { state: 'clear' }
  | { state: 'valid'; hm: string }
  | { state: 'invalid' };

type DurationField =
  | { state: 'absent' }
  | { state: 'clear' }
  | { state: 'valid'; minutes: number }
  | { state: 'invalid' };

/** Missing key, explicit null, a real clock, and anything else stay distinct. */
function readClock(row: Record<string, unknown>, key: string): ClockField {
  if (!(key in row)) return { state: 'absent' };
  const value = row[key];
  if (value === null) return { state: 'clear' };
  if (typeof value !== 'string') return { state: 'invalid' };
  const trimmed = value.trim();
  if (!/^\d{1,2}:\d{2}$/.test(trimmed)) return { state: 'invalid' };
  const [hour, minute] = trimmed.split(':').map(Number);
  if (hour > 23 || minute > 59) return { state: 'invalid' };
  return { state: 'valid', hm: normalizeClockHm(trimmed) };
}

/** Missing and explicit null are unspecified. A present unusable number is invalid. */
function readDuration(row: Record<string, unknown>, key: string): DurationField {
  if (!(key in row)) return { state: 'absent' };
  const value = row[key];
  if (value === null) return { state: 'clear' };
  const minutes =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value.trim())
        : Number.NaN;
  if (typeof value !== 'number' && typeof value !== 'string') return { state: 'invalid' };
  if (!Number.isFinite(minutes) || minutes < 5) return { state: 'invalid' };
  return { state: 'valid', minutes: Math.round(minutes) };
}

function clockOrNull(field: ClockField): string | null {
  return field.state === 'valid' ? field.hm : null;
}

function rejectEdit(skipped: SkippedPlanEdit[], cause: InvalidEditCause): void {
  skipped.push({ reason: 'invalid_edit', cause });
}

/**
 * Validate LLM edit rows. A row that cannot be applied is `skipped` with a cause.
 * An unusable clock or length is not applied; `skipped` is the reply about it.
 * `undefined` means the caller sent no edits.
 */
export function parsePlanEdits(raw: unknown): PlanEditParse {
  if (raw === undefined) return { edits: [], skipped: [] };
  if (!Array.isArray(raw)) {
    return { edits: [], skipped: [{ reason: 'invalid_edit', cause: 'not_an_array' }] };
  }
  const edits: PlanEdit[] = [];
  const skipped: SkippedPlanEdit[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      rejectEdit(skipped, 'not_an_object');
      continue;
    }
    const row = entry as Record<string, unknown>;
    const op = String(row.op || '').trim();
    const itemId = typeof row.itemId === 'string' ? row.itemId.trim() : '';
    switch (op) {
      case 'add_task': {
        const name = typeof row.name === 'string' ? row.name.trim() : '';
        if (!name) {
          rejectEdit(skipped, 'missing_name');
          break;
        }
        const duration = readDuration(row, 'durationMinutes');
        const preferred = readClock(row, 'preferredHm');
        const earliest = readClock(row, 'earliestHm');
        const deadline = readClock(row, 'deadlineHm');
        const badClock = [preferred, earliest, deadline].some((field) => field.state === 'invalid');
        if (badClock || duration.state === 'invalid') {
          skipped.push({ reason: badClock ? 'invalid_time' : 'invalid_duration' });
          break;
        }
        edits.push({
          op,
          name,
          durationMinutes: duration.state === 'valid' ? duration.minutes : null,
          preferredHm: clockOrNull(preferred),
          earliestHm: clockOrNull(earliest),
          deadlineHm: clockOrNull(deadline),
        });
        break;
      }
      case 'include_task': {
        const taskId = typeof row.taskId === 'string' ? row.taskId.trim() : '';
        if (!taskId) {
          rejectEdit(skipped, 'missing_task_id');
          break;
        }
        edits.push({ op, taskId });
        break;
      }
      case 'remove_item':
        if (!itemId) {
          rejectEdit(skipped, 'missing_item_id');
          break;
        }
        edits.push({ op, itemId });
        break;
      case 'set_preferred_start': {
        if (!itemId) {
          rejectEdit(skipped, 'missing_item_id');
          break;
        }
        const hm = readClock(row, 'hm');
        if (hm.state === 'absent') break;
        if (hm.state === 'invalid') {
          skipped.push({ reason: 'invalid_time' });
          break;
        }
        edits.push({ op, itemId, hm: hm.state === 'clear' ? null : hm.hm });
        break;
      }
      case 'set_window': {
        if (!itemId) {
          rejectEdit(skipped, 'missing_item_id');
          break;
        }
        const earliest = readClock(row, 'earliestHm');
        const deadline = readClock(row, 'deadlineHm');
        if (earliest.state === 'invalid' || deadline.state === 'invalid') {
          skipped.push({ reason: 'invalid_time' });
        }
        const edit: Extract<PlanEdit, { op: 'set_window' }> = { op, itemId };
        if (earliest.state === 'clear') edit.earliestHm = null;
        else if (earliest.state === 'valid') edit.earliestHm = earliest.hm;
        if (deadline.state === 'clear') edit.deadlineHm = null;
        else if (deadline.state === 'valid') edit.deadlineHm = deadline.hm;
        if (edit.earliestHm !== undefined || edit.deadlineHm !== undefined) edits.push(edit);
        break;
      }
      case 'set_duration': {
        if (!itemId) {
          rejectEdit(skipped, 'missing_item_id');
          break;
        }
        const minutes = readDuration(row, 'minutes');
        if (minutes.state === 'absent') break;
        if (minutes.state !== 'valid') {
          skipped.push({ reason: 'invalid_duration' });
          break;
        }
        edits.push({ op, itemId, minutes: minutes.minutes });
        break;
      }
      case 'set_order': {
        if (!Array.isArray(row.itemIds)) {
          rejectEdit(skipped, 'missing_item_ids');
          break;
        }
        const ids = row.itemIds.map((id) => String(id || '').trim()).filter(Boolean);
        if (!ids.length) {
          rejectEdit(skipped, 'missing_item_ids');
          break;
        }
        edits.push({ op, itemIds: ids });
        break;
      }
      default:
        rejectEdit(skipped, 'unknown_op');
        break;
    }
  }
  return { edits, skipped };
}

/** Pure reducer: returns a new draft with the edits applied (unknown ids are ignored). */
export function applyPlanEdits(
  draft: PlanDraft,
  edits: PlanEdit[],
  ctx: PlanDraftContext,
): PlanEditApplication {
  const skipped: SkippedPlanEdit[] = [];
  let items = draft.items.map((item) => ({ ...item }));
  let nextNewId = draft.nextNewId;
  const patch = (itemId: string, fn: (item: PlanItem) => void) => {
    const item = items.find((row) => row.id === itemId);
    if (item) fn(item);
  };

  for (const edit of edits) {
    switch (edit.op) {
      case 'add_task': {
        if (items.length >= MAX_PLAN_ITEMS) {
          skipped.push({ reason: 'plan_full' });
          break;
        }
        items.push({
          id: `new:${nextNewId}`,
          taskId: null,
          source: 'new',
          name: edit.name,
          // null is an omitted length (missing key or schema null), never a rejected number.
          durationMinutes: edit.durationMinutes ?? ctx.defaultDurationMinutes,
          preferredHm: edit.preferredHm,
          earliestHm: edit.earliestHm,
          deadlineHm: edit.deadlineHm,
        });
        nextNewId += 1;
        break;
      }
      case 'include_task': {
        if (items.some((item) => item.taskId === edit.taskId)) break;
        const task = ctx.tasks.find((row) => row.id === edit.taskId);
        const item = task ? itemFromTask(task, draft.day, ctx) : null;
        if (!item) break;
        if (items.length >= MAX_PLAN_ITEMS) {
          skipped.push({ reason: 'plan_full' });
          break;
        }
        items.push(item);
        break;
      }
      case 'remove_item':
        items = items.filter((item) => item.id !== edit.itemId);
        break;
      case 'set_preferred_start':
        patch(edit.itemId, (item) => {
          item.preferredHm = edit.hm;
        });
        break;
      case 'set_window':
        patch(edit.itemId, (item) => {
          if (edit.earliestHm !== undefined) item.earliestHm = edit.earliestHm;
          if (edit.deadlineHm !== undefined) item.deadlineHm = edit.deadlineHm;
          // A window that excludes the preferred clock wins over it.
          if (
            item.preferredHm &&
            ((item.earliestHm && item.preferredHm < item.earliestHm) ||
              (item.deadlineHm && item.preferredHm >= item.deadlineHm))
          ) {
            item.preferredHm = null;
          }
        });
        break;
      case 'set_duration':
        patch(edit.itemId, (item) => {
          item.durationMinutes = edit.minutes;
        });
        break;
      case 'set_order': {
        const first = edit.itemIds
          .map((id) => items.find((item) => item.id === id))
          .filter((item): item is PlanItem => item != null);
        const rest = items.filter((item) => !first.includes(item));
        items = [...first, ...rest];
        break;
      }
    }
  }
  return {
    draft: {
      ...draft,
      items,
      nextNewId,
      revision: edits.length ? draft.revision + 1 : draft.revision,
    },
    skipped,
  };
}

function lang(value?: string | null): AppLanguage {
  return isAppLanguage(value) ? value : 'en';
}

/**
 * Apply intents for a proposal: Unscheduled → window on the slot, flexible →
 * shift its slot (unchanged slots are skipped), new → flexible create with that
 * preferred start and an end-of-day deadline.
 */
export function planToIntents(
  proposal: DayPlanProposal,
  ctx: Pick<PlanDraftContext, 'slots' | 'timeZone' | 'nowIso'> & {
    language?: string | null;
  },
): VoiceWriteIntent[] {
  const language = lang(ctx.language);
  const intents: VoiceWriteIntent[] = [];
  for (const item of proposal.items) {
    const time = localHm(item.start, ctx.timeZone);
    if (item.source === 'new') {
      const summary = t(language, 'voice.planItemCreate', { name: item.name, time });
      intents.push({
        type: 'create',
        summary,
        task: {
          name: item.name,
          eventType: 'admin',
          estimatedTimeInMinutes: item.durationMinutes,
          isRecurring: false,
          isUnscheduled: false,
          allowSplit: false,
          priority: 'medium',
          earliestStartTime: null,
          deadline: endOfLocalDayIso(proposal.day, ctx.timeZone),
          scheduledStartTime: item.start,
          scheduledEndTime: item.end,
          timeZone: ctx.timeZone,
        },
      });
      continue;
    }
    if (!item.taskId) continue;
    if (item.source === 'flexible') {
      const slot = daySlotFor(item.taskId, proposal.day, ctx);
      if (!slot) continue;
      if (new Date(slot.scheduledStartTime).getTime() === new Date(item.start).getTime()) {
        continue;
      }
      const summary = t(language, 'voice.planItemMove', { name: item.name, time });
      intents.push({
        type: 'command',
        summary,
        command: {
          kind: 'shift',
          taskId: item.taskId,
          taskName: item.name,
          summary,
          slotId: slot.id,
          start: item.start,
          end: item.end,
        },
      });
      continue;
    }
    const summary = t(language, 'voice.planItemSchedule', { name: item.name, time });
    intents.push({
      type: 'command',
      summary,
      command: {
        kind: 'window',
        taskId: item.taskId,
        taskName: item.name,
        summary,
        earliestStartTime: item.start,
        deadline: item.end,
        scheduledStartTime: item.start,
        scheduledEndTime: item.end,
        clearUnscheduled: true,
      },
    });
  }
  return intents;
}
