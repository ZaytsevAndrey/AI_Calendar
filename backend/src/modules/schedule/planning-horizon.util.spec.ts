import {
  normalizeFixedEventBufferMinutes,
  planningHorizonRange,
} from './planning-horizon.util';

// Moved unchanged from intelligent-scheduling.engine.spec.ts (PE-30).
describe('planningHorizonRange', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('uses today through Settings horizon days (exclusive end)', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-20T15:30:00.000Z'));
    const { start, end, horizonDays } = planningHorizonRange({
      recurringScheduleHorizonDays: 30,
      timeZone: 'UTC',
    });
    expect(horizonDays).toBe(30);
    expect(start.toISOString()).toBe('2026-04-20T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-05-20T00:00:00.000Z');
  });

  it('starts the horizon at midnight in the settings time zone', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-20T15:30:00.000Z'));
    const { start, end, horizonDays } = planningHorizonRange({
      recurringScheduleHorizonDays: 2,
      timeZone: 'Asia/Nicosia',
    });
    expect(horizonDays).toBe(2);
    expect(start.toISOString()).toBe('2026-04-19T21:00:00.000Z');
    expect(end.toISOString()).toBe('2026-04-21T21:00:00.000Z');
  });

  it('keeps calendar days across a DST change (Europe/Kyiv, last Sunday of October)', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-24T12:00:00.000Z'));
    const { start, end } = planningHorizonRange({
      recurringScheduleHorizonDays: 2,
      timeZone: 'Europe/Kyiv',
    });
    // 24 Oct 00:00 is +03:00; 26 Oct 00:00 is +02:00 after the switch on the 25th.
    expect(start.toISOString()).toBe('2026-10-23T21:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-25T22:00:00.000Z');
  });

  it('clamps invalid horizon to 1–365', () => {
    expect(planningHorizonRange({ recurringScheduleHorizonDays: 0 }).horizonDays).toBe(1);
    expect(planningHorizonRange({ recurringScheduleHorizonDays: 999 }).horizonDays).toBe(365);
    expect(planningHorizonRange({}).horizonDays).toBe(30);
  });
});

describe('fixed event buffers', () => {
  it('treats 0 and invalid values as off and clamps the rest', () => {
    expect(normalizeFixedEventBufferMinutes(0)).toBe(0);
    expect(normalizeFixedEventBufferMinutes(-5)).toBe(0);
    expect(normalizeFixedEventBufferMinutes(Number.NaN)).toBe(0);
    expect(normalizeFixedEventBufferMinutes(15.9)).toBe(15);
    expect(normalizeFixedEventBufferMinutes(500)).toBe(180);
  });
});
