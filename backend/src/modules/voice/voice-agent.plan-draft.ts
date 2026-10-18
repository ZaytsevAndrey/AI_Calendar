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
const MAX_PLAN_ITEMS = 16;

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

/** Open Unscheduled (oldest deadline first) + flexible one-offs already on that day. */
export function initialPlanDraft(day: string, ctx: PlanDraftContext): PlanDraft {
  const unscheduled = ctx.tasks
    .filter((task) => isOpen(task) && task.isUnscheduled && !task.isRecurring)
    .sort((a, b) => {
      const da = a.deadline ? new Date(a.deadline).getTime() : Infinity;
      const db = b.deadline ? new Date(b.deadline).getTime() : Infinity;
      if (da !== db) return da - db;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    })
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

function cleanHm(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d{1,2}:\d{2}$/.test(trimmed)) return null;
  const [hour, minute] = trimmed.split(':').map(Number);
  if (hour > 23 || minute > 59) return null;
  return normalizeClockHm(trimmed);
}

function optionalHm(row: Record<string, unknown>, key: string): string | null | undefined {
  if (!(key in row)) return undefined;
  return cleanHm(row[key]);
}

/** Validate LLM edit rows; unknown ops and malformed rows are dropped. */
export function parsePlanEdits(raw: unknown): PlanEdit[] {
  if (!Array.isArray(raw)) return [];
  const edits: PlanEdit[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const op = String(row.op || '').trim();
    const itemId = typeof row.itemId === 'string' ? row.itemId.trim() : '';
    switch (op) {
      case 'add_task': {
        const name = typeof row.name === 'string' ? row.name.trim() : '';
        if (!name) break;
        const minutes = Number(row.durationMinutes);
        edits.push({
          op,
          name,
          durationMinutes: Number.isFinite(minutes) && minutes >= 5 ? Math.round(minutes) : null,
          preferredHm: cleanHm(row.preferredHm),
          earliestHm: cleanHm(row.earliestHm),
          deadlineHm: cleanHm(row.deadlineHm),
        });
        break;
      }
      case 'include_task': {
        const taskId = typeof row.taskId === 'string' ? row.taskId.trim() : '';
        if (taskId) edits.push({ op, taskId });
        break;
      }
      case 'remove_item':
        if (itemId) edits.push({ op, itemId });
        break;
      case 'set_preferred_start':
        if (itemId) edits.push({ op, itemId, hm: cleanHm(row.hm) });
        break;
      case 'set_window': {
        if (!itemId) break;
        const edit: PlanEdit = { op, itemId };
        const earliest = optionalHm(row, 'earliestHm');
        const deadline = optionalHm(row, 'deadlineHm');
        if (earliest !== undefined) edit.earliestHm = earliest;
        if (deadline !== undefined) edit.deadlineHm = deadline;
        edits.push(edit);
        break;
      }
      case 'set_duration': {
        const minutes = Number(row.minutes);
        if (itemId && Number.isFinite(minutes) && minutes >= 5) {
          edits.push({ op, itemId, minutes: Math.round(minutes) });
        }
        break;
      }
      case 'set_order': {
        const ids = Array.isArray(row.itemIds)
          ? row.itemIds.map((id) => String(id || '').trim()).filter(Boolean)
          : [];
        if (ids.length) edits.push({ op, itemIds: ids });
        break;
      }
      default:
        break;
    }
  }
  return edits;
}

/** Pure reducer: returns a new draft with the edits applied (unknown ids are ignored). */
export function applyPlanEdits(
  draft: PlanDraft,
  edits: PlanEdit[],
  ctx: PlanDraftContext,
): PlanDraft {
  let items = draft.items.map((item) => ({ ...item }));
  let nextNewId = draft.nextNewId;
  const patch = (itemId: string, fn: (item: PlanItem) => void) => {
    const item = items.find((row) => row.id === itemId);
    if (item) fn(item);
  };

  for (const edit of edits) {
    switch (edit.op) {
      case 'add_task': {
        if (items.length >= MAX_PLAN_ITEMS) break;
        items.push({
          id: `new:${nextNewId}`,
          taskId: null,
          source: 'new',
          name: edit.name,
          durationMinutes: edit.durationMinutes ?? ctx.defaultDurationMinutes,
          preferredHm: edit.preferredHm,
          earliestHm: edit.earliestHm,
          deadlineHm: edit.deadlineHm,
        });
        nextNewId += 1;
        break;
      }
      case 'include_task': {
        if (items.length >= MAX_PLAN_ITEMS) break;
        if (items.some((item) => item.taskId === edit.taskId)) break;
        const task = ctx.tasks.find((row) => row.id === edit.taskId);
        const item = task ? itemFromTask(task, draft.day, ctx) : null;
        if (item) items.push(item);
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
  return { ...draft, items, nextNewId };
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
