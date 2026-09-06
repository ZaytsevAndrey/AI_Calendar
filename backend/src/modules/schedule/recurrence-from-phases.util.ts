import { Phase } from '../event-phases/entities/phase.entity';

export function normalizeWeekDays(days?: number[] | null): number[] | null {
  if (!days?.length) return null;
  const uniq = [
    ...new Set(days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)),
  ].sort((a, b) => a - b);
  if (!uniq.length || uniq.length === 7) return null;
  return uniq;
}

/**
 * If phases restrict calendar days (weekDays non-empty), returns that set.
 * Intersection when multiple phases each restrict — null means "any day" (no restriction from phases).
 */
export function effectiveRecurrenceWeekDaysFromPhases(
  phases: Phase[],
): number[] | null {
  if (!phases.length) return null;
  let acc: number[] | null = null;
  for (const p of phases) {
    const wd = p.weekDays;
    if (!wd?.length) continue;
    if (acc === null) acc = [...wd];
    else acc = acc.filter((d) => wd.includes(d));
  }
  if (acc === null) return null;
  if (!acc.length) return null;
  return [...new Set(acc)].sort((a, b) => a - b);
}

/**
 * Task weekdays intersect phase weekdays.
 * Null = no restriction. Empty array = no overlapping valid day.
 */
export function effectiveRecurrenceWeekDays(
  taskWeekDays: number[] | null | undefined,
  phases: Phase[],
): number[] | null {
  const fromTask = normalizeWeekDays(taskWeekDays);
  const fromPhase = effectiveRecurrenceWeekDaysFromPhases(phases);
  if (fromTask && fromPhase) {
    return fromTask.filter((d) => fromPhase.includes(d));
  }
  return fromTask ?? fromPhase;
}
