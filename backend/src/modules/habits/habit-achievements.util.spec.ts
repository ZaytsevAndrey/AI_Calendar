import {
  evaluateHabitAchievements,
  hasCleanWeek,
  maxConsecutiveRun,
  mergeHabitAchievements,
} from './habit-achievements.util';

describe('habit-achievements.util', () => {
  describe('maxConsecutiveRun', () => {
    it('returns 0 for empty history', () => {
      expect(maxConsecutiveRun([])).toBe(0);
    });

    it('counts the longest consecutive run', () => {
      expect(
        maxConsecutiveRun([
          '2026-09-01',
          '2026-09-02',
          '2026-09-03',
          '2026-09-05',
          '2026-09-06',
        ]),
      ).toBe(3);
    });
  });

  describe('hasCleanWeek', () => {
    it('is true when a Mon–Sun week is fully checked', () => {
      // 2026-09-07 is Monday
      const week = [
        '2026-09-07',
        '2026-09-08',
        '2026-09-09',
        '2026-09-10',
        '2026-09-11',
        '2026-09-12',
        '2026-09-13',
      ];
      expect(hasCleanWeek(week)).toBe(true);
      expect(hasCleanWeek(week.slice(0, 6))).toBe(false);
    });
  });

  describe('evaluateHabitAchievements', () => {
    it('unlocks first_check_in and streak thresholds from history', () => {
      // Tue–Mon run: streak 7, but not a Mon–Sun clean week
      const seven = [
        '2026-09-01',
        '2026-09-02',
        '2026-09-03',
        '2026-09-04',
        '2026-09-05',
        '2026-09-06',
        '2026-09-07',
      ];
      expect(evaluateHabitAchievements(seven)).toEqual([
        'first_check_in',
        'streak_3',
        'streak_7',
      ]);
    });

    it('unlocks clean_week for a full Mon–Sun week', () => {
      const week = [
        '2026-09-07',
        '2026-09-08',
        '2026-09-09',
        '2026-09-10',
        '2026-09-11',
        '2026-09-12',
        '2026-09-13',
      ];
      expect(evaluateHabitAchievements(week)).toEqual([
        'first_check_in',
        'streak_3',
        'streak_7',
        'clean_week',
      ]);
    });

    it('returns nothing with no check-ins', () => {
      expect(evaluateHabitAchievements([])).toEqual([]);
    });
  });

  describe('mergeHabitAchievements', () => {
    it('records unlockedAt only for new ids', () => {
      const { next, newlyUnlocked } = mergeHabitAchievements(
        { first_check_in: '2026-01-01T00:00:00.000Z' },
        ['first_check_in', 'streak_3'],
        '2026-09-08T12:00:00.000Z',
      );
      expect(newlyUnlocked).toEqual(['streak_3']);
      expect(next.first_check_in).toBe('2026-01-01T00:00:00.000Z');
      expect(next.streak_3).toBe('2026-09-08T12:00:00.000Z');
    });
  });
});
