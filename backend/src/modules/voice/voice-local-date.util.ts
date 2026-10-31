import { isYmd } from '../day-reminders/day-reminder.dates';

const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export function localYmd(nowIso: string, timeZone: string): string {
  const date = new Date(nowIso);
  const instant = Number.isNaN(date.getTime()) ? new Date() : date;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

type YmdHm = { ymd: string; hm: string };

function hmToMinutes(hm: string): number {
  const [hour, minute] = hm.split(':').map(Number);
  return hour * 60 + minute;
}

/**
 * Wake-day "today" for speech.
 * The day that is ending lasts through three hours after sleep.
 * The day that is starting begins three hours before wake.
 * When three hours after sleep is later, the ending day lasts through that
 * later instant and the next day begins after it.
 * With no sleep time, the next day begins three hours before wake.
 */
export function scheduleTodayYmd(
  nowIso: string,
  timeZone: string,
  wakeTime?: string | null,
  sleepTime?: string | null,
): string {
  const cal = localYmd(nowIso, timeZone);
  const wake = normalizeClockHm(wakeTime || '08:00');
  const hm = localHm(nowIso, timeZone);
  const sleep = sleepTime?.trim() ? normalizeClockHm(sleepTime) : null;
  const now: YmdHm = { ymd: cal, hm };
  const wakeMinus = shiftClock(cal, wake, -180);
  if (!sleep) {
    return compareYmdHm(now, wakeMinus) >= 0 ? cal : addDaysToYmd(cal, -1);
  }
  const sleepYmd =
    hmToMinutes(sleep) < hmToMinutes(wake) ? cal : addDaysToYmd(cal, -1);
  const sleepPlus = shiftClock(sleepYmd, sleep, 180);
  if (compareYmdHm(sleepPlus, wakeMinus) > 0) {
    return compareYmdHm(now, sleepPlus) > 0 ? cal : addDaysToYmd(cal, -1);
  }
  return compareYmdHm(now, wakeMinus) >= 0 ? cal : addDaysToYmd(cal, -1);
}

/**
 * Blank day stays `todayYmd`. A present value must be a real civil date.
 * `2026-02-31` is rejected; it is not rolled into March.
 */
export function resolveScheduleDayYmd(
  raw: string,
  todayYmd: string,
): { day: string } | { error: 'invalid_day' } {
  const trimmed = raw.trim();
  if (!trimmed) return { day: todayYmd };
  if (!isYmd(trimmed)) return { error: 'invalid_day' };
  return { day: trimmed };
}

function shiftClock(ymd: string, hm: string, deltaMinutes: number): YmdHm {
  let total = hmToMinutes(hm) + deltaMinutes;
  let days = 0;
  while (total < 0) {
    total += 1440;
    days -= 1;
  }
  while (total >= 1440) {
    total -= 1440;
    days += 1;
  }
  const hour = Math.floor(total / 60);
  const minute = total % 60;
  return {
    ymd: addDaysToYmd(ymd, days),
    hm: `${pad2(hour)}:${pad2(minute)}`,
  };
}

function compareYmdHm(a: YmdHm, b: YmdHm): number {
  if (a.ymd !== b.ymd) return a.ymd < b.ymd ? -1 : 1;
  if (a.hm !== b.hm) return a.hm < b.hm ? -1 : 1;
  return 0;
}

export function addDaysToYmd(ymd: string, days: number): string {
  const [year, month, day] = ymd.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day + days));
  return utc.toISOString().slice(0, 10);
}

export function addMonthsToYmd(ymd: string, months: number): string {
  const [year, month, day] = ymd.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1 + months, day));
  return utc.toISOString().slice(0, 10);
}

export function weekdayIndex(ymd: string): number {
  const [year, month, day] = ymd.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * The coming occurrence of a weekday, never today: "on Sunday" said on a Sunday is next Sunday. Used for
 * the prompt's weekday line; the weekday contract (`this` includes today) stays in nextWeekdayYmd (V7).
 */
export function upcomingWeekdayYmd(todayYmd: string, weekday: number): string {
  const same = nextWeekdayYmd(todayYmd, weekday);
  return same === todayYmd ? addDaysToYmd(todayYmd, 7) : same;
}

export function nextWeekdayYmd(todayYmd: string, targetDow: number): string {
  const current = weekdayIndex(todayYmd);
  let delta = targetDow - current;
  if (delta < 0) delta += 7;
  return addDaysToYmd(todayYmd, delta);
}

export function offsetForTimeZone(timeZone: string, ymd: string): string {
  const probe = new Date(`${ymd}T12:00:00.000Z`);
  const raw =
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longOffset',
      year: 'numeric',
    })
      .formatToParts(probe)
      .find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  const match = raw.match(/([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!match) return '+00:00';
  return `${match[1]}${match[2].padStart(2, '0')}:${match[3] ?? '00'}`;
}

/**
 * Local midnight of a civil day with the offset in effect at midnight (a
 * skipped midnight moves forward). For scheduling day bounds; the older
 * startOfLocalDayIso (noon offset) is kept unchanged for its voice callers.
 */
export function civilDayStartIso(ymd: string, timeZone: string): string {
  return localDateTimeIso(ymd, '00:00', timeZone);
}

export function startOfLocalDayIso(ymd: string, timeZone: string): string {
  return `${ymd}T00:00:00${offsetForTimeZone(timeZone, ymd)}`;
}

export function endOfLocalDayIso(ymd: string, timeZone: string): string {
  return `${ymd}T23:59:00${offsetForTimeZone(timeZone, ymd)}`;
}

/** Minutes east of UTC in `timeZone` at one instant. */
function offsetMinutesAt(timeZone: string, instantMs: number): number {
  const raw =
    new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset', year: 'numeric' })
      .formatToParts(new Date(instantMs))
      .find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  const match = raw.match(/([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
  return match[1] === '-' ? -minutes : minutes;
}

function formatOffset(minutes: number): string {
  const abs = Math.abs(minutes);
  return `${minutes < 0 ? '-' : '+'}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

/**
 * The instant of a wall clock on a civil day, with the offset in effect at
 * that clock (not at noon: on a DST switch day the hours before the switch
 * have the other offset). A clock skipped by the switch moves forward by the
 * gap (02:30 → 03:30); a repeated clock is its first occurrence (RFC 5545).
 */
export function localDateTimeIso(
  ymd: string,
  hm: string,
  timeZone: string,
): string {
  const clock = normalizeClockHm(hm);
  const wallMs = Date.parse(`${ymd}T${clock}:00.000Z`);
  if (Number.isNaN(wallMs)) {
    return `${ymd}T${clock}:00${offsetForTimeZone(timeZone, ymd)}`;
  }
  const before = offsetMinutesAt(timeZone, wallMs - 86_400_000);
  const after = offsetMinutesAt(timeZone, wallMs + 86_400_000);
  // Larger offset first = earlier instant = first occurrence of a repeated clock.
  const valid = [...new Set([before, after])]
    .sort((a, b) => b - a)
    .find((offset) => offsetMinutesAt(timeZone, wallMs - offset * 60_000) === offset);
  return `${ymd}T${clock}:00${formatOffset(valid ?? before)}`;
}

export function localHm(nowIso: string, timeZone: string): string {
  const date = new Date(nowIso);
  const instant = Number.isNaN(date.getTime()) ? new Date() : date;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const hour = parts.find((part) => part.type === 'hour')?.value ?? '00';
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';
  return `${hour}:${minute}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Postgres `time` comes back as `08:00:00`; callers want `HH:mm`. */
export function normalizeClockHm(value: string | null | undefined): string {
  const match = String(value ?? '').match(/(\d{1,2}):(\d{2})/);
  if (!match) return '00:00';
  const hour = Number(match[1]);
  if (hour > 23) return '00:00';
  return `${pad2(hour)}:${match[2]}`;
}

/**
 * Stamp the user's zone onto the date and clock the model wrote.
 * A trailing Z or a numeric offset is not a conversion: those digits stay.
 */
export function rezoneWallClockIso(
  iso: string | null | undefined,
  timeZone: string,
): string | null {
  if (!iso) return null;
  const raw = String(iso).trim();
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/);
  if (!match) return iso;
  return localDateTimeIso(match[1], `${match[2]}:${match[3]}`, timeZone);
}

/**
 * Calendar anchors for the LLM. Relative-day / clock meaning is decided by the
 * model from the transcript — do not re-parse speech in TypeScript.
 */
export function buildLocalCalendarContext(
  nowIso: string,
  timeZone: string,
  wakeTime?: string | null,
  sleepTime?: string | null,
): string {
  const calendarToday = localYmd(nowIso, timeZone);
  const scheduleToday = scheduleTodayYmd(
    nowIso,
    timeZone,
    wakeTime,
    sleepTime,
  );
  const scheduleTomorrow = addDaysToYmd(scheduleToday, 1);
  const inThreeDays = addDaysToYmd(scheduleToday, 3);
  const clock = localHm(nowIso, timeZone);
  const weekday = WEEKDAY_NAMES[weekdayIndex(scheduleToday)];
  const sameWeekdayNextWeek = addDaysToYmd(scheduleToday, 7);
  const nextWeekdays = WEEKDAY_NAMES.map(
    (name, dow) => `${name} ${nextWeekdayYmd(scheduleToday, dow)}`,
  ).join(', ');
  return `Local calendar:
- now: ${calendarToday} ${clock}
- schedule today: ${scheduleToday} (${weekday}) = "today" in the speaker's language
- schedule tomorrow: ${scheduleTomorrow} = "tomorrow" in the speaker's language
- schedule +3 days: ${inThreeDays} = "in 3 days" in the speaker's language. Not a weekday name.
- next named weekday (no "last"; today counts): ${nextWeekdays}
- "next" + today's weekday (next Tuesday when schedule today is Tuesday): ${sameWeekdayNextWeek}. Not schedule today.
- civil date: ${calendarToday}${
    calendarToday !== scheduleToday
      ? ' (still the schedule day that is ending)'
      : ''
  }

Write every time as YYYY-MM-DDTHH:mm:00. No Z and no numeric offset. The digits are already the user's local time.
- Words for today/tomorrow (any language) map to schedule today/tomorrow above.
- The day that is ending lasts through three hours after sleep. The day that is starting begins three hours before wake. When three hours after sleep is later, the ending day lasts through that later instant and the next day begins after it. With no sleep time, the next day begins three hours before wake.
- That choice only picks the date. It does not make a later part of that day past.
- Relative "in N hours" (any language) = add N hours to the now clock above. Four hours after 13:00 is 17:00. Do not convert zones.
- Relative "in N days" (any language) = schedule today + N days.
- Day + clock: put the clock on that schedule day (never on schedule today when they said tomorrow).
- A named weekday with no "last" is the next one, including today when today is that weekday. Copy that date from the "next named weekday" line. When schedule today is Tuesday, Monday is the listed Monday, not schedule +3 days and not the Monday that already passed. On Saturday is the listed Saturday, not Thursday and not schedule +2 days. "next" plus today's weekday is the date on the "next + today's weekday" line, seven days later, not schedule today.
- Day without clock: flexible; earliest at Wake, deadline at Sleep that day; scheduledStart/End null. A deadline that names a day and no clock is Sleep.
- A spoken clock commits to that hour (kind fixed). An unspoken clock is not fixed. Approximate softens it (kind flexible, scheduledStart at the hour, never fixed). A softened ordinal is flexible preferred at the chosen place of that hour; length is only duration; the ordinal is not in the name.
- A spoken hour has two places twelve hours apart. A named morning or night locks that half. Otherwise the place still ahead of now. Both past → ask, do not move it to the next day. Twelve after noon is not midnight. A fraction toward an hour is the clock on that place, not the length.
- "in N hours" adds to the local clock. "after 18" earliest only. "by end of day" / "from now until 18" are windows. Named-event fill of a span is fixed; errand inside a span is a window.
- Before/after another activity: match Open tasks for the bound. No match → ask. After work / after lunch are preferred clocks, not that lookup.
- Morning is the first three hours after wake, not a fixed clock. It is past only when its end is before now. Now before it starts, including before wake, means it is still ahead on the named day. Do not ask and do not move it to the next day. It has ended and they named that day → ask whether they still want it. It has ended and they named no day → the same morning on the next day.
- Recurring: every morning/evening → DAILY; every N days → DAILY; last day of month → MONTHLY; weekly clock stays scheduledStart.
- No day and no clock: unscheduled. Spoken clock stays on the named day even when already past now.`;
}
