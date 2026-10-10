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
  /**
   * Series home interval on this civil day for a detached / clock-split member
   * (`parentSeriesId` / group master). Hole search treats home∪actual as busy so
   * a shifted one-off does not open a false gap at the series clock.
   */
  homeStart?: number;
  homeEnd?: number;
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
  /**
   * When searching without `interval`, prefer a start closest to this instant
   * (series preferred clock). Ties keep the earlier start.
   */
  preferNearMs?: number | null;
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
      /**
       * Hole-search only: `busy` = phase day already had flexibles/series;
       * `open` = empty window (phase-start hole). Used so empty horizon days
       * do not dominate the recurring primary clock vote.
       */
      lane?: 'busy' | 'open';
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
  /** Prefer the start closest to this ms (spec: nearest hole to preferred). */
  preferNearMs?: number | null;
}): MsInterval | null {
  const durationMs = Math.max(1, opts.durationMinutes) * 60_000;
  const preferNear =
    opts.preferNearMs != null && Number.isFinite(opts.preferNearMs)
      ? opts.preferNearMs
      : null;
  const search = (blocked: MsInterval[]): MsInterval | null => {
    let best: number | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const window of opts.windows) {
      const free = subtractMany([window], blocked);
      for (const start of candidateStartsInGaps(free, opts.durationMinutes)) {
        if (start < opts.notBefore) continue;
        if (start + durationMs > window.end) continue;
        if (preferNear == null) {
          if (best === null || start < best) best = start;
          continue;
        }
        const dist = Math.abs(start - preferNear);
        if (
          best === null ||
          dist < bestDist ||
          (dist === bestDist && start < best)
        ) {
          best = start;
          bestDist = dist;
        }
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
  // Series: slide that day's slot in place when a hole exists. Only detach the
  // overlapped day when it cannot reseat — never park the whole master.
  if (seat.role === 'series') {
    if (hole) {
      return {
        kind: 'shift',
        seatId: seat.id,
        taskId: seat.taskId,
        start: hole.start,
        end: hole.end,
      };
    }
    return {
      kind: 'detach',
      seatId: seat.id,
      taskId: seat.taskId,
      occurrenceYmd:
        seat.occurrenceYmd ||
        new Date(seat.start).toISOString().slice(0, 10),
      start: null,
      end: null,
      originalStart: seat.start,
      originalEnd: seat.end,
      reason,
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
  /** When true, third-party pulls are flexibles only (other series are walls). */
  claimRecurring = false,
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
      seats.filter((seat) => !isMovableRole(seat.role, claimRecurring)),
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
        isMovableRole(seat.role, claimRecurring) &&
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

function intersectWindows(a: MsInterval[], b: MsInterval[]): MsInterval[] {
  const out: MsInterval[] = [];
  for (const left of a) {
    for (const right of b) {
      const start = Math.max(left.start, right.start);
      const end = Math.min(left.end, right.end);
      if (end > start) out.push({ start, end });
    }
  }
  return out;
}

function clipToWindow(seat: MsInterval, window: MsInterval): MsInterval | null {
  const start = Math.max(seat.start, window.start);
  const end = Math.min(seat.end, window.end);
  return end > start ? { start, end } : null;
}

/**
 * Free minutes in the phase window after every seat (fixed + flexible + …).
 * Plan-only: does not write the calendar.
 */
export function freeMinutesInPhaseWindow(
  window: MsInterval,
  seats: PlacementSeat[],
): number {
  const clipped: MsInterval[] = [];
  for (const seat of seats) {
    const piece = clipToWindow(seat, window);
    if (piece) clipped.push(piece);
  }
  const busy = mergeIntervals(clipped);
  let used = 0;
  for (const piece of busy) used += piece.end - piece.start;
  const span = window.end - window.start;
  return Math.max(0, Math.floor((span - used) / 60_000));
}

/**
 * Who packing / reseat may displace for this claim.
 * Recurring claims never shift another series master (that poisoned Google
 * DTSTART via open[0] when one day was slid). One-offs may still detach/shift
 * a single series day.
 */
function isMovableRole(
  role: PlacementSeatRole,
  claimRecurring: boolean,
): boolean {
  if (role === 'flexible') return true;
  if (role === 'series') return !claimRecurring;
  return false;
}

/**
 * Plan-only rearrange: fixed seats stay; movables are compacted between
 * them so a hole opens for the claim. Then each movable is pulled toward its
 * current start (soft preferred). Returns null if capacity is too small or
 * no layout fits.
 */
function packMovablesForHole(
  claim: PlacementClaim,
  seats: PlacementSeat[],
  soft: MsInterval[],
  window: MsInterval,
): PlacementPlan | null {
  if (freeMinutesInPhaseWindow(window, seats) < claim.durationMinutes) {
    return null;
  }

  const recurring = !!claim.recurring;
  const dayPeople = seats
    .filter(
      (seat) => isMovableRole(seat.role, recurring) && overlaps(seat, window),
    )
    .sort((a, b) => a.start - b.start || a.end - b.end);
  if (!dayPeople.length) return null;

  const fixedHard = seats
    .filter((seat) => !isMovableRole(seat.role, recurring))
    .map((seat) => ({ start: seat.start, end: seat.end }));
  const vacated = new Set(dayPeople.map((seat) => seat.id));
  const outsideHard = seats
    .filter((seat) => !vacated.has(seat.id))
    .map((seat) => ({ start: seat.start, end: seat.end }));

  // Pass 1: tight left pack between fixed walls (proves a layout exists).
  const packed = new Map<string, MsInterval>();
  let cursor = Math.max(window.start, claim.notBefore);
  for (const person of dayPeople) {
    const personWindows = intersectWindows(
      person.windows.length ? person.windows : [window],
      [window],
    );
    if (!personWindows.length) return null;
    const hole = findHole({
      durationMinutes: minutesOf(person),
      notBefore: Math.max(cursor, person.notBefore, claim.notBefore),
      windows: personWindows,
      hard: [...fixedHard, ...outsideHard, ...packed.values()],
      soft,
    });
    if (!hole) return null;
    packed.set(person.id, hole);
    cursor = hole.end;
  }

  // Recurring without a preferred clock: keep the claim at the trailing edge of
  // the packed stack. Otherwise pass-2 peer pull recreates an interior gap and
  // the claim falls into the hole a shifted series peer opened (live day 15).
  const preferNear =
    claim.preferNearMs ??
    claim.interval?.start ??
    (claim.recurring ? window.end : null);
  let claimHole = findHole({
    durationMinutes: claim.durationMinutes,
    notBefore: claim.notBefore,
    windows: [window],
    hard: [...fixedHard, ...outsideHard, ...packed.values()],
    soft,
    preferNearMs: preferNear,
  });
  if (!claimHole) return null;

  // Pass 2: soft preferred — pull each movable toward its original start
  // (or series home when shifted).
  const assigned = new Map(packed);
  for (const person of dayPeople) {
    const personWindows = intersectWindows(
      person.windows.length ? person.windows : [window],
      [window],
    );
    const othersAssigned = [...assigned.entries()]
      .filter(([id]) => id !== person.id)
      .map(([, interval]) => interval);
    const pullToward =
      person.homeStart != null ? person.homeStart : person.start;
    const hole = findHole({
      durationMinutes: minutesOf(person),
      notBefore: Math.max(window.start, person.notBefore, claim.notBefore),
      windows: personWindows,
      hard: [...fixedHard, ...outsideHard, claimHole, ...othersAssigned],
      soft,
      preferNearMs: pullToward,
    });
    if (hole) assigned.set(person.id, hole);
  }

  // Claim may move after peers slid toward their original starts.
  const finalClaim = findHole({
    durationMinutes: claim.durationMinutes,
    notBefore: claim.notBefore,
    windows: [window],
    hard: [...fixedHard, ...outsideHard, ...assigned.values()],
    soft,
    preferNearMs: preferNear,
  });
  if (!finalClaim) return null;

  const moves: PlacementMove[] = [];
  for (const person of dayPeople) {
    const hole = assigned.get(person.id)!;
    if (hole.start === person.start && hole.end === person.end) continue;
    moves.push(moveFor(person, hole, 'no_slot'));
  }
  return {
    outcome: 'seated',
    start: finalClaim.start,
    end: finalClaim.end,
    moves,
  };
}

/**
 * True when `hole` sits strictly inside the span of movable peers (actual∪home)
 * in `window` — a gap opened by a shifted series day, not a trailing free slot.
 */
export function isInteriorClusterHole(
  hole: MsInterval,
  movables: PlacementSeat[],
  window: MsInterval,
): boolean {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const seat of movables) {
    const spans: MsInterval[] = [{ start: seat.start, end: seat.end }];
    if (
      seat.homeStart != null &&
      seat.homeEnd != null &&
      seat.homeEnd > seat.homeStart
    ) {
      spans.push({ start: seat.homeStart, end: seat.homeEnd });
    }
    for (const span of spans) {
      if (!overlaps(span, window)) continue;
      min = Math.min(min, span.start);
      max = Math.max(max, span.end);
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return false;
  return hole.start > min && hole.end < max;
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

  // Recurring never parks in Unscheduled — overflow / window miss → Problematic.
  if (claim.windowExpired) {
    if (claim.recurring) return { outcome: 'problematic', reason: 'deadline_no_fit' };
    return { outcome: 'unscheduled' };
  }

  const interval = claim.interval;
  if (!interval) {
    // Busy = actual seat plus series-home ghost (shifted one-offs still own home).
    const hard = mergeIntervals(
      others.flatMap((seat) => {
        const rows: MsInterval[] = [{ start: seat.start, end: seat.end }];
        if (
          seat.homeStart != null &&
          seat.homeEnd != null &&
          seat.homeEnd > seat.homeStart
        ) {
          rows.push({ start: seat.homeStart, end: seat.homeEnd });
        }
        return rows;
      }),
    );
    const movables = others.filter(
      (seat) => seat.role === 'flexible' || seat.role === 'series',
    );
    const busyWindows: MsInterval[] = [];
    const emptyWindows: MsInterval[] = [];
    for (const window of claim.windows) {
      if (movables.some((seat) => overlaps(seat, window))) {
        busyWindows.push(window);
      } else {
        emptyWindows.push(window);
      }
    }
    const holeOpts = {
      durationMinutes: claim.durationMinutes,
      notBefore: claim.notBefore,
      hard,
      soft,
      preferNearMs: claim.preferNearMs,
    };
    // Stay on days that already have flexibles: try a raw hole, then left-pack
    // (10:15→10:00). Only after every busy day fails, use an empty later day.
    // Recurring: skip holes strictly inside the movable cluster (false gap when
    // a series peer was shifted) — pack the stack instead.
    for (const window of busyWindows) {
      const hole = findHole({ ...holeOpts, windows: [window] });
      if (
        hole &&
        !(
          claim.recurring &&
          isInteriorClusterHole(hole, movables, window)
        )
      ) {
        return {
          outcome: 'seated',
          start: hole.start,
          end: hole.end,
          moves: [],
          lane: 'busy',
        };
      }
    }
    for (const window of busyWindows) {
      const packed = packMovablesForHole(claim, others, soft, window);
      if (packed?.outcome === 'seated') {
        return { ...packed, lane: 'busy' };
      }
    }
    for (const window of emptyWindows) {
      const hole = findHole({ ...holeOpts, windows: [window] });
      if (hole) {
        return {
          outcome: 'seated',
          start: hole.start,
          end: hole.end,
          moves: [],
          lane: 'open',
        };
      }
    }
    return { outcome: 'problematic', reason: 'no_slot' };
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

  const claimantInterval = { start: interval.start, end: interval.end };

  // Recurring create/expand never displaces another series master — those seats
  // are walls. Prefer flex-only reseat/pack, else the next free hole in-phase.
  if (claim.recurring) {
    const seriesHits = others.filter(
      (seat) => seat.role === 'series' && overlaps(seat, interval),
    );
    const direct = others.filter(
      (seat) => seat.role === 'flexible' && overlaps(seat, interval),
    );

    const fallbackOffSeries = (): PlacementPlan => {
      for (const window of claim.windows) {
        if (interval.end <= window.start || interval.start >= window.end) {
          continue;
        }
        const packed = packMovablesForHole(
          { ...claim, preferNearMs: interval.start },
          others,
          soft,
          window,
        );
        if (packed) return packed;
      }
      const hole = findHole({
        durationMinutes: claim.durationMinutes,
        notBefore: claim.notBefore,
        windows: claim.windows,
        hard: others.map((seat) => ({ start: seat.start, end: seat.end })),
        soft,
        preferNearMs: interval.start,
      });
      if (hole) {
        return {
          outcome: 'seated',
          start: hole.start,
          end: hole.end,
          moves: [],
        };
      }
      return { outcome: 'problematic', reason: 'no_slot' };
    };

    if (seriesHits.length) {
      return fallbackOffSeries();
    }
    if (!direct.length) {
      return {
        outcome: 'seated',
        start: interval.start,
        end: interval.end,
        moves: [],
      };
    }
    const chained = reseat(
      direct,
      claimantInterval,
      others,
      soft,
      true,
      true,
    );
    const directOnly = chained
      ? null
      : reseatDirectOnly(direct, claimantInterval, others, soft);
    const assigned =
      chained ??
      (directOnly && direct.every((seat) => directOnly.has(seat.id))
        ? directOnly
        : null);
    if (!assigned) {
      return fallbackOffSeries();
    }
    const moves: PlacementMove[] = [];
    for (const seat of others) {
      if (!assigned.has(seat.id)) continue;
      if (seat.role !== 'flexible') continue;
      const hole = assigned.get(seat.id)!;
      if (overlaps(hole, claimantInterval)) {
        return { outcome: 'problematic', reason: 'no_slot' };
      }
      moves.push(moveFor(seat, hole, 'no_slot'));
    }
    return {
      outcome: 'seated',
      start: interval.start,
      end: interval.end,
      moves,
    };
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

  const chained = reseat(direct, claimantInterval, others, soft, true, false);
  const assigned =
    chained ?? reseatDirectOnly(direct, claimantInterval, others, soft);
  const movedIds = new Set(
    chained ? chained.keys() : direct.map((seat) => seat.id),
  );
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

/** Horizon days including a valid `anchorYmd` (plan-all-days before write). */
export function seriesHorizonYmds(input: {
  anchorYmd: string;
  horizonEndYmd: string;
  pattern?: string | null;
  weekDays?: number[] | null;
  skippedYmds?: string[] | null;
}): string[] {
  const pattern = (input.pattern ?? 'DAILY').toUpperCase();
  const weekDays = input.weekDays?.length ? input.weekDays : null;
  const skipped = new Set(input.skippedYmds ?? []);
  const later = seriesOccurrenceYmds(input);
  if (input.anchorYmd >= input.horizonEndYmd) return later;
  if (skipped.has(input.anchorYmd)) return later;
  const weekdayOk =
    !weekDays || weekDays.includes(weekdayIndex(input.anchorYmd));
  const biweeklyOk = pattern !== 'BIWEEKLY' || true;
  if (!weekdayOk || !biweeklyOk) return later;
  return [input.anchorYmd, ...later];
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
