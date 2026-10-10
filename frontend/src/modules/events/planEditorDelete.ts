import type { TaskDTO } from 'api/tasks.api';

export type EditorDeletePlan =
  | { kind: 'confirm_one_off' }
  | { kind: 'confirm_entire_series' }
  | { kind: 'ask_series_scope' };

/** How the edit-modal delete flow should ask before mutating. */
export function planEditorDelete(
  task: Pick<TaskDTO, 'isRecurring'>,
  occurrence: { startIso?: string } | null | undefined,
): EditorDeletePlan {
  if (task.isRecurring) {
    if (occurrence?.startIso) return { kind: 'ask_series_scope' };
    return { kind: 'confirm_entire_series' };
  }
  return { kind: 'confirm_one_off' };
}
