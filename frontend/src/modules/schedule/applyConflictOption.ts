import type { ConflictOptionId, SchedulingConflictDTO } from './conflictChoiceBus';
import type { SkipOccurrenceDTO, UpdateTaskDTO } from 'api/tasks.api';

type ApplyDeps = {
  updateTask: (id: string, body: UpdateTaskDTO) => Promise<unknown>;
  skipOccurrence: (id: string, body: SkipOccurrenceDTO) => Promise<unknown>;
};

/**
 * Apply a structured conflict option using existing task APIs.
 * move_other is reserved until the engine emits a movable blocker.
 */
export async function applyConflictOption(
  conflict: SchedulingConflictDTO,
  optionId: ConflictOptionId,
  deps: ApplyDeps,
): Promise<void> {
  switch (optionId) {
    case 'leave_problematic':
      await deps.updateTask(conflict.taskId, { isProblematic: true });
      return;
    case 'move_new':
      await deps.updateTask(conflict.taskId, {
        isProblematic: false,
        scheduledStartTime: null,
        scheduledEndTime: null,
      });
      return;
    case 'skip_occurrence': {
      const preferredStart =
        typeof conflict.meta?.preferredStart === 'string'
          ? conflict.meta.preferredStart
          : typeof conflict.meta?.occurrenceYmd === 'string'
            ? `${conflict.meta.occurrenceYmd}T12:00:00.000Z`
            : new Date().toISOString();
      await deps.skipOccurrence(conflict.taskId, {
        occurrenceStart: preferredStart,
      });
      await deps.updateTask(conflict.taskId, { isProblematic: false });
      return;
    }
    case 'move_other':
      // Engine does not emit this for fixed blockers yet; keep preferred and clear park.
      await deps.updateTask(conflict.taskId, { isProblematic: false });
      return;
    default:
      await deps.updateTask(conflict.taskId, { isProblematic: true });
  }
}
