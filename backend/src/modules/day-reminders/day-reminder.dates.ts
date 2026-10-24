export const DAY_REMINDER_PATTERNS = ['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY'] as const;

export type DayReminderPattern = (typeof DAY_REMINDER_PATTERNS)[number];

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const HM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function isYmd(value: string): boolean {
  const match = YMD.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= daysInMonth(year, month);
}

export function normalizeHm(value: string): string | null {
  const match = HM.exec(value.trim());
  if (!match) return null;
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

/** Civil days `later - earlier`. Negative when `later` is before `earlier`. */
export function diffDays(laterYmd: string, earlierYmd: string): number {
  const later = utcNoon(laterYmd);
  const earlier = utcNoon(earlierYmd);
  return Math.round((later - earlier) / 86_400_000);
}

export function overdueDays(dueYmd: string, todayYmd: string): number {
  return Math.max(0, diffDays(todayYmd, dueYmd));
}

export function addDays(ymd: string, days: number): string {
  const [year, month, day] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return formatUtc(date);
}

/** 0 = Sunday … 6 = Saturday, matching the task form. */
export function weekdayIndex(ymd: string): number {
  const [year, month, day] = ymd.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function dayOfMonth(ymd: string): number {
  return Number(ymd.slice(8, 10));
}

/**
 * Next open day after `dueYmd` is resolved.
 * Monthly day 31 (or any anchor the month lacks) lands on that month's last day.
 */
export function nextDueYmd(input: {
  dueYmd: string;
  pattern: DayReminderPattern;
  weekDays?: number[] | null;
  monthDay?: number | null;
}): string {
  if (input.pattern === 'DAILY') return addDays(input.dueYmd, 1);
  if (input.pattern === 'BIWEEKLY') return addDays(input.dueYmd, 14);
  if (input.pattern === 'WEEKLY') {
    const days =
      input.weekDays && input.weekDays.length > 0
        ? input.weekDays
        : [weekdayIndex(input.dueYmd)];
    for (let step = 1; step <= 7; step += 1) {
      const candidate = addDays(input.dueYmd, step);
      if (days.includes(weekdayIndex(candidate))) return candidate;
    }
    return addDays(input.dueYmd, 7);
  }
  const anchor = input.monthDay && input.monthDay >= 1 ? input.monthDay : dayOfMonth(input.dueYmd);
  return addMonths(input.dueYmd, anchor);
}

/** 15-minute window starting at `hm` on `ymd`. The end can fall on the next day. */
export function notificationWindow(
  ymd: string,
  hm: string,
): { startDateTime: string; endDateTime: string } {
  const clock = normalizeHm(hm) ?? '09:00';
  const [hour, minute] = clock.split(':').map(Number);
  const total = hour * 60 + minute + 15;
  const dayDelta = Math.floor(total / (24 * 60));
  const endMinutes = total % (24 * 60);
  const endHm = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;
  return {
    startDateTime: `${ymd}T${clock}:00`,
    endDateTime: `${addDays(ymd, dayDelta)}T${endHm}:00`,
  };
}

function addMonths(ymd: string, monthDay: number): string {
  const [year, month] = ymd.split('-').map(Number);
  let nextMonth = month + 1;
  let nextYear = year;
  if (nextMonth > 12) {
    nextMonth = 1;
    nextYear += 1;
  }
  const day = Math.min(monthDay, daysInMonth(nextYear, nextMonth));
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function utcNoon(ymd: string): number {
  const [year, month, day] = ymd.split('-').map(Number);
  return Date.UTC(year, month - 1, day, 12, 0, 0);
}

function formatUtc(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
