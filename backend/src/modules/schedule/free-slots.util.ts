import {
  localDateTimeIso,
  normalizeClockHm,
  weekdayIndex,
} from '../voice/voice-local-date.util';

export type MsInterval = { start: number; end: number };

/** Busy segment for the Move timeline UI (labels survive; free calc still merges). */
export type LabeledBusyInterval = MsInterval & {
  label?: string;
  color?: string;
};

export type FreeSlotsPhaseLike = {
  id?: string;
  name?: string;
  color?: string;
  type?: string;
  startTime: string;
  endTime: string;
  weekDays?: number[] | null;
};

const STEP_MS = 15 * 60_000;

export function mergeIntervals(intervals: MsInterval[]): MsInterval[] {
  if (!intervals.length) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const out: MsInterval[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    const last = out[out.length - 1];
    if (cur.start <= last.end) last.end = Math.max(last.end, cur.end);
    else out.push({ ...cur });
  }
  return out;
}

export function subtractInterval(
  free: MsInterval[],
  busy: MsInterval,
): MsInterval[] {
  const out: MsInterval[] = [];
  for (const f of free) {
    if (busy.end <= f.start || busy.start >= f.end) {
      out.push(f);
      continue;
    }
    if (busy.start > f.start)
      out.push({ start: f.start, end: Math.min(busy.start, f.end) });
    if (busy.end < f.end)
      out.push({ start: Math.max(busy.end, f.start), end: f.end });
  }
  return out.filter((x) => x.end > x.start);
}

export function subtractMany(
  free: MsInterval[],
  busyList: MsInterval[],
): MsInterval[] {
  let cur = free;
  for (const b of busyList) {
    cur = cur.flatMap((f) => subtractInterval([f], b));
  }
  return mergeIntervals(cur);
}

function clockOnYmd(ymd: string, timeStr: string, timeZone: string): number {
  return new Date(
    localDateTimeIso(ymd, normalizeClockHm(timeStr), timeZone),
  ).getTime();
}

export function dayWakeSleepMs(
  ymd: string,
  wake: string,
  sleep: string,
  timeZone: string,
): MsInterval {
  const start = clockOnYmd(ymd, wake, timeZone);
  let end = clockOnYmd(ymd, sleep, timeZone);
  if (end <= start) end += 24 * 60 * 60 * 1000;
  return { start, end };
}

function phaseAppliesOnYmd(
  phase: FreeSlotsPhaseLike,
  ymd: string,
): boolean {
  if (!phase.weekDays || phase.weekDays.length === 0) return true;
  return phase.weekDays.includes(weekdayIndex(ymd));
}

export function phaseWindowMs(
  phase: FreeSlotsPhaseLike,
  ymd: string,
  wakeSleep: MsInterval,
  timeZone: string,
): MsInterval | null {
  if (!phaseAppliesOnYmd(phase, ymd)) return null;
  if (phase.type === 'sleep_time') return null;
  let ps = clockOnYmd(ymd, phase.startTime, timeZone);
  let pe = clockOnYmd(ymd, phase.endTime, timeZone);
  if (pe <= ps) pe += 24 * 60 * 60 * 1000;
  const start = Math.max(ps, wakeSleep.start);
  const end = Math.min(pe, wakeSleep.end);
  if (end <= start) return null;
  return { start, end };
}

export type PhaseFocusWindow = {
  id: string;
  startMs: number;
  endMs: number;
};

/**
 * Schedulable phase windows for a civil day (no wake/sleep clip).
 * Mirrors frontend slotPickPhases.phaseWindowsForDay.
 */
export function phaseWindowsForDay(
  phases: FreeSlotsPhaseLike[],
  ymd: string,
  timeZone: string,
): PhaseFocusWindow[] {
  const out: PhaseFocusWindow[] = [];
  for (const phase of phases) {
    if (!phase?.id || phase.type === 'sleep_time') continue;
    if (!phaseAppliesOnYmd(phase, ymd)) continue;
    let startMs = clockOnYmd(ymd, phase.startTime, timeZone);
    let endMs = clockOnYmd(ymd, phase.endTime, timeZone);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
    if (endMs <= startMs) endMs += 24 * 60 * 60 * 1000;
    out.push({ id: phase.id, startMs, endMs });
  }
  return out;
}

/** Tightest phase window containing `focusMs`, or null. */
export function phaseIdAtFocus(
  windows: PhaseFocusWindow[],
  focusMs: number,
): string | null {
  const hits = windows
    .filter((w) => focusMs >= w.startMs && focusMs < w.endMs)
    .sort((a, b) => a.endMs - a.startMs - (b.endMs - b.startMs));
  return hits[0]?.id ?? null;
}

/** Eligible placement windows for the day (phase ∩ wake/sleep, or wake/sleep alone). */
export function eligibleWindowsForDay(
  ymd: string,
  phases: FreeSlotsPhaseLike[],
  wake: string,
  sleep: string,
  timeZone: string,
  weekendOk = true,
): MsInterval[] {
  const ws = dayWakeSleepMs(ymd, wake, sleep, timeZone);
  if (!phases.length) {
    const dow = weekdayIndex(ymd);
    if ((dow === 0 || dow === 6) && !weekendOk) return [];
    return [ws];
  }
  const parts: MsInterval[] = [];
  for (const ph of phases) {
    const w = phaseWindowMs(ph, ymd, ws, timeZone);
    if (w) parts.push(w);
  }
  return mergeIntervals(parts);
}

/** Snap ms up to the next 15-minute boundary (inclusive if already aligned). */
export function ceilToStep(ms: number, stepMs = STEP_MS): number {
  return Math.ceil(ms / stepMs) * stepMs;
}

/**
 * Contiguous starts every `stepMinutes` where [start, start+duration] fits in a free gap.
 */
export function candidateStartsInGaps(
  freeGaps: MsInterval[],
  durationMinutes: number,
  stepMinutes = 15,
): number[] {
  const durationMs = Math.max(1, durationMinutes) * 60_000;
  const stepMs = Math.max(1, stepMinutes) * 60_000;
  const out: number[] = [];
  for (const gap of freeGaps) {
    let cursor = ceilToStep(gap.start, stepMs);
    if (cursor < gap.start) cursor += stepMs;
    while (cursor + durationMs <= gap.end) {
      out.push(cursor);
      cursor += stepMs;
    }
  }
  return out;
}

export function clipBusyToDay(
  busy: MsInterval[],
  day: MsInterval,
): MsInterval[] {
  return mergeIntervals(
    busy
      .map((b) => ({
        start: Math.max(b.start, day.start),
        end: Math.min(b.end, day.end),
      }))
      .filter((b) => b.end > b.start),
  );
}

/** Clip busy to the day without merging so each task/habit keeps its label. */
export function clipBusySegmentsToDay(
  busy: LabeledBusyInterval[],
  day: MsInterval,
): LabeledBusyInterval[] {
  return busy
    .map((b) => ({
      start: Math.max(b.start, day.start),
      end: Math.min(b.end, day.end),
      ...(b.label ? { label: b.label } : {}),
      ...(b.color ? { color: b.color } : {}),
    }))
    .filter((b) => b.end > b.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

export function buildFreeSlotsPlan(input: {
  ymd: string;
  wake: string;
  sleep: string;
  timeZone: string;
  phases: FreeSlotsPhaseLike[];
  busy: LabeledBusyInterval[];
  durationMinutes: number;
  weekendOk?: boolean;
  stepMinutes?: number;
  /** When true (default), if no phase window applies that day, use wake→sleep. */
  fallBackToWakeSleep?: boolean;
}): {
  day: MsInterval;
  free: MsInterval[];
  /** Merged busy — used only for free/candidate math. */
  busyInDay: MsInterval[];
  /** Per-source busy clipped to the day (labels for the Move timeline). */
  busySegments: LabeledBusyInterval[];
  candidates: number[];
  usedWakeSleepFallback: boolean;
} {
  const day = dayWakeSleepMs(
    input.ymd,
    input.wake,
    input.sleep,
    input.timeZone,
  );
  let usedWakeSleepFallback = false;
  let eligible = eligibleWindowsForDay(
    input.ymd,
    input.phases,
    input.wake,
    input.sleep,
    input.timeZone,
    input.weekendOk ?? true,
  );
  if (
    !eligible.length &&
    input.phases.length > 0 &&
    input.fallBackToWakeSleep !== false
  ) {
    usedWakeSleepFallback = true;
    eligible = eligibleWindowsForDay(
      input.ymd,
      [],
      input.wake,
      input.sleep,
      input.timeZone,
      input.weekendOk ?? true,
    );
  }
  const busySegments = clipBusySegmentsToDay(input.busy, day);
  const busyInDay = clipBusyToDay(input.busy, day);
  const free = subtractMany(eligible, busyInDay);
  const candidates = candidateStartsInGaps(
    free,
    input.durationMinutes,
    input.stepMinutes ?? 15,
  );
  return {
    day,
    free,
    busyInDay,
    busySegments,
    candidates,
    usedWakeSleepFallback,
  };
}
