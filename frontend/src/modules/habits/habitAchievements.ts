import type { HabitAchievementId, HabitAchievementsMap } from 'api/habits.api';

/** Catalog order — keep in sync with backend habit-achievements.util. */
export const HABIT_ACHIEVEMENT_IDS: HabitAchievementId[] = [
  'first_check_in',
  'streak_3',
  'streak_7',
  'streak_30',
  'streak_100',
  'clean_week',
];

export function unlockedAchievementIds(
  achievements: HabitAchievementsMap | null | undefined,
): HabitAchievementId[] {
  if (!achievements) return [];
  return HABIT_ACHIEVEMENT_IDS.filter((id) => Boolean(achievements[id]));
}
