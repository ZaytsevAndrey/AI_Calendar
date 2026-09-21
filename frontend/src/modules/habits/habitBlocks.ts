import type { HabitDTO } from '../../api/habits.api';
import { localDateTimeIso, ymdFromLocalDate } from '../../utils/ianaDateTime';
import { habitDoneOn } from './habitDays';

export type HabitBlockChip = {
  id: string;
  habitId: string;
  name: string;
  color: string;
  ymd: string;
  start: Date;
  /** Minutes from midnight of the reserved clock time, not the browser zone. */
  startMinutes: number;
  done: boolean;
};

export function clockMinutes(hm: string): number {
  const match = hm.match(/(\d{1,2}):(\d{2})/);
  if (!match) return 0;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return 0;
  return hour * 60 + minute;
}

export function isHabitGoogleEvent(
  habitEventIds: ReadonlySet<string>,
  event: { id?: string | null; recurringEventId?: string | null },
): boolean {
  if (event.id && habitEventIds.has(event.id)) return true;
  if (event.recurringEventId && habitEventIds.has(event.recurringEventId)) return true;
  return false;
}

export function habitBlockChips(
  habits: HabitDTO[],
  days: Date[],
  timeZone: string,
): HabitBlockChip[] {
  const reserved = habits.filter(
    (habit) => habit.blockStartTime && habit.blockMinutes && habit.blockMinutes > 0,
  );
  const chips: HabitBlockChip[] = [];
  for (const day of days) {
    const ymd = ymdFromLocalDate(day);
    for (const habit of reserved) {
      const start = new Date(localDateTimeIso(ymd, habit.blockStartTime as string, timeZone));
      if (Number.isNaN(start.getTime())) continue;
      chips.push({
        id: `${habit.id}:${ymd}`,
        habitId: habit.id,
        name: habit.name,
        color: habit.color,
        ymd,
        start,
        startMinutes: clockMinutes(habit.blockStartTime as string),
        done: habitDoneOn(habit.checkInDates ?? [], ymd),
      });
    }
  }
  return chips;
}
