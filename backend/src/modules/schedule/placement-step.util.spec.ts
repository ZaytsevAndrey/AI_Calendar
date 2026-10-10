import {
  freeMinutesInPhaseWindow,
  planPlacement,
  seriesHorizonYmds,
  seriesOccurrenceYmds,
  type PlacementSeat,
} from './placement-step.util';

const DAY = Date.parse('2026-10-08T09:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const WINDOW = [{ start: DAY, end: DAY + 8 * HOUR }];

function seat(
  partial: Partial<PlacementSeat> & Pick<PlacementSeat, 'id' | 'role' | 'start' | 'end'>,
): PlacementSeat {
  return {
    taskId: partial.taskId ?? partial.id,
    taskName: partial.taskName ?? partial.id,
    windows: partial.windows ?? WINDOW,
    notBefore: partial.notBefore ?? DAY,
    ...partial,
  };
}

function claim(interval?: { start: number; end: number } | null) {
  return {
    taskId: 'new',
    taskName: 'New',
    recurring: false,
    durationMinutes: 60,
    notBefore: DAY,
    windows: WINDOW,
    interval,
  };
}

describe('planPlacement', () => {
  it('seats a task with no preferred time in the nearest hole and moves nobody', () => {
    const plan = planPlacement({
      claim: claim(null),
      seats: [
        seat({
          id: 'busy',
          role: 'flexible',
          start: DAY,
          end: DAY + HOUR,
        }),
      ],
    });
    expect(plan).toEqual({
      outcome: 'seated',
      start: DAY + HOUR,
      end: DAY + 2 * HOUR,
      moves: [],
      lane: 'busy',
    });
  });

  it('when preferNearMs is set, picks the hole closest to preferred — not the earliest', () => {
    // Free: 10:00–11:00 and 13:00–14:00. Preferred 14:00 (busy) → 13:00, not 10:00.
    const plan = planPlacement({
      claim: {
        ...claim(null),
        preferNearMs: DAY + 5 * HOUR,
      },
      seats: [
        seat({
          id: 'morning',
          role: 'anchor',
          start: DAY,
          end: DAY + HOUR,
        }),
        seat({
          id: 'mid',
          role: 'anchor',
          start: DAY + 2 * HOUR,
          end: DAY + 4 * HOUR,
        }),
        seat({
          id: 'pref',
          role: 'anchor',
          start: DAY + 5 * HOUR,
          end: DAY + 6 * HOUR,
        }),
      ],
    });
    expect(plan).toEqual({
      outcome: 'seated',
      start: DAY + 4 * HOUR,
      end: DAY + 5 * HOUR,
      moves: [],
      lane: 'open',
    });
  });

  it('packs a fragmented morning so a 30m claim fits without preferred', () => {
    // 9:00, 9:30, 10:15 in a 9–11 window — 15m gaps only until 10:15 slides to 10:00.
    const phase = [{ start: DAY, end: DAY + 2 * HOUR }];
    const plan = planPlacement({
      claim: {
        ...claim(null),
        durationMinutes: 30,
        windows: phase,
      },
      seats: [
        seat({
          id: 'one',
          role: 'flexible',
          start: DAY,
          end: DAY + 30 * 60_000,
          windows: phase,
        }),
        seat({
          id: 'two',
          role: 'flexible',
          start: DAY + 30 * 60_000,
          end: DAY + 60 * 60_000,
          windows: phase,
        }),
        seat({
          id: 'three',
          role: 'flexible',
          start: DAY + 75 * 60_000,
          end: DAY + 105 * 60_000,
          windows: phase,
        }),
      ],
    });
    expect(plan).toMatchObject({
      outcome: 'seated',
      start: DAY + 90 * 60_000,
      end: DAY + 120 * 60_000,
      moves: [
        {
          kind: 'shift',
          seatId: 'three',
          start: DAY + 60 * 60_000,
          end: DAY + 90 * 60_000,
        },
      ],
    });
  });

  it('packs a busy day instead of taking an earlier empty day hole', () => {
    const day1 = [{ start: DAY, end: DAY + 2 * HOUR }];
    const day2Start = DAY + 24 * HOUR;
    const day2 = [{ start: day2Start, end: day2Start + 2 * HOUR }];
    const plan = planPlacement({
      claim: {
        ...claim(null),
        durationMinutes: 30,
        windows: [...day1, ...day2],
      },
      seats: [
        seat({
          id: 'one',
          role: 'flexible',
          start: day2Start,
          end: day2Start + 30 * 60_000,
          windows: day2,
        }),
        seat({
          id: 'two',
          role: 'flexible',
          start: day2Start + 30 * 60_000,
          end: day2Start + 60 * 60_000,
          windows: day2,
        }),
        seat({
          id: 'three',
          role: 'flexible',
          start: day2Start + 75 * 60_000,
          end: day2Start + 105 * 60_000,
          windows: day2,
        }),
      ],
    });
    expect(plan).toMatchObject({
      outcome: 'seated',
      start: day2Start + 90 * 60_000,
      end: day2Start + 120 * 60_000,
      moves: [
        {
          kind: 'shift',
          seatId: 'three',
          start: day2Start + 60 * 60_000,
          end: day2Start + 90 * 60_000,
        },
      ],
    });
  });

  it('recurring skips interior gap when a series peer was shifted (live day 15)', () => {
    // 1@09:00, 2 missing, 3 shifted to 10:15 (home 10:00). Raw hole 09:30 is a
    // false stack gap — pack instead so the new series does not sit at 09:30.
    const phase = [{ start: DAY, end: DAY + 2 * HOUR }];
    const plan = planPlacement({
      claim: {
        ...claim(null),
        recurring: true,
        durationMinutes: 30,
        windows: phase,
      },
      seats: [
        seat({
          id: 'one',
          role: 'series',
          start: DAY,
          end: DAY + 30 * 60_000,
          windows: phase,
        }),
        seat({
          id: 'three',
          role: 'flexible',
          start: DAY + 75 * 60_000,
          end: DAY + 105 * 60_000,
          homeStart: DAY + 60 * 60_000,
          homeEnd: DAY + 90 * 60_000,
          windows: phase,
        }),
      ],
    });
    expect(plan.outcome).toBe('seated');
    if (plan.outcome !== 'seated') return;
    // Must not take the interior 09:30 gap.
    expect(plan.start).not.toBe(DAY + 30 * 60_000);
    expect(plan.start).toBeGreaterThanOrEqual(DAY + 60 * 60_000);
    expect(plan.moves.length).toBeGreaterThanOrEqual(1);
  });

  it('recurring treats series-home∪actual as busy so vacated home is not a free hole', () => {
    // Only shifted "3" at 10:30; home still 10:00 → no raw hole at 10:00.
    const phase = [{ start: DAY, end: DAY + 2 * HOUR }];
    const plan = planPlacement({
      claim: {
        ...claim(null),
        recurring: true,
        durationMinutes: 30,
        windows: phase,
      },
      seats: [
        seat({
          id: 'one',
          role: 'series',
          start: DAY,
          end: DAY + 30 * 60_000,
          windows: phase,
        }),
        seat({
          id: 'two',
          role: 'series',
          start: DAY + 30 * 60_000,
          end: DAY + 60 * 60_000,
          windows: phase,
        }),
        seat({
          id: 'three',
          role: 'flexible',
          start: DAY + 90 * 60_000,
          end: DAY + 120 * 60_000,
          homeStart: DAY + 60 * 60_000,
          homeEnd: DAY + 90 * 60_000,
          windows: phase,
        }),
      ],
    });
    expect(plan.outcome).toBe('seated');
    if (plan.outcome !== 'seated') return;
    // Home∪actual fills 10:00–11:00; no raw hole at vacated 10:00 — pack puts
    // the recurring claim on the trailing edge (10:30) and pulls "3" to home.
    expect(plan.start).toBe(DAY + 90 * 60_000);
    expect(plan.moves).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'shift',
          seatId: 'three',
          start: DAY + 60 * 60_000,
        }),
      ]),
    );
  });

  it('does not seat a no-preferred claim on top of peers when packing cannot open a hole', () => {
    const phase = [{ start: DAY, end: DAY + 90 * 60_000 }];
    const plan = planPlacement({
      claim: {
        ...claim(null),
        durationMinutes: 30,
        windows: phase,
      },
      seats: [
        seat({
          id: 'one',
          role: 'flexible',
          start: DAY,
          end: DAY + 30 * 60_000,
          windows: phase,
        }),
        seat({
          id: 'two',
          role: 'flexible',
          start: DAY + 30 * 60_000,
          end: DAY + 60 * 60_000,
          windows: phase,
        }),
        seat({
          id: 'three',
          role: 'flexible',
          start: DAY + 60 * 60_000,
          end: DAY + 90 * 60_000,
          windows: phase,
        }),
      ],
    });
    expect(plan).toEqual({ outcome: 'problematic', reason: 'no_slot' });
  });

  it('skips packing when free minutes in the phase are less than the claim', () => {
    const phase = [{ start: DAY, end: DAY + 2 * HOUR }];
    // 90m fixed + two 30m flex = 150m busy in 120m phase → 0 free minutes.
    const plan = planPlacement({
      claim: {
        ...claim(null),
        durationMinutes: 30,
        windows: phase,
      },
      seats: [
        seat({
          id: 'wall',
          role: 'anchor',
          start: DAY,
          end: DAY + 90 * 60_000,
          windows: phase,
        }),
        seat({
          id: 'a',
          role: 'flexible',
          start: DAY + 90 * 60_000,
          end: DAY + 105 * 60_000,
          windows: phase,
        }),
        seat({
          id: 'b',
          role: 'flexible',
          start: DAY + 105 * 60_000,
          end: DAY + 120 * 60_000,
          windows: phase,
        }),
      ],
    });
    expect(freeMinutesInPhaseWindow(phase[0], [
      seat({
        id: 'wall',
        role: 'anchor',
        start: DAY,
        end: DAY + 90 * 60_000,
      }),
      seat({
        id: 'a',
        role: 'flexible',
        start: DAY + 90 * 60_000,
        end: DAY + 105 * 60_000,
      }),
      seat({
        id: 'b',
        role: 'flexible',
        start: DAY + 105 * 60_000,
        end: DAY + 120 * 60_000,
      }),
    ])).toBe(0);
    expect(plan).toEqual({ outcome: 'problematic', reason: 'no_slot' });
  });

  it('packs between fixed walls when free minutes cover the claim', () => {
    const phase = [{ start: DAY, end: DAY + 2 * HOUR }];
    // Fixed 09:00–10:00; flex 10:15–10:45 → only 15m gaps, but 30m free total.
    const plan = planPlacement({
      claim: {
        ...claim(null),
        durationMinutes: 30,
        windows: phase,
      },
      seats: [
        seat({
          id: 'fixed',
          role: 'anchor',
          start: DAY,
          end: DAY + HOUR,
          windows: phase,
        }),
        seat({
          id: 'flex',
          role: 'flexible',
          start: DAY + 75 * 60_000,
          end: DAY + 105 * 60_000,
          windows: phase,
        }),
      ],
    });
    expect(plan).toMatchObject({
      outcome: 'seated',
      start: DAY + 90 * 60_000,
      end: DAY + 120 * 60_000,
      moves: [
        {
          kind: 'shift',
          seatId: 'flex',
          start: DAY + 60 * 60_000,
          end: DAY + 90 * 60_000,
        },
      ],
    });
  });

  it('writes only the claimant when the preferred interval is free', () => {
    const plan = planPlacement({
      claim: claim({ start: DAY + 2 * HOUR, end: DAY + 3 * HOUR }),
      seats: [
        seat({ id: 'busy', role: 'flexible', start: DAY, end: DAY + HOUR }),
      ],
    });
    expect(plan).toMatchObject({
      outcome: 'seated',
      start: DAY + 2 * HOUR,
      moves: [],
    });
  });

  it('allows endpoint-adjacent intervals (9–10 and 10–11) without displacing', () => {
    const plan = planPlacement({
      claim: claim({ start: DAY + HOUR, end: DAY + 2 * HOUR }),
      seats: [
        seat({ id: 'nine', role: 'flexible', start: DAY, end: DAY + HOUR }),
      ],
    });
    expect(plan).toEqual({
      outcome: 'seated',
      start: DAY + HOUR,
      end: DAY + 2 * HOUR,
      moves: [],
    });
  });

  it('detaches a series day when no hole fits instead of parking the series', () => {
    const plan = planPlacement({
      claim: claim({ start: DAY, end: DAY + HOUR }),
      seats: [
        seat({
          id: 'series-day',
          role: 'series',
          start: DAY,
          end: DAY + HOUR,
          occurrenceYmd: '2026-10-08',
          windows: [{ start: DAY, end: DAY + HOUR }],
        }),
        seat({
          id: 'wall',
          role: 'anchor',
          start: DAY + HOUR,
          end: DAY + 8 * HOUR,
        }),
      ],
    });
    expect(plan).toMatchObject({
      outcome: 'seated',
      moves: [
        {
          kind: 'detach',
          seatId: 'series-day',
          occurrenceYmd: '2026-10-08',
          start: null,
          end: null,
          reason: 'no_slot',
        },
      ],
    });
  });

  it('parks a recurring claim when overlapped peers cannot all reseat', () => {
    const plan = planPlacement({
      claim: {
        ...claim({ start: DAY, end: DAY + 30 * 60_000 }),
        recurring: true,
        durationMinutes: 30,
      },
      seats: [
        seat({
          id: 'peer',
          role: 'flexible',
          start: DAY,
          end: DAY + 30 * 60_000,
          // Only this hour is schedulable for the peer — claimant takes it all.
          windows: [{ start: DAY, end: DAY + 30 * 60_000 }],
        }),
        seat({
          id: 'wall',
          role: 'anchor',
          start: DAY + 30 * 60_000,
          end: DAY + 8 * HOUR,
        }),
      ],
    });
    expect(plan).toEqual({ outcome: 'problematic', reason: 'no_slot' });
  });

  it('shifts an overlapped flexible peer so a recurring claim can take preferred', () => {
    const plan = planPlacement({
      claim: {
        ...claim({ start: DAY, end: DAY + 30 * 60_000 }),
        recurring: true,
        durationMinutes: 30,
      },
      seats: [
        seat({
          id: 'peer',
          role: 'flexible',
          start: DAY,
          end: DAY + 30 * 60_000,
          windows: [{ start: DAY, end: DAY + 2 * HOUR }],
        }),
      ],
    });
    expect(plan).toMatchObject({
      outcome: 'seated',
      start: DAY,
      end: DAY + 30 * 60_000,
      moves: [
        {
          kind: 'shift',
          seatId: 'peer',
          start: DAY + 30 * 60_000,
          end: DAY + 60 * 60_000,
        },
      ],
    });
  });

  it('shifts a recurring claim peer using a full-day window (phase clip fallback)', () => {
    // Service restores civil-day bounds when phase clip empties a seated peer.
    const plan = planPlacement({
      claim: {
        ...claim({ start: DAY, end: DAY + 30 * 60_000 }),
        recurring: true,
        durationMinutes: 30,
      },
      seats: [
        seat({
          id: 'peer',
          role: 'flexible',
          start: DAY,
          end: DAY + 30 * 60_000,
          windows: [{ start: DAY, end: DAY + 24 * HOUR }],
        }),
      ],
    });
    expect(plan).toMatchObject({
      outcome: 'seated',
      start: DAY,
      end: DAY + 30 * 60_000,
      moves: [
        {
          kind: 'shift',
          seatId: 'peer',
          start: DAY + 30 * 60_000,
          end: DAY + 60 * 60_000,
        },
      ],
    });
  });

  it('recurring claim does not shift another series master — takes next hole', () => {
    const plan = planPlacement({
      claim: {
        ...claim({ start: DAY, end: DAY + 30 * 60_000 }),
        recurring: true,
        durationMinutes: 30,
      },
      seats: [
        seat({
          id: 'series-day',
          role: 'series',
          start: DAY,
          end: DAY + 30 * 60_000,
          occurrenceYmd: '2026-10-08',
          windows: [{ start: DAY, end: DAY + 2 * HOUR }],
        }),
      ],
    });
    expect(plan).toMatchObject({
      outcome: 'seated',
      start: DAY + 30 * 60_000,
      end: DAY + 60 * 60_000,
      moves: [],
    });
  });

  it('recurring pack shifts flexibles only — leaves other series masters put', () => {
    // Live day-12 shape: series 2+3 + shifted one-off "1" at trailing edge.
    const phase = [{ start: DAY, end: DAY + 2 * HOUR }];
    const plan = planPlacement({
      claim: {
        ...claim(null),
        recurring: true,
        durationMinutes: 30,
        windows: phase,
      },
      seats: [
        seat({
          id: 'two',
          role: 'series',
          start: DAY + 30 * 60_000,
          end: DAY + 60 * 60_000,
          windows: phase,
        }),
        seat({
          id: 'three',
          role: 'series',
          start: DAY + 60 * 60_000,
          end: DAY + 90 * 60_000,
          windows: phase,
        }),
        seat({
          id: 'one-off',
          role: 'flexible',
          start: DAY + 90 * 60_000,
          end: DAY + 120 * 60_000,
          homeStart: DAY,
          homeEnd: DAY + 30 * 60_000,
          windows: phase,
        }),
      ],
    });
    expect(plan.outcome).toBe('seated');
    if (plan.outcome !== 'seated') return;
    expect(plan.start).toBe(DAY + 90 * 60_000);
    expect(plan.moves).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'shift',
          seatId: 'one-off',
          start: DAY,
        }),
      ]),
    );
    expect(plan.moves.every((m) => m.kind !== 'shift' || m.seatId === 'one-off')).toBe(
      true,
    );
  });

  it('asks and writes nothing when the claim hits an anchor', () => {
    const plan = planPlacement({
      claim: claim({ start: DAY, end: DAY + HOUR }),
      seats: [seat({ id: 'fixed', role: 'anchor', start: DAY, end: DAY + HOUR })],
    });
    expect(plan.outcome).toBe('conflict');
    if (plan.outcome !== 'conflict') return;
    expect(plan.conflict.options).toEqual([
      'place_on_top',
      'move_new',
      'leave_problematic',
    ]);
    expect(plan.conflict.reason).toBe('preferred_on_fixed');
  });

  it('shifts a one-off off the claimed interval', () => {
    const plan = planPlacement({
      claim: claim({ start: DAY, end: DAY + HOUR }),
      seats: [
        seat({ id: 'flex', role: 'flexible', start: DAY, end: DAY + HOUR }),
      ],
    });
    expect(plan).toMatchObject({
      outcome: 'seated',
      start: DAY,
      end: DAY + HOUR,
      moves: [
        {
          kind: 'shift',
          seatId: 'flex',
          start: DAY + HOUR,
          end: DAY + 2 * HOUR,
        },
      ],
    });
  });

  it('shifts a series day onto the next hole', () => {
    const plan = planPlacement({
      claim: claim({ start: DAY, end: DAY + HOUR }),
      seats: [
        seat({
          id: 'series-day',
          role: 'series',
          start: DAY,
          end: DAY + HOUR,
          occurrenceYmd: '2026-10-08',
        }),
      ],
    });
    expect(plan).toMatchObject({
      outcome: 'seated',
      moves: [
        {
          kind: 'shift',
          seatId: 'series-day',
          start: DAY + HOUR,
          end: DAY + 2 * HOUR,
        },
      ],
    });
  });

  it('moves a third day when that is the only way everyone keeps a seat', () => {
    const plan = planPlacement({
      claim: claim({ start: DAY, end: DAY + HOUR }),
      seats: [
        seat({
          id: 'first',
          role: 'flexible',
          start: DAY,
          end: DAY + HOUR,
          windows: [{ start: DAY + HOUR, end: DAY + 2 * HOUR }],
        }),
        seat({
          id: 'third',
          role: 'flexible',
          start: DAY + HOUR,
          end: DAY + 2 * HOUR,
          windows: [{ start: DAY + 2 * HOUR, end: DAY + 3 * HOUR }],
        }),
      ],
    });
    expect(plan).toMatchObject({
      outcome: 'seated',
      moves: [
        { kind: 'shift', seatId: 'first', start: DAY + HOUR, end: DAY + 2 * HOUR },
        { kind: 'shift', seatId: 'third', start: DAY + 2 * HOUR, end: DAY + 3 * HOUR },
      ],
    });
  });

  it('leaves the third day in place and parks the displaced one-off when the chain does not fit', () => {
    const plan = planPlacement({
      claim: claim({ start: DAY, end: DAY + HOUR }),
      seats: [
        seat({
          id: 'first',
          role: 'flexible',
          start: DAY,
          end: DAY + HOUR,
          windows: [{ start: DAY + HOUR, end: DAY + 2 * HOUR }],
        }),
        seat({
          id: 'third',
          role: 'anchor',
          start: DAY + HOUR,
          end: DAY + 2 * HOUR,
        }),
      ],
    });
    expect(plan).toMatchObject({
      outcome: 'seated',
      moves: [{ kind: 'park', seatId: 'first', reason: 'no_slot' }],
    });
  });

  it('does not sit on a resolved task and does not move it', () => {
    const plan = planPlacement({
      claim: claim({ start: DAY, end: DAY + HOUR }),
      seats: [
        seat({ id: 'kept', role: 'resolved', start: DAY, end: DAY + HOUR }),
      ],
    });
    expect(plan).toEqual({
      outcome: 'seated',
      start: DAY + HOUR,
      end: DAY + 2 * HOUR,
      moves: [],
    });
  });

  it('parks the claimant when no hole exists', () => {
    const plan = planPlacement({
      claim: claim(null),
      seats: [
        seat({ id: 'full', role: 'anchor', start: DAY, end: DAY + 8 * HOUR }),
      ],
    });
    expect(plan).toEqual({ outcome: 'problematic', reason: 'no_slot' });
  });

  it('sends an expired window to unscheduled without moving others', () => {
    const plan = planPlacement({
      claim: { ...claim({ start: DAY, end: DAY + HOUR }), windowExpired: true },
      seats: [
        seat({ id: 'flex', role: 'flexible', start: DAY, end: DAY + HOUR }),
      ],
    });
    expect(plan).toEqual({ outcome: 'unscheduled' });
  });

  it('sends an expired recurring window to problematic, not unscheduled', () => {
    const plan = planPlacement({
      claim: {
        ...claim({ start: DAY, end: DAY + HOUR }),
        recurring: true,
        windowExpired: true,
      },
      seats: [],
    });
    expect(plan).toEqual({
      outcome: 'problematic',
      reason: 'deadline_no_fit',
    });
  });

  it('avoids a fixed buffer and uses it only when nothing else fits', () => {
    const avoided = planPlacement({
      claim: claim(null),
      seats: [
        seat({
          id: 'fixed',
          role: 'anchor',
          start: DAY + 3 * HOUR,
          end: DAY + 4 * HOUR,
          buffered: true,
        }),
      ],
      bufferMinutes: 60,
    });
    expect(avoided).toMatchObject({ outcome: 'seated', start: DAY });

    const tight = [{ start: DAY + 3 * HOUR, end: DAY + 4 * HOUR }];
    const used = planPlacement({
      claim: {
        ...claim(null),
        windows: tight,
        notBefore: DAY + 3 * HOUR,
      },
      seats: [
        seat({
          id: 'fixed',
          role: 'anchor',
          start: DAY + 2 * HOUR,
          end: DAY + 3 * HOUR,
          buffered: true,
          windows: tight,
        }),
      ],
      bufferMinutes: 60,
    });
    expect(used).toMatchObject({
      outcome: 'seated',
      start: DAY + 3 * HOUR,
    });
  });
});

describe('seriesOccurrenceYmds', () => {
  it('lists later daily days before the horizon end, skipping a parked day', () => {
    expect(
      seriesOccurrenceYmds({
        anchorYmd: '2026-10-08',
        horizonEndYmd: '2026-10-12',
        pattern: 'DAILY',
        skippedYmds: ['2026-10-10'],
      }),
    ).toEqual(['2026-10-09', '2026-10-11']);
  });

  it('seriesHorizonYmds includes the anchor day when eligible', () => {
    expect(
      seriesHorizonYmds({
        anchorYmd: '2026-10-08',
        horizonEndYmd: '2026-10-12',
        pattern: 'DAILY',
        skippedYmds: ['2026-10-10'],
      }),
    ).toEqual(['2026-10-08', '2026-10-09', '2026-10-11']);
  });

  it('keeps a weekly step and a weekday filter', () => {
    expect(
      seriesOccurrenceYmds({
        anchorYmd: '2026-10-08',
        horizonEndYmd: '2026-10-30',
        pattern: 'WEEKLY',
      }),
    ).toEqual(['2026-10-15', '2026-10-22', '2026-10-29']);

    expect(
      seriesOccurrenceYmds({
        anchorYmd: '2026-10-08',
        horizonEndYmd: '2026-10-15',
        pattern: 'DAILY',
        weekDays: [1, 3],
      }),
    ).toEqual(['2026-10-12', '2026-10-14']);
  });
});
