import { format } from 'date-fns';
import { addDaysToYmd } from '../../utils/ianaDateTime';

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isYmdInRange(date: string, from: string, to: string): boolean {
  return date >= from && date <= to;
}

export function datesInclusive(from: string, to: string): string[] {
  if (!YMD_RE.test(from) || !YMD_RE.test(to) || from > to) return [];
  const dates: string[] = [];
  let cursor = from;
  while (cursor <= to && dates.length < 400) {
    dates.push(cursor);
    cursor = addDaysToYmd(cursor, 1);
  }
  return dates;
}

export function habitDoneOn(checkInDates: string[], date: string): boolean {
  return checkInDates.includes(date);
}

export function showHabitDots(input: {
  ymd: string;
  today: string;
  editableFrom: string;
  habitCount: number;
  anyDone: boolean;
}): boolean {
  if (input.habitCount === 0 || input.ymd > input.today) return false;
  if (input.ymd >= input.editableFrom) return true;
  return input.anyDone;
}

function civilDate(ymd: string): Date {
  const [year, month, day] = ymd.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function formatHabitDateLabel(ymd: string): string {
  return format(civilDate(ymd), 'EEE, MMM d');
}

export function formatHabitWeekday(ymd: string): string {
  return format(civilDate(ymd), 'EEE');
}

export function formatHabitDayNumber(ymd: string): string {
  return String(civilDate(ymd).getDate());
}
