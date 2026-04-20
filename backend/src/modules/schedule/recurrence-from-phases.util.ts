import { Phase } from '../event-phases/entities/phase.entity';

const RRULE_BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

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

export function rruleByDayFromJsWeekdays(days: number[]): string {
  return [...new Set(days)]
    .sort((a, b) => a - b)
    .map((d) => RRULE_BYDAY[d] ?? 'SU')
    .join(',');
}
