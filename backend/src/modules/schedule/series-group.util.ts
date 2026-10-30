import {
  localDateTimeIso,
  localHm,
  localYmd,
  normalizeClockHm,
  weekdayIndex,
} from '../voice/voice-local-date.util';

/**
 * Wall clock (HH:mm) of a series day. A start that is the DST-shifted
 * instant of `clock` on its civil day (02:30 on a spring-forward day starts
 * at 03:30) still counts as `clock`, so that day stays in the series.
 */
export function seriesDayClockHm(
  startMs: number,
  timeZone: string,
  clock: string | null | undefined,
): string {
  const iso = new Date(startMs).toISOString();
  const hm = normalizeClockHm(localHm(iso, timeZone));
  if (!clock || hm === clock) return hm;
  const ymd = localYmd(iso, timeZone);
  return Date.parse(localDateTimeIso(ymd, clock, timeZone)) === startMs ? clock : hm;
}

/**
 * Structural fields: changing one of these turns the task into something
 * other than "a day of this series" (another repeat rule, another window,
 * another behaviour), so the task leaves its series group for good.
 * Content fields (name, notes, look) do not: an edited occurrence keeps its
 * lineage, and `contentDiffersFromSeries` keeps re-merge from swallowing it.
 */
const MEMBERSHIP_BREAKING_KEYS = new Set([
  'eventType',
  'isRecurring',
  'recurrencePattern',
  'recurrenceWeekDays',
  'allowSplit',
  'deadline',
  'earliestStartTime',
  'eligibleWeekDays',
]);

/** Content a day copy may carry on its own; a copy that differs here never re-merges. */
const CONTENT_KEYS = [
  'name',
  'description',
  'location',
  'priority',
  'googleColorId',
  'googleVisibility',
  'googleTransparency',
  'googleReminders',
] as const;

/**
 * True when the copy's own content (name, notes, look, phase, state) no
 * longer matches its series: merging it back would throw that away.
 */
export function contentDiffersFromSeries(
  copy: Record<string, unknown> & { status?: string; phaseId?: string | null; eventType?: string },
  series: Record<string, unknown> & { status?: string; phaseId?: string | null; eventType?: string },
): boolean {
  if (copy.status !== undefined && copy.status !== 'todo') return true;
  if ((copy.phaseId ?? null) !== (series.phaseId ?? null)) return true;
  if ((copy.eventType ?? null) !== (series.eventType ?? null)) return true;
  for (const key of CONTENT_KEYS) {
    if (canonicalMembershipValue(key, copy[key]) !== canonicalMembershipValue(key, series[key])) {
      return true;
    }
  }
  return false;
}

/**
 * Canonical form of a membership field for comparison: empty strings, null
 * and undefined are the same "unset"; dates compare as instants; weekday
 * lists compare as sorted sets (empty = null = no filter); JSON (reminders)
 * compares structurally.
 */
function canonicalMembershipValue(key: string, value: unknown): string {
  if (value === undefined || value === null) return 'null';
  if (typeof value === 'string' && value.trim() === '') return 'null';
  if (key === 'deadline' || key === 'earliestStartTime') {
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? `raw:${String(value)}` : date.toISOString();
  }
  if (key === 'recurrenceWeekDays' || key === 'eligibleWeekDays') {
    if (!Array.isArray(value) || value.length === 0) return 'null';
    return JSON.stringify([...new Set(value.map(Number))].sort((a, b) => a - b));
  }
  if (key === 'googleReminders') {
    const row = value as { useDefault?: boolean; overrides?: unknown[] };
    if (row.useDefault !== false) return 'default';
    const overrides = (row.overrides ?? []).map((o) => JSON.stringify(o)).sort();
    return `custom:${overrides.join('|')}`;
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * True when the patch edits identity/content fields (not time or phase) —
 * the task must leave its series group permanently.
 *
 * With `current`, a key counts only when its value differs from the stored
 * task: a form that sends every field back (same name, same priority) keeps
 * a day copy in its series. Without `current` the mere presence of a key
 * counts (legacy behaviour).
 */
export function breaksSeriesMembership(
  patch: Record<string, unknown> | null | undefined,
  current?: Record<string, unknown> | null,
): boolean {
  if (!patch) return false;
  for (const key of Object.keys(patch)) {
    if (patch[key] === undefined) continue;
    if (!MEMBERSHIP_BREAKING_KEYS.has(key)) continue;
    if (!current) return true;
    if (
      canonicalMembershipValue(key, patch[key]) !==
      canonicalMembershipValue(key, current[key])
    ) {
      return true;
    }
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
