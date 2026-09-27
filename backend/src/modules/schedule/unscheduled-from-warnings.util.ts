import {
  SchedulingWarning,
  SchedulingWarningCode,
} from './intelligent-scheduling.engine';

/**
 * Task ids that should land in the Unscheduled inbox after a schedule job
 * (deadline / From–Until with no fit). Not Problematic.
 */
export function collectUnscheduledTaskIds(
  warnings: SchedulingWarning[],
): Set<string> {
  const ids = new Set<string>();
  for (const warning of warnings) {
    if (
      warning.code === SchedulingWarningCode.NEEDS_CONFLICT_CHOICE ||
      !warning.taskId ||
      !warning.meta ||
      warning.meta.readyForUnscheduled !== true
    ) {
      continue;
    }
    ids.add(warning.taskId);
  }
  return ids;
}
