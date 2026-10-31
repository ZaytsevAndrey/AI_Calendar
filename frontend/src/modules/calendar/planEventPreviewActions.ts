import type { TaskDTO } from 'api/tasks.api';
import type { SeriesDragScope } from 'modules/schedule/seriesDragChoice';

export type EventPreviewEditPlan = 'direct' | 'series_menu';

/**
 * Done on the calendar preview: an app task that is not done yet. For a
 * series this completes the opened day only (its own completion state).
 */
export function canCompleteFromPreview(
  task: Pick<TaskDTO, 'isRecurring' | 'isFixedExternal' | 'status'> | null,
): boolean {
  if (!task) return false;
  if (task.isFixedExternal) return false;
  if (task.status === 'completed' || task.status === 'canceled') return false;
  return true;
}

/** «Не виконано»: a completed app task (a one-off or a completed day copy). */
export function canUndoDoneFromPreview(
  task: Pick<TaskDTO, 'isRecurring' | 'isFixedExternal' | 'status'> | null,
): boolean {
  if (!task) return false;
  if (task.isFixedExternal || task.isRecurring) return false;
  return task.status === 'completed';
}

export type EventPreviewDeletePlan =
  | 'confirm_google'
  | 'confirm_task'
  | 'series_menu';

export type EventPreviewDeleteMutation =
  | { kind: 'skip_occurrence' }
  | { kind: 'end_series_from' }
  | { kind: 'delete_task' };

/** True when the opened calendar block is a repeating series instance. */
export function isEventPreviewSeries(opts: {
  taskIsRecurring?: boolean;
  recurringEventId?: string | null;
}): boolean {
  return Boolean(opts.taskIsRecurring || opts.recurringEventId);
}

/** Edit: series gets a scope menu; one-offs open the editor directly. */
export function planEventPreviewEdit(opts: {
  taskIsRecurring?: boolean;
  recurringEventId?: string | null;
}): EventPreviewEditPlan {
  return isEventPreviewSeries(opts) ? 'series_menu' : 'direct';
}

/**
 * Delete: linked recurring tasks get a scope menu; one-off tasks confirm;
 * Google-only events confirm a Google delete (no app series scopes).
 */
export function planEventPreviewDelete(opts: {
  hasLinkedTask: boolean;
  taskIsRecurring?: boolean;
  recurringEventId?: string | null;
}): EventPreviewDeletePlan {
  if (!opts.hasLinkedTask) return 'confirm_google';
  if (opts.taskIsRecurring || opts.recurringEventId) return 'series_menu';
  return 'confirm_task';
}

/** Map a series delete scope to the calendar mutation used today. */
export function planEventPreviewDeleteMutation(
  scope: SeriesDragScope,
): EventPreviewDeleteMutation {
  if (scope === 'occurrence') return { kind: 'skip_occurrence' };
  if (scope === 'series') return { kind: 'end_series_from' };
  return { kind: 'delete_task' };
}

export type EventPreviewEditTarget =
  | { kind: 'task' }
  | { kind: 'series' }
  | { kind: 'occurrence'; scope: 'occurrence' | 'following' }
  /** A one-day scope without a known day: refuse rather than edit the series. */
  | { kind: 'unsupported' };

/**
 * What «Редагувати» opens for the chosen scope. A one-off (or no scope) is
 * the ordinary editor; «усю серію» is the full editor with the series notice;
 * «лише цей день» / «цей і наступні» open the occurrence editor, which sends
 * only that scope. A chosen scope is never downgraded to the whole series.
 */
export function planEventPreviewEditTarget(opts: {
  taskIsRecurring?: boolean;
  scope?: SeriesDragScope;
  hasOccurrence: boolean;
}): EventPreviewEditTarget {
  if (!opts.taskIsRecurring || !opts.scope) return { kind: 'task' };
  if (opts.scope === 'all') return { kind: 'series' };
  if (!opts.hasOccurrence) return { kind: 'unsupported' };
  return { kind: 'occurrence', scope: opts.scope === 'series' ? 'following' : 'occurrence' };
}
