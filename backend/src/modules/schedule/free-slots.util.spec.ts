import {
  buildFreeSlotsPlan,
  candidateStartsInGaps,
  ceilToStep,
  clipBusyToDay,
  dayWakeSleepMs,
  eligibleWindowsForDay,
  mergeIntervals,
  phaseWindowMs,
  subtractMany,
} from './free-slots.util';

describe('free-slots.util', () => {
  const tz = 'UTC';
  const ymd = '2026-04-21';
  const wake = '09:00';
  const sleep = '17:00';
  const phase = {
    id: 'p1',
    name: 'Focus',
    color: '#4a90e2',
    type: 'time_phase',
    startTime: '09:00',
    endTime: '17:00',
    weekDays: null as number[] | null,
  };

  const dayStart = Date.parse('2026-04-21T09:00:00.000Z');
  const dayEnd = Date.parse('2026-04-21T17:00:00.000Z');

  it('merges overlapping busy intervals', () => {
    expect(
      mergeIntervals([
        { start: 0, end: 10 },
        { start: 8, end: 20 },
        { start: 30, end: 40 },
      ]),
    ).toEqual([
      { start: 0, end: 20 },
      { start: 30, end: 40 },
    ]);
  });

  it('merges adjacent intervals that touch', () => {
    expect(
      mergeIntervals([
        { start: 0, end: 10 },
        { start: 10, end: 20 },
      ]),
    ).toEqual([{ start: 0, end: 20 }]);
  });

  it('subtracts busy from free gaps', () => {
    const free = subtractMany(
      [{ start: dayStart, end: dayEnd }],
      [
        {
          start: Date.parse('2026-04-21T10:00:00.000Z'),
          end: Date.parse('2026-04-21T11:00:00.000Z'),
        },
      ],
    );
    expect(free).toEqual([
      {
        start: dayStart,
        end: Date.parse('2026-04-21T10:00:00.000Z'),
      },
      {
        start: Date.parse('2026-04-21T11:00:00.000Z'),
        end: dayEnd,
      },
    ]);
  });

  it('subtractMany handles overlapping busy blocks', () => {
    const free = subtractMany(
      [{ start: dayStart, end: dayEnd }],
      [
        {
          start: Date.parse('2026-04-21T10:00:00.000Z'),
          end: Date.parse('2026-04-21T12:00:00.000Z'),
        },
        {
          start: Date.parse('2026-04-21T11:00:00.000Z'),
          end: Date.parse('2026-04-21T13:00:00.000Z'),
        },
      ],
    );
    expect(free).toEqual([
      { start: dayStart, end: Date.parse('2026-04-21T10:00:00.000Z') },
      {
        start: Date.parse('2026-04-21T13:00:00.000Z'),
        end: dayEnd,
      },
    ]);
  });

  it('enumerates 15-min candidates that fit duration', () => {
    const gap = {
      start: Date.parse('2026-04-21T12:00:00.000Z'),
      end: Date.parse('2026-04-21T13:00:00.000Z'),
    };
    const starts = candidateStartsInGaps([gap], 30, 15);
    expect(starts.map((ms) => new Date(ms).toISOString())).toEqual([
      '2026-04-21T12:00:00.000Z',
      '2026-04-21T12:15:00.000Z',
      '2026-04-21T12:30:00.000Z',
    ]);
  });

  it('enumerates 30-min step candidates', () => {
    const gap = {
      start: Date.parse('2026-04-21T12:00:00.000Z'),
      end: Date.parse('2026-04-21T14:00:00.000Z'),
    };
    const starts = candidateStartsInGaps([gap], 30, 30);
    expect(starts.map((ms) => new Date(ms).toISOString())).toEqual([
      '2026-04-21T12:00:00.000Z',
      '2026-04-21T12:30:00.000Z',
      '2026-04-21T13:00:00.000Z',
      '2026-04-21T13:30:00.000Z',
    ]);
  });

  it('returns no candidates when duration exceeds all gaps', () => {
    const plan = buildFreeSlotsPlan({
      ymd,
      wake,
      sleep,
      timeZone: tz,
      phases: [phase],
      busy: [
        {
          start: Date.parse('2026-04-21T09:00:00.000Z'),
          end: Date.parse('2026-04-21T16:45:00.000Z'),
        },
      ],
      durationMinutes: 60,
    });
    expect(plan.candidates).toEqual([]);
    expect(plan.free.length).toBe(1);
  });

  it('builds candidates around a mid-day busy block', () => {
    const plan = buildFreeSlotsPlan({
      ymd,
      wake,
      sleep,
      timeZone: tz,
      phases: [phase],
      busy: [
        {
          start: Date.parse('2026-04-21T12:00:00.000Z'),
          end: Date.parse('2026-04-21T13:00:00.000Z'),
        },
      ],
      durationMinutes: 30,
    });
    expect(plan.candidates.length).toBeGreaterThan(0);
    expect(plan.candidates[0]).toBe(dayStart);
    expect(plan.candidates).toContain(Date.parse('2026-04-21T11:30:00.000Z'));
    expect(plan.candidates).not.toContain(
      Date.parse('2026-04-21T11:45:00.000Z'),
    );
    expect(plan.candidates).toContain(Date.parse('2026-04-21T13:00:00.000Z'));
  });

  it('falls back to wake/sleep when the phase does not apply that day', () => {
    const mondayOnly = {
      ...phase,
      weekDays: [1],
    };
    const plan = buildFreeSlotsPlan({
      ymd: '2026-04-21',
      wake,
      sleep,
      timeZone: tz,
      phases: [mondayOnly],
      busy: [],
      durationMinutes: 30,
    });
    expect(plan.usedWakeSleepFallback).toBe(true);
    expect(plan.candidates.length).toBeGreaterThan(0);
  });

  it('can disable wake/sleep fallback', () => {
    const mondayOnly = { ...phase, weekDays: [1] };
    const plan = buildFreeSlotsPlan({
      ymd: '2026-04-21',
      wake,
      sleep,
      timeZone: tz,
      phases: [mondayOnly],
      busy: [],
      durationMinutes: 30,
      fallBackToWakeSleep: false,
    });
    expect(plan.usedWakeSleepFallback).toBe(false);
    expect(plan.candidates).toEqual([]);
    expect(plan.free).toEqual([]);
  });

  it('ceilToStep snaps up to the next quarter hour', () => {
    const aligned = Date.parse('2026-04-21T12:00:00.000Z');
    expect(ceilToStep(aligned)).toBe(aligned);
    expect(ceilToStep(aligned + 1)).toBe(aligned + 15 * 60_000);
  });

  it('dayWakeSleepMs spans overnight when sleep is before wake', () => {
    const ws = dayWakeSleepMs('2026-04-21', '22:00', '06:00', tz);
    expect(ws.end - ws.start).toBe(8 * 60 * 60 * 1000);
  });

  it('ignores sleep_time phases in eligible windows', () => {
    const sleepPhase = {
      ...phase,
      id: 'sleep',
      type: 'sleep_time',
      startTime: '22:00',
      endTime: '07:00',
    };
    const eligible = eligibleWindowsForDay(
      ymd,
      [sleepPhase],
      wake,
      sleep,
      tz,
    );
    expect(eligible).toEqual([]);
  });

  it('phaseWindowMs intersects phase with wake/sleep', () => {
    const ws = dayWakeSleepMs(ymd, wake, sleep, tz);
    const latePhase = {
      ...phase,
      startTime: '08:00',
      endTime: '10:00',
    };
    const window = phaseWindowMs(latePhase, ymd, ws, tz);
    expect(window).toEqual({
      start: dayStart,
      end: Date.parse('2026-04-21T10:00:00.000Z'),
    });
  });

  it('clipBusyToDay drops intervals outside the day', () => {
    const day = { start: dayStart, end: dayEnd };
    expect(
      clipBusyToDay(
        [
          {
            start: Date.parse('2026-04-21T07:00:00.000Z'),
            end: Date.parse('2026-04-21T10:00:00.000Z'),
          },
          {
            start: Date.parse('2026-04-22T09:00:00.000Z'),
            end: Date.parse('2026-04-22T10:00:00.000Z'),
          },
        ],
        day,
      ),
    ).toEqual([
      {
        start: dayStart,
        end: Date.parse('2026-04-21T10:00:00.000Z'),
      },
    ]);
  });

  it('empty phases uses full wake/sleep on weekdays', () => {
    const plan = buildFreeSlotsPlan({
      ymd,
      wake,
      sleep,
      timeZone: tz,
      phases: [],
      busy: [],
      durationMinutes: 60,
    });
    expect(plan.usedWakeSleepFallback).toBe(false);
    expect(plan.day).toEqual({ start: dayStart, end: dayEnd });
    expect(plan.candidates.length).toBeGreaterThan(0);
  });

  it('empty phases on weekend returns nothing when weekendOk is false', () => {
    // 2026-04-25 is Saturday
    const plan = buildFreeSlotsPlan({
      ymd: '2026-04-25',
      wake,
      sleep,
      timeZone: tz,
      phases: [],
      busy: [],
      durationMinutes: 30,
      weekendOk: false,
    });
    expect(plan.candidates).toEqual([]);
    expect(plan.free).toEqual([]);
  });

  it('candidateStartsInGaps returns empty for zero-length gaps', () => {
    expect(
      candidateStartsInGaps(
        [{ start: dayStart, end: dayStart }],
        15,
        15,
      ),
    ).toEqual([]);
  });
});
