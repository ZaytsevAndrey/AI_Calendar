import {
  addClockMinutes,
  rangeDurationMinutes,
  sameDayDuration,
  withDates,
  withDuration,
  withEnd,
  withStart,
} from './dateTimeRange';

const blank = {
  range: { startDate: '2026-10-26', endDate: '2026-10-26', start: '', end: '' },
  linkedMinutes: null,
};

describe('dateTimeRange', () => {
  it('adds minutes on the same day and refuses a next-day end', () => {
    expect(addClockMinutes('09:00', 30)).toBe('09:30');
    expect(addClockMinutes('23:00', 90)).toBeNull();
    expect(addClockMinutes('10:00', 0)).toBeNull();
  });

  it('fills an empty end from the default duration and keeps that link', () => {
    const filled = withStart(blank, '09:00', 30);
    expect(filled).toEqual({
      linkedMinutes: 30,
      range: { startDate: '2026-10-26', endDate: '2026-10-26', start: '09:00', end: '09:30' },
    });
    expect(withStart(filled, '10:15', 30)).toEqual({
      linkedMinutes: 30,
      range: { startDate: '2026-10-26', endDate: '2026-10-26', start: '10:15', end: '10:45' },
    });
  });

  it('leaves a hand-picked end in place when the start moves', () => {
    const picked = withEnd(
      {
        range: { startDate: '2026-10-26', endDate: '2026-10-26', start: '09:00', end: '09:30' },
        linkedMinutes: 30,
      },
      '11:00',
    );
    expect(picked.linkedMinutes).toBeNull();
    expect(withStart(picked, '10:00', 30).range).toEqual({
      startDate: '2026-10-26',
      endDate: '2026-10-26',
      start: '10:00',
      end: '11:00',
    });
  });

  it('sets the end from a duration chip on the start day', () => {
    const next = withDuration(
      {
        range: { startDate: '2026-10-26', endDate: '2026-10-28', start: '09:00', end: '18:00' },
        linkedMinutes: null,
      },
      120,
    );
    expect(next).toEqual({
      linkedMinutes: 120,
      range: { startDate: '2026-10-26', endDate: '2026-10-26', start: '09:00', end: '11:00' },
    });
    expect(sameDayDuration(next.range.start, next.range.end)).toBe(120);
  });

  it('keeps a multi-day range when the start clock is set', () => {
    const span = withDates(blank, '2026-10-26', '2026-10-28');
    expect(span.linkedMinutes).toBeNull();
    expect(withStart(span, '09:00', 30).range).toEqual({
      startDate: '2026-10-26',
      endDate: '2026-10-28',
      start: '09:00',
      end: '',
    });
  });

  it('counts hours across the date range', () => {
    expect(
      rangeDurationMinutes({
        startDate: '2026-10-26',
        endDate: '2026-10-27',
        start: '22:00',
        end: '01:00',
      }),
    ).toBe(180);
  });

  it('does not apply a duration that would pass midnight', () => {
    const late = {
      range: { startDate: '2026-10-26', endDate: '2026-10-26', start: '23:30', end: '' },
      linkedMinutes: null,
    };
    expect(withDuration(late, 60)).toBe(late);
    expect(withStart(late, '23:30', 60)).toEqual({
      linkedMinutes: null,
      range: { startDate: '2026-10-26', endDate: '2026-10-26', start: '23:30', end: '' },
    });
  });
});
