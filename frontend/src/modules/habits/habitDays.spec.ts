import {
  datesInclusive,
  formatHabitDateLabel,
  habitDoneOn,
  isYmdInRange,
  showHabitDots,
} from './habitDays';

describe('habitDays', () => {
  it('builds an inclusive date range', () => {
    expect(datesInclusive('2026-09-07', '2026-09-09')).toEqual([
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
    ]);
    expect(datesInclusive('2026-09-09', '2026-09-07')).toEqual([]);
  });

  it('treats the editable window as inclusive', () => {
    expect(isYmdInRange('2026-08-26', '2026-08-26', '2026-09-08')).toBe(true);
    expect(isYmdInRange('2026-09-08', '2026-08-26', '2026-09-08')).toBe(true);
    expect(isYmdInRange('2026-08-25', '2026-08-26', '2026-09-08')).toBe(false);
    expect(isYmdInRange('2026-09-09', '2026-08-26', '2026-09-08')).toBe(false);
  });

  it('shows calendar dots for the editable window and older days that were done', () => {
    const base = {
      today: '2026-09-08',
      editableFrom: '2026-08-26',
      habitCount: 2,
    };
    expect(showHabitDots({ ...base, ymd: '2026-09-08', anyDone: false })).toBe(true);
    expect(showHabitDots({ ...base, ymd: '2026-09-09', anyDone: false })).toBe(false);
    expect(showHabitDots({ ...base, ymd: '2026-08-01', anyDone: true })).toBe(true);
    expect(showHabitDots({ ...base, ymd: '2026-08-01', anyDone: false })).toBe(false);
    expect(showHabitDots({ ...base, ymd: '2026-09-08', anyDone: false, habitCount: 0 })).toBe(
      false,
    );
  });

  it('reads done state from stored dates', () => {
    expect(habitDoneOn(['2026-09-08'], '2026-09-08')).toBe(true);
    expect(habitDoneOn(['2026-09-08'], '2026-09-07')).toBe(false);
  });

  it('formats a civil date without shifting the weekday', () => {
    expect(formatHabitDateLabel('2026-09-08')).toBe('Tue, Sep 8');
  });
});
