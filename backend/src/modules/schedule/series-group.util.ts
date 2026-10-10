import {
  localHm,
  localYmd,
  weekdayIndex,
} from '../voice/voice-local-date.util';

/**
 * User-facing fields other than time / phase. Touching any of these drops
 * series-group membership permanently. Inbox / park / status patches do not.
 */
const MEMBERSHIP_BREAKING_KEYS = new Set([
  'name',
  'description',
  'location',
  'priority',
  'googleColorId',
  'googleVisibility',
  'googleTransparency',
  'googleReminders',
  'eventType',
  'isRecurring',
  'recurrencePattern',
  'recurrenceWeekDays',
  'allowSplit',
  'deadline',
  'earliestStartTime',
  'eligibleWeekDays',
]);

/**
 * True when the patch edits identity/content fields (not time or phase) —
 * the task must leave its series group permanently.
 */
export function breaksSeriesMembership(
  patch: Record<string, unknown> | null | undefined,
): boolean {
  if (!patch) return false;
  for (const key of Object.keys(patch)) {
    if (patch[key] === undefined) continue;
    if (MEMBERSHIP_BREAKING_KEYS.has(key)) return true;
  }
  return false;
}

export function groupYmdsByClockHm(
  slots: Array<{ ymd: string; hm: string }>,
): Map<string, string[]> {
  const byHm = new Map<string, string[]>();
  for (const slot of slots) {
    const list = byHm.get(slot.hm) ?? [];
    list.push(slot.ymd);
    byHm.set(slot.hm, list);
  }
  for (const [hm, ymds] of byHm) {
    byHm.set(hm, [...ymds].sort());
  }
  return byHm;
}

/**
 * Largest clock group wins. Ties prefer `preferredHm`, then lexicographic hm.
 */
export function pickPrimaryClockHm(
  byHm: Map<string, string[]>,
  preferredHm?: string | null,
): string {
  let bestHm = '';
  let bestCount = -1;
  for (const [hm, ymds] of byHm) {
    const count = ymds.length;
    if (count > bestCount) {
      bestCount = count;
      bestHm = hm;
      continue;
    }
    if (count < bestCount) continue;
    if (preferredHm && hm === preferredHm) {
      bestHm = hm;
      continue;
    }
    if (preferredHm && bestHm === preferredHm) continue;
    if (hm < bestHm || !bestHm) bestHm = hm;
  }
  return bestHm;
}

/**
 * Google RRULE DTSTART must follow the majority local clock among open seats,
 * not chronological open[0] (a single shifted day used to rewrite the series).
 * Returns the earliest seat on that majority clock; falls back to slots[0].
 */
export function pickMajorityClockSlot<
  T extends { scheduledStartTime: Date; scheduledEndTime: Date },
>(
  slots: T[],
  timeZone: string,
  preferredHm?: string | null,
): T | null {
  if (!slots.length) return null;
  const stamped = slots.map((slot) => {
    const iso = new Date(slot.scheduledStartTime).toISOString();
    return {
      slot,
      ymd: localYmd(iso, timeZone),
      hm: localHm(iso, timeZone),
      startMs: new Date(slot.scheduledStartTime).getTime(),
    };
  });
  const byHm = groupYmdsByClockHm(
    stamped.map(({ ymd, hm }) => ({ ymd, hm })),
  );
  const primaryHm = pickPrimaryClockHm(byHm, preferredHm);
  const onPrimary = stamped
    .filter((row) => row.hm === primaryHm)
    .sort((a, b) => a.startMs - b.startMs);
  return onPrimary[0]?.slot ?? slots[0];
}

export function weekDaysFromYmds(ymds: string[]): number[] {
  const days = new Set<number>();
  for (const ymd of ymds) days.add(weekdayIndex(ymd));
  return [...days].sort((a, b) => a - b);
}
