import { planPlacement, seriesOccurrenceYmds, type PlacementSeat } from './placement-step.util';

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

  it('asks and writes nothing when the claim hits an anchor', () => {
    const plan = planPlacement({
      claim: claim({ start: DAY, end: DAY + HOUR }),
      seats: [seat({ id: 'fixed', role: 'anchor', start: DAY, end: DAY + HOUR })],
    });
    expect(plan.outcome).toBe('conflict');
    if (plan.outcome !== 'conflict') return;
    expect(plan.conflict.options).toEqual(['move_new', 'leave_problematic']);
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

  it('detaches a series day onto the next hole', () => {
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
          kind: 'detach',
          taskId: 'series-day',
          occurrenceYmd: '2026-10-08',
          start: DAY + HOUR,
          end: DAY + 2 * HOUR,
          reason: null,
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
