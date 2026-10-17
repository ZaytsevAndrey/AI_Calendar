import type { TaskDTO } from 'api/tasks.api';
import type { SeriesDragScope } from 'modules/schedule/seriesDragChoice';

export type EventPreviewEditPlan = 'direct' | 'series_menu';

/** Done on calendar preview: one-off app tasks only (same gate as Now strip). */
export function canCompleteFromPreview(
  task: Pick<TaskDTO, 'isRecurring' | 'isFixedExternal' | 'status'> | null,
): boolean {
  if (!task) return false;
  if (task.isRecurring || task.isFixedExternal) return false;
  if (task.status === 'completed' || task.status === 'canceled') return false;
  return true;
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
