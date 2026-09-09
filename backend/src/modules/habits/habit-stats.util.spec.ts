import { addDaysToYmd } from '../voice/voice-local-date.util';
import { computeHabitStats, isValidYmd, lastNDays } from './habit-stats.util';

const TODAY = '2026-09-08';

function range(from: string, days: number): string[] {
  return Array.from({ length: days }, (_, i) => addDaysToYmd(from, i));
}

describe('habit-stats', () => {
  it('rejects impossible calendar dates', () => {
    expect(isValidYmd('2026-09-08')).toBe(true);
    expect(isValidYmd('2026-02-30')).toBe(false);
    expect(isValidYmd('09-08-2026')).toBe(false);
  });

  it('returns zeros with no check-ins', () => {
    expect(computeHabitStats([], TODAY)).toEqual({
      currentStreak: 0,
      points: 0,
      totalCheckIns: 0,
    });
  });

  it('counts today as a 1-day streak', () => {
    expect(computeHabitStats([TODAY], TODAY)).toEqual({
      currentStreak: 1,
      points: 1,
      totalCheckIns: 1,
    });
  });

  it('keeps the streak alive when only yesterday is checked', () => {
    expect(computeHabitStats(['2026-09-07'], TODAY)).toEqual({
      currentStreak: 1,
      points: 1,
      totalCheckIns: 1,
    });
  });

  it('breaks the streak when yesterday was missed', () => {
    expect(computeHabitStats(['2026-09-06'], TODAY)).toEqual({
      currentStreak: 0,
      points: 1,
      totalCheckIns: 1,
    });
  });

  it('adds a bonus point every 7 consecutive days', () => {
    const week = range('2026-09-01', 7);
    expect(computeHabitStats(week, TODAY)).toEqual({
      currentStreak: 7,
      points: 8,
      totalCheckIns: 7,
    });
  });

  it('adds two bonuses for a 14-day run through today', () => {
    const run = range('2026-08-26', 14);
    expect(computeHabitStats(run, TODAY)).toEqual({
      currentStreak: 14,
      points: 16,
      totalCheckIns: 14,
    });
  });

  it('keeps historical bonuses after a streak break', () => {
    const firstWeek = range('2026-08-20', 7);
    const later = ['2026-09-07', '2026-09-08'];
    expect(computeHabitStats([...firstWeek, ...later], TODAY)).toEqual({
      currentStreak: 2,
      points: 10,
      totalCheckIns: 9,
    });
  });

  it('builds last-7-day markers oldest-first', () => {
    expect(lastNDays(TODAY, 7, new Set(['2026-09-08', '2026-09-06']))).toEqual([
      { date: '2026-09-02', done: false },
      { date: '2026-09-03', done: false },
      { date: '2026-09-04', done: false },
      { date: '2026-09-05', done: false },
      { date: '2026-09-06', done: true },
      { date: '2026-09-07', done: false },
      { date: '2026-09-08', done: true },
    ]);
  });
});
