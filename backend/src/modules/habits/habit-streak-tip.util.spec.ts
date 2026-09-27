import {
  fallbackHabitStreakTip,
  parseHabitStreakTip,
  pickStreakTipId,
} from './habit-streak-tip.util';

describe('habit-streak-tip.util', () => {
  describe('pickStreakTipId', () => {
    it('picks the highest streak among newly unlocked ids', () => {
      expect(
        pickStreakTipId(['first_check_in', 'streak_3', 'streak_7']),
      ).toBe('streak_7');
      expect(pickStreakTipId(['clean_week', 'first_check_in'])).toBeNull();
    });
  });

  describe('fallbackHabitStreakTip', () => {
    it('includes the habit name in English and Ukrainian', () => {
      expect(fallbackHabitStreakTip('Exercise', 'streak_3', 'en')).toContain(
        'Exercise',
      );
      expect(fallbackHabitStreakTip('Спорт', 'streak_7', 'uk')).toContain(
        'Спорт',
      );
    });
  });

  describe('parseHabitStreakTip', () => {
    it('reads tip from JSON and falls back on bad input', () => {
      expect(
        parseHabitStreakTip('{"tip":"  Nice work on yoga.  "}', 'fallback'),
      ).toBe('Nice work on yoga.');
      expect(parseHabitStreakTip('not-json', 'fallback')).toBe('fallback');
      expect(parseHabitStreakTip('{"tip":""}', 'fallback')).toBe('fallback');
    });
  });
});
