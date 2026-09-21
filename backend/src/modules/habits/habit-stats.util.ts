import { addDaysToYmd } from '../voice/voice-local-date.util';

/** Inclusive window ending today. Older check-ins stay visible but are not editable. */
export const CHECK_IN_WINDOW_DAYS = 14;

export type HabitStats = {
  currentStreak: number;
  points: number;
  totalCheckIns: number;
};

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidYmd(value: string): boolean {
  if (!YMD_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  return (
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() === month - 1 &&
    utc.getUTCDate() === day
  );
}

/**
 * Streak: consecutive days ending today, or yesterday if today is not yet checked.
 * Points: +1 per successful day, plus +1 each time a consecutive run hits a multiple of 7.
 */
export function computeHabitStats(
  checkInYmds: string[],
  todayYmd: string,
): HabitStats {
  const dates = [...new Set(checkInYmds.filter(isValidYmd))].sort();
  const done = new Set(dates);

  let currentStreak = 0;
  let cursor = done.has(todayYmd) ? todayYmd : addDaysToYmd(todayYmd, -1);
  while (done.has(cursor)) {
    currentStreak += 1;
    cursor = addDaysToYmd(cursor, -1);
  }

  let points = 0;
  let run = 0;
  let previous: string | null = null;
  for (const ymd of dates) {
    run = previous && ymd === addDaysToYmd(previous, 1) ? run + 1 : 1;
    points += 1;
    if (run % 7 === 0) points += 1;
    previous = ymd;
  }

  return {
    currentStreak,
    points,
    totalCheckIns: dates.length,
  };
}

export function checkInEditableFrom(todayYmd: string): string {
  return addDaysToYmd(todayYmd, 1 - CHECK_IN_WINDOW_DAYS);
}

export function isCheckInDateAllowed(date: string, todayYmd: string): boolean {
  if (!isValidYmd(date) || !isValidYmd(todayYmd)) return false;
  return date >= checkInEditableFrom(todayYmd) && date <= todayYmd;
}
