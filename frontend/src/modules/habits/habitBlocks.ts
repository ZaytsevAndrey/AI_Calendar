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
  done: boolean;
};

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
        done: habitDoneOn(habit.checkInDates ?? [], ymd),
      });
    }
  }
  return chips;
}
