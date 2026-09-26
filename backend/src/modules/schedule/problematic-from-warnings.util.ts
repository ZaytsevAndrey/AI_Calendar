import {
  SchedulingConflict,
  SchedulingWarning,
  SchedulingWarningCode,
} from './intelligent-scheduling.engine';

/**
 * Task ids that should land in the Problematic inbox after a schedule job.
 * Conflict choices (`NEEDS_CONFLICT_CHOICE` / conflicts[]) wait for the shared
 * options sheet — they are not parked until leave_problematic / dismiss.
 */
export function collectProblematicTaskIds(
  warnings: SchedulingWarning[],
  _conflicts: SchedulingConflict[] = [],
): Set<string> {
  const ids = new Set<string>();
  for (const warning of warnings) {
    if (
      warning.code === SchedulingWarningCode.NEEDS_CONFLICT_CHOICE ||
      !warning.taskId ||
      !warning.meta ||
      warning.meta.readyForProblematic !== true
    ) {
      continue;
    }
    ids.add(warning.taskId);
  }
  return ids;
}
