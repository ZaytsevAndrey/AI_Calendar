/** Pure helpers for the Problematic Move slot-pick timeline. */

import { isoToHm, localDateTimeIso } from '../../utils/ianaDateTime';

/** Tall enough that a 30-min block is readable; also slows wheel→time mapping. */
export const SLOT_PX_PER_HOUR = 180;
export const SLOT_STEP_MIN = 15;
/** Minimum ghost card height so the task title stays visible. */
export const SLOT_GHOST_MIN_PX = 64;
/** Wheel delta multiplier — native wheel jumps hours at 180px/h without this. */
export const SLOT_WHEEL_FACTOR = 0.32;

export function msToMinOfDay(ms: number, dayStartMs: number): number {
  return (ms - dayStartMs) / 60_000;
}

export function minToPx(min: number): number {
  return (min / 60) * SLOT_PX_PER_HOUR;
}

export function pxToMin(px: number): number {
  return (px / SLOT_PX_PER_HOUR) * 60;
}

/** Index of candidate whose start is nearest to `targetMs`. */
export function nearestCandidateIndex(
  candidatesMs: number[],
  targetMs: number,
): number {
  if (!candidatesMs.length) return -1;
  let best = 0;
  let bestDist = Math.abs(candidatesMs[0] - targetMs);
  for (let i = 1; i < candidatesMs.length; i++) {
    const d = Math.abs(candidatesMs[i] - targetMs);
    if (d < bestDist) {
      best = i;
      bestDist = d;
    }
  }
  return best;
}

/**
 * Index of a free candidate at `focusMs`, or -1 when that instant is not bookable.
 * Call with a 15-min-snapped focus; default tolerance is 2s for float/ISO noise.
 */
export function placeableCandidateIndex(
  candidatesMs: number[],
  focusMs: number,
  maxDistMs: number = 2_000,
): number {
  const idx = nearestCandidateIndex(candidatesMs, focusMs);
  if (idx < 0) return -1;
  if (Math.abs(candidatesMs[idx] - focusMs) > maxDistMs) return -1;
  return idx;
}

/** True when [start, start+duration] sits inside a free gap (inclusive, 1s slack). */
export function startFitsInFreeGap(
  startMs: number,
  durationMin: number,
  free: { start: number; end: number }[],
): boolean {
  const endMs = startMs + Math.max(1, durationMin) * 60_000;
  return free.some(
    (g) => startMs >= g.start - 1000 && endMs <= g.end + 1000,
  );
}

/**
 * Resolve a bookable start ISO at a 15-min-snapped focus, or null.
 * Exact API candidates win first; otherwise allow any on-grid start that
 * still fits inside a free band (duration inclusive).
 */
export function resolvePlaceableStartIso(
  snappedMs: number,
  durationMin: number,
  candidates: string[],
  candidatesMs: number[],
  free: { start: number; end: number }[],
): string | null {
  const exact = placeableCandidateIndex(candidatesMs, snappedMs, 2_000);
  if (exact >= 0) return candidates[exact];
  if (free.length > 0 && startFitsInFreeGap(snappedMs, durationMin, free)) {
    return new Date(snappedMs).toISOString();
  }
  return null;
}

/** Snap an instant to the 15-min grid relative to day start. */
export function snapMsToStep(
  ms: number,
  dayStartMs: number,
  stepMin: number = SLOT_STEP_MIN,
): number {
  const min = msToMinOfDay(ms, dayStartMs);
  const snapped = Math.round(min / stepMin) * stepMin;
  return dayStartMs + snapped * 60_000;
}

/** The preferred wall clock moved onto `ymd`, so another day keeps the old time of day. */
export function preferredMsOnDay(
  preferredIso: string | null | undefined,
  ymd: string,
  timeZone: string,
): number | null {
  const hm = isoToHm(preferredIso ?? undefined, timeZone);
  if (!hm) return null;
  const ms = Date.parse(localDateTimeIso(ymd, hm, timeZone));
  return Number.isFinite(ms) ? ms : null;
}

/** Prefer first candidate at/after preferred, else first at/after now, else mid-day, else first. */
export function initialCandidateIndex(
  candidatesMs: number[],
  dayStartMs: number,
  dayEndMs: number,
  preferredMs: number | null,
  nowMs: number = Date.now(),
): number {
  if (!candidatesMs.length) return -1;
  if (preferredMs != null) {
    const atOrAfter = candidatesMs.findIndex((ms) => ms >= preferredMs);
    if (atOrAfter >= 0) return atOrAfter;
  }
  const future = candidatesMs.findIndex((ms) => ms >= nowMs - 60_000);
  if (future >= 0) return future;
  const mid = dayStartMs + (dayEndMs - dayStartMs) / 2;
  return nearestCandidateIndex(candidatesMs, mid);
}

/**
 * Up to `count` distinct starts to offer as one-tap chips: the candidate
 * nearest the old clock (or the first one), then the next nearest that do
 * not overlap an already picked start. Sorted by time.
 */
export function suggestedStarts(
  candidatesMs: number[],
  preferredMs: number | null,
  durationMin: number,
  count = 3,
): number[] {
  if (!candidatesMs.length) return [];
  const anchor = preferredMs ?? candidatesMs[0];
  const gapMs = Math.max(SLOT_STEP_MIN, durationMin) * 60_000;
  const byDistance = [...candidatesMs].sort(
    (a, b) => Math.abs(a - anchor) - Math.abs(b - anchor) || a - b,
  );
  const picked: number[] = [];
  for (const ms of byDistance) {
    if (picked.length >= count) break;
    if (picked.every((p) => Math.abs(p - ms) >= gapMs)) picked.push(ms);
  }
  return picked.sort((a, b) => a - b);
}

/** Where the timeline opens: the best suggestion, else the first free gap, else mid-day. */
export function initialFocusMs(
  candidatesMs: number[],
  free: { start: number; end: number }[],
  dayStartMs: number,
  dayEndMs: number,
  preferredMs: number | null,
  nowMs: number = Date.now(),
): number {
  const idx = initialCandidateIndex(
    candidatesMs,
    dayStartMs,
    dayEndMs,
    preferredMs,
    nowMs,
  );
  if (idx >= 0) return candidatesMs[idx];
  if (free.length) return snapMsToStep(free[0].start, dayStartMs);
  return snapMsToStep(dayStartMs + (dayEndMs - dayStartMs) / 2, dayStartMs);
}

/** Next (dir 1) or previous (dir -1) candidate strictly past `focusMs`, or null. */
export function adjacentCandidateMs(
  candidatesMs: number[],
  focusMs: number,
  dir: 1 | -1,
): number | null {
  const sorted = [...candidatesMs].sort((a, b) => a - b);
  if (dir > 0) return sorted.find((ms) => ms > focusMs + 1000) ?? null;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i] < focusMs - 1000) return sorted[i];
  }
  return null;
}

/** Keep a focus instant inside [dayStart, dayEnd − duration]. */
export function clampFocusMs(
  ms: number,
  dayStartMs: number,
  dayEndMs: number,
  durationMin: number,
): number {
  const last = Math.max(dayStartMs, dayEndMs - durationMin * 60_000);
  return Math.min(Math.max(ms, dayStartMs), last);
}

export function formatHmFromIso(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(iso));
  } catch {
    return iso.slice(11, 16);
  }
}
