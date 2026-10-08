import type { ConflictOptionId, SchedulingConflictDTO } from './conflictChoiceBus';
import type { SkipOccurrenceDTO, UpdateTaskDTO } from 'api/tasks.api';

type ApplyDeps = {
  updateTask: (id: string, body: UpdateTaskDTO) => Promise<unknown>;
  skipOccurrence: (id: string, body: SkipOccurrenceDTO) => Promise<unknown>;
};

function parkPayload(conflict: SchedulingConflictDTO): UpdateTaskDTO {
  const ymds: string[] = [];
  const meta = conflict.meta;
  if (meta && Array.isArray(meta.skipped)) {
    for (const row of meta.skipped) {
      if (!row || typeof row !== 'object') continue;
      const dateKey = (row as { dateKey?: unknown }).dateKey;
      if (typeof dateKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
        ymds.push(dateKey);
      }
    }
  }
  const single =
    typeof meta?.occurrenceYmd === 'string'
      ? meta.occurrenceYmd
      : typeof meta?.preferredStart === 'string'
        ? meta.preferredStart.slice(0, 10)
        : null;
  if (single && /^\d{4}-\d{2}-\d{2}$/.test(single) && !ymds.includes(single)) {
    ymds.push(single);
  }
  ymds.sort();
  return {
    scheduleState: 'problematic',
    problematicReason: conflict.reason,
    ...(ymds.length ? { problematicOccurrenceYmds: ymds } : {}),
  };
}

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
      await deps.updateTask(conflict.taskId, parkPayload(conflict));
      return;
    case 'move_new':
      await deps.updateTask(conflict.taskId, {
        scheduleState: 'none',
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
      await deps.updateTask(conflict.taskId, { scheduleState: 'none' });
      return;
    }
    case 'move_other':
      // Engine does not emit this for fixed blockers yet; keep preferred and clear park.
      await deps.updateTask(conflict.taskId, { scheduleState: 'none' });
      return;
    default:
      await deps.updateTask(conflict.taskId, parkPayload(conflict));
  }
}
