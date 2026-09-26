import type {
  SchedulingConflict,
  SchedulingWarning,
} from './intelligent-scheduling.engine';

/** Task ids that should land in the Problematic inbox after a schedule job. */
export function collectProblematicTaskIds(
  warnings: SchedulingWarning[],
  conflicts: SchedulingConflict[],
): Set<string> {
  const ids = new Set<string>();
  for (const warning of warnings) {
    if (
      warning.taskId &&
      warning.meta &&
      warning.meta.readyForProblematic === true
    ) {
      ids.add(warning.taskId);
    }
  }
  for (const conflict of conflicts) {
    if (conflict.taskId) ids.add(conflict.taskId);
  }
  return ids;
}
