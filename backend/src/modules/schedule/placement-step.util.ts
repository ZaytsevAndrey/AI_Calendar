import type { ConflictOptionId, SchedulingConflict } from './intelligent-scheduling.engine';
import {
  candidateStartsInGaps,
  mergeIntervals,
  type MsInterval,
  subtractMany,
} from './free-slots.util';
import {
  addDaysToYmd,
  addMonthsToYmd,
  weekdayIndex,
} from '../voice/voice-local-date.util';

export type PlacementSeatRole =
  | 'anchor'
  | 'resolved'
  | 'flexible'
  | 'series'
  | 'elapsed';

export type PlacementSeat = {
  id: string;
  taskId: string;
  taskName: string;
  role: PlacementSeatRole;
  start: number;
  end: number;
  occurrenceYmd?: string;
  windows: MsInterval[];
  notBefore: number;
  /** Fixed tasks and external Google events. Buffer is soft around these only. */
  buffered?: boolean;
};

export type PlacementClaim = {
  taskId: string;
  taskName: string;
  recurring: boolean;
  durationMinutes: number;
  notBefore: number;
  windows: MsInterval[];
  /** When omitted, the claimant takes the nearest free hole and nobody else moves. */
  interval?: MsInterval | null;
  /** Deadline or From–Until is already over. */
  windowExpired?: boolean;
  /** Fixed clocks may sit outside a phase window. */
  mustFitWindow?: boolean;
};

export type PlacementMove =
  | {
      kind: 'shift';
      seatId: string;
      taskId: string;
      start: number;
      end: number;
    }
  | {
      kind: 'park';
      seatId: string;
      taskId: string;
      reason: string;
    }
  | {
      kind: 'detach';
      seatId: string;
      taskId: string;
      occurrenceYmd: string;
      start: number | null;
      end: number | null;
      originalStart: number;
      originalEnd: number;
      reason: string | null;
    };

export type PlacementPlan =
  | {
      outcome: 'seated';
      start: number;
      end: number;
      moves: PlacementMove[];
    }
  | { outcome: 'conflict'; conflict: SchedulingConflict }
  | { outcome: 'problematic'; reason: string }
  | { outcome: 'unscheduled' };

const MAX_CHAIN_PULLS = 6;

function overlaps(a: MsInterval, b: MsInterval): boolean {
  return a.start < b.end && b.start < a.end;
}

function minutesOf(seat: PlacementSeat): number {
  return Math.max(1, Math.round((seat.end - seat.start) / 60_000));
}

function fitsWindow(interval: MsInterval, windows: MsInterval[]): boolean {
  return windows.some(
    (window) => interval.start >= window.start && interval.end <= window.end,
  );
}

function findHole(opts: {
  durationMinutes: number;
  notBefore: number;
  windows: MsInterval[];
  hard: MsInterval[];
  soft: MsInterval[];
}): MsInterval | null {
  const durationMs = Math.max(1, opts.durationMinutes) * 60_000;
  const search = (blocked: MsInterval[]): MsInterval | null => {
    let best: number | null = null;
    for (const window of opts.windows) {
      const free = subtractMany([window], blocked);
      for (const start of candidateStartsInGaps(free, opts.durationMinutes)) {
        if (start < opts.notBefore) continue;
        if (start + durationMs > window.end) continue;
        if (best === null || start < best) best = start;
      }
    }
    if (best === null) return null;
    return { start: best, end: best + durationMs };
  };
  return (
    search(mergeIntervals([...opts.hard, ...opts.soft])) ?? search(opts.hard)
  );
}

function softBusy(seats: PlacementSeat[], bufferMinutes: number): MsInterval[] {
  if (bufferMinutes <= 0) return [];
  const pad = bufferMinutes * 60_000;
  return mergeIntervals(
    seats
      .filter((seat) => seat.buffered && seat.end > seat.start)
      .map((seat) => ({ start: seat.start - pad, end: seat.end + pad })),
  );
}

function conflictFor(claim: PlacementClaim, interval: MsInterval): SchedulingConflict {
  const options: ConflictOptionId[] = claim.recurring
    ? ['move_new', 'skip_occurrence', 'leave_problematic']
    : ['move_new', 'leave_problematic'];
  return {
    taskId: claim.taskId,
    taskName: claim.taskName,
    reason: 'preferred_on_fixed',
    options,
    meta: {
      preferredStart: new Date(interval.start).toISOString(),
      preferredEnd: new Date(interval.end).toISOString(),
    },
  };
}

function moveFor(
  seat: PlacementSeat,
  hole: MsInterval | null,
  reason: string,
): PlacementMove {
  if (seat.role === 'series' && seat.occurrenceYmd) {
    return {
      kind: 'detach',
      seatId: seat.id,
      taskId: seat.taskId,
      occurrenceYmd: seat.occurrenceYmd,
      start: hole?.start ?? null,
      end: hole?.end ?? null,
      originalStart: seat.start,
      originalEnd: seat.end,
      reason: hole ? null : reason,
    };
  }
  if (!hole) {
    return { kind: 'park', seatId: seat.id, taskId: seat.taskId, reason };
  }
  return {
    kind: 'shift',
    seatId: seat.id,
    taskId: seat.taskId,
    start: hole.start,
    end: hole.end,
  };
}

/**
 * Place `people` into holes. When `pullThirds` is set, a hole that exists
 * only by moving another flexible or series day pulls that day in.
 * Returns null when someone in the set still has no seat.
 */
function reseat(
  people: PlacementSeat[],
  claimant: MsInterval,
  seats: PlacementSeat[],
  soft: MsInterval[],
  pullThirds: boolean,
): Map<string, MsInterval> | null {
  const vacated = new Set(people.map((seat) => seat.id));
  const pending = [...people];
  const assigned = new Map<string, MsInterval>();
  let pulls = 0;
  let spins = 0;

  while (pending.length) {
    if (++spins > 40) return null;
    const person = pending[0];
    const hard = blockedIntervals(claimant, seats, vacated, assigned);
    const hole = findHole({
      durationMinutes: minutesOf(person),
      notBefore: person.notBefore,
      windows: person.windows,
      hard,
      soft,
    });
    if (hole) {
      pending.shift();
      assigned.set(person.id, hole);
      continue;
    }
    if (!pullThirds || pulls >= MAX_CHAIN_PULLS) return null;
    const relaxedHard = blockedIntervals(
      claimant,
      seats.filter(
        (seat) => seat.role !== 'flexible' && seat.role !== 'series',
      ),
      vacated,
      assigned,
    );
    const relaxed = findHole({
      durationMinutes: minutesOf(person),
      notBefore: person.notBefore,
      windows: person.windows,
      hard: relaxedHard,
      soft,
    });
    if (!relaxed) return null;
    const blockers = seats.filter(
      (seat) =>
        (seat.role === 'flexible' || seat.role === 'series') &&
        !vacated.has(seat.id) &&
        overlaps(seat, relaxed),
    );
    if (!blockers.length) return null;
    pulls += 1;
    for (const blocker of blockers) {
      vacated.add(blocker.id);
      pending.push(blocker);
    }
  }
  return assigned;
}

function blockedIntervals(
  claimant: MsInterval,
  seats: PlacementSeat[],
  vacated: Set<string>,
  assigned: Map<string, MsInterval>,
): MsInterval[] {
  const hard: MsInterval[] = [claimant];
  for (const seat of seats) {
    if (vacated.has(seat.id)) continue;
    hard.push({ start: seat.start, end: seat.end });
  }
  for (const interval of assigned.values()) hard.push(interval);
  return hard;
}

function reseatDirectOnly(
  direct: PlacementSeat[],
  claimant: MsInterval,
  seats: PlacementSeat[],
  soft: MsInterval[],
): Map<string, MsInterval> {
  const vacated = new Set(direct.map((seat) => seat.id));
  const assigned = new Map<string, MsInterval>();
  for (const person of direct) {
    const hard = blockedIntervals(claimant, seats, vacated, assigned);
    const hole = findHole({
      durationMinutes: minutesOf(person),
      notBefore: person.notBefore,
      windows: person.windows,
      hard,
      soft,
    });
    if (hole) assigned.set(person.id, hole);
  }
  return assigned;
}

/**
 * One placement step. Writes the claimant and only the days that must move
 * for every touched event to keep a seat. A chain that cannot seat everyone
 * leaves third parties where they are.
 */
export function planPlacement(input: {
  claim: PlacementClaim;
  seats: PlacementSeat[];
  bufferMinutes?: number;
}): PlacementPlan {
  const claim = input.claim;
  const bufferMinutes = input.bufferMinutes ?? 0;
  const others = input.seats.filter((seat) => seat.taskId !== claim.taskId);
  const soft = softBusy(others, bufferMinutes);

  if (claim.windowExpired) return { outcome: 'unscheduled' };

  const interval = claim.interval;
  if (!interval) {
    const hole = findHole({
      durationMinutes: claim.durationMinutes,
      notBefore: claim.notBefore,
      windows: claim.windows,
      hard: others.map((seat) => ({ start: seat.start, end: seat.end })),
      soft,
    });
    if (!hole) return { outcome: 'problematic', reason: 'no_slot' };
    return { outcome: 'seated', start: hole.start, end: hole.end, moves: [] };
  }

  const blocking = others.filter(
    (seat) =>
      (seat.role === 'anchor' || seat.role === 'elapsed') &&
      overlaps(seat, interval),
  );
  if (blocking.length) {
    return { outcome: 'conflict', conflict: conflictFor(claim, interval) };
  }

  if (claim.mustFitWindow !== false && !fitsWindow(interval, claim.windows)) {
    return { outcome: 'problematic', reason: 'phase_full' };
  }

  const resolvedHit = others.some(
    (seat) => seat.role === 'resolved' && overlaps(seat, interval),
  );
  if (resolvedHit) {
    const hole = findHole({
      durationMinutes: claim.durationMinutes,
      notBefore: claim.notBefore,
      windows: claim.windows,
      hard: others.map((seat) => ({ start: seat.start, end: seat.end })),
      soft,
    });
    if (!hole) return { outcome: 'problematic', reason: 'no_slot' };
    return { outcome: 'seated', start: hole.start, end: hole.end, moves: [] };
  }

  const direct = others.filter(
    (seat) =>
      (seat.role === 'flexible' || seat.role === 'series') &&
      overlaps(seat, interval),
  );
  if (!direct.length) {
    return {
      outcome: 'seated',
      start: interval.start,
      end: interval.end,
      moves: [],
    };
  }

  const claimantInterval = { start: interval.start, end: interval.end };
  const chained = reseat(direct, claimantInterval, others, soft, true);
  const assigned =
    chained ?? reseatDirectOnly(direct, claimantInterval, others, soft);
  const movedIds = new Set(chained ? chained.keys() : direct.map((seat) => seat.id));
  const moves: PlacementMove[] = [];
  for (const seat of others) {
    if (!movedIds.has(seat.id)) continue;
    if (seat.role !== 'flexible' && seat.role !== 'series') continue;
    moves.push(moveFor(seat, assigned.get(seat.id) ?? null, 'no_slot'));
  }
  return {
    outcome: 'seated',
    start: interval.start,
    end: interval.end,
    moves,
  };
}

/**
 * Civil days after `anchorYmd` and before `horizonEndYmd` for one series.
 * The anchor day itself is already seated by the first placement.
 */
export function seriesOccurrenceYmds(input: {
  anchorYmd: string;
  horizonEndYmd: string;
  pattern?: string | null;
  weekDays?: number[] | null;
  skippedYmds?: string[] | null;
}): string[] {
  const pattern = (input.pattern ?? 'DAILY').toUpperCase();
  const weekDays = input.weekDays?.length ? input.weekDays : null;
  const skipped = new Set(input.skippedYmds ?? []);
  const stepDaily = !!weekDays && pattern !== 'MONTHLY';
  const out: string[] = [];
  let ymd = stepSeriesYmd(input.anchorYmd, pattern, stepDaily);
  let guard = 0;
  while (ymd < input.horizonEndYmd && guard++ < 400) {
    const weekdayOk = !weekDays || weekDays.includes(weekdayIndex(ymd));
    const biweeklyOk =
      pattern !== 'BIWEEKLY' ||
      !stepDaily ||
      weeksBetweenYmd(input.anchorYmd, ymd) % 2 === 0;
    if (weekdayOk && biweeklyOk && !skipped.has(ymd)) out.push(ymd);
    ymd = stepSeriesYmd(ymd, pattern, stepDaily);
  }
  return out;
}

function stepSeriesYmd(ymd: string, pattern: string, stepDaily: boolean): string {
  if (stepDaily || pattern === 'DAILY') return addDaysToYmd(ymd, 1);
  if (pattern === 'WEEKLY') return addDaysToYmd(ymd, 7);
  if (pattern === 'BIWEEKLY') return addDaysToYmd(ymd, 14);
  return addMonthsToYmd(ymd, 1);
}

function weeksBetweenYmd(fromYmd: string, toYmd: string): number {
  const [fy, fm, fd] = fromYmd.split('-').map(Number);
  const [ty, tm, td] = toYmd.split('-').map(Number);
  const start = Date.UTC(fy, fm - 1, fd);
  const end = Date.UTC(ty, tm - 1, td);
  return Math.round((end - start) / (7 * 24 * 60 * 60 * 1000));
}
