import { addDaysToYmd, localDateTimeIso } from '../voice/voice-local-date.util';

export type HabitBlockSource = {
  blockStartTime: string | null;
  blockMinutes: number | null;
};

export type HabitBlockInterval = { start: number; end: number };

const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Daily reservations from `startYmd` inclusive to `endYmdExclusive`.
 * Habits without both a start time and a duration are ignored.
 */
export function habitBlockIntervals(
  habits: HabitBlockSource[],
  startYmd: string,
  endYmdExclusive: string,
  timeZone: string,
): HabitBlockInterval[] {
  const blocks = habits.filter(
    (habit) =>
      habit.blockStartTime &&
      HM_RE.test(habit.blockStartTime) &&
      typeof habit.blockMinutes === 'number' &&
      Number.isInteger(habit.blockMinutes) &&
      habit.blockMinutes > 0,
  );
  if (!blocks.length || startYmd >= endYmdExclusive) return [];

  const intervals: HabitBlockInterval[] = [];
  let cursor = startYmd;
  while (cursor < endYmdExclusive && intervals.length < 20000) {
    for (const habit of blocks) {
      const start = new Date(
        localDateTimeIso(cursor, habit.blockStartTime as string, timeZone),
      ).getTime();
      const end = start + (habit.blockMinutes as number) * 60_000;
      if (Number.isFinite(start) && end > start) {
        intervals.push({ start, end });
      }
    }
    cursor = addDaysToYmd(cursor, 1);
  }
  return intervals;
}
