import { addDaysToYmd } from '../voice/voice-local-date.util';
import { isValidYmd } from './habit-stats.util';

/** Catalog ids unlocked per habit (persisted as id → unlockedAt ISO). */
export const HABIT_ACHIEVEMENT_IDS = [
  'first_check_in',
  'streak_3',
  'streak_7',
  'streak_30',
  'streak_100',
  'clean_week',
] as const;

export type HabitAchievementId = (typeof HABIT_ACHIEVEMENT_IDS)[number];

export type HabitAchievementsMap = Partial<Record<HabitAchievementId, string>>;

const STREAK_THRESHOLDS: Array<{ id: HabitAchievementId; days: number }> = [
  { id: 'streak_3', days: 3 },
  { id: 'streak_7', days: 7 },
  { id: 'streak_30', days: 30 },
  { id: 'streak_100', days: 100 },
];

/** UTC weekday for a civil YYYY-MM-DD (0 = Sunday … 6 = Saturday). */
function utcWeekday(ymd: string): number {
  const [year, month, day] = ymd.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function maxConsecutiveRun(checkInYmds: string[]): number {
  const dates = [...new Set(checkInYmds.filter(isValidYmd))].sort();
  let max = 0;
  let run = 0;
  let previous: string | null = null;
  for (const ymd of dates) {
    run = previous && ymd === addDaysToYmd(previous, 1) ? run + 1 : 1;
    if (run > max) max = run;
    previous = ymd;
  }
  return max;
}

/** True when any Mon–Sun civil week is fully checked in. */
export function hasCleanWeek(checkInYmds: string[]): boolean {
  const done = new Set(checkInYmds.filter(isValidYmd));
  for (const ymd of done) {
    if (utcWeekday(ymd) !== 1) continue;
    let ok = true;
    for (let i = 0; i < 7; i += 1) {
      if (!done.has(addDaysToYmd(ymd, i))) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

/** Achievement ids currently earned from check-in history (order matches catalog). */
export function evaluateHabitAchievements(
  checkInYmds: string[],
): HabitAchievementId[] {
  const dates = [...new Set(checkInYmds.filter(isValidYmd))];
  const earned: HabitAchievementId[] = [];
  if (dates.length >= 1) earned.push('first_check_in');

  const maxRun = maxConsecutiveRun(dates);
  for (const { id, days } of STREAK_THRESHOLDS) {
    if (maxRun >= days) earned.push(id);
  }
  if (hasCleanWeek(dates)) earned.push('clean_week');
  return earned;
}

/**
 * Merge newly earned ids into the stored map. Existing unlockedAt values stay.
 * Returns ids that were not present before (for a one-time toast).
 */
export function mergeHabitAchievements(
  existing: HabitAchievementsMap | null | undefined,
  earned: readonly HabitAchievementId[],
  unlockedAtIso: string,
): { next: HabitAchievementsMap; newlyUnlocked: HabitAchievementId[] } {
  const next: HabitAchievementsMap = { ...(existing ?? {}) };
  const newlyUnlocked: HabitAchievementId[] = [];
  for (const id of earned) {
    if (next[id]) continue;
    next[id] = unlockedAtIso;
    newlyUnlocked.push(id);
  }
  return { next, newlyUnlocked };
}
