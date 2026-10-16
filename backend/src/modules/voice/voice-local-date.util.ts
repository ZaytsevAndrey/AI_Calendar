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

/**
 * Wake-day "today" for speech.
 * After sleep, the civil date is the schedule day even when the clock is
 * still before wake. The previous wake-day continues only before an
 * overnight sleep (sleep after midnight, clock still before that sleep).
 * With no sleep time, a clock before wake still belongs to the previous civil date.
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
  if (sleep && sleep < wake) {
    if (hm < sleep) return addDaysToYmd(cal, -1);
    return cal;
  }
  if (sleep) return cal;
  if (hm < wake) return addDaysToYmd(cal, -1);
  return cal;
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

export function startOfLocalDayIso(ymd: string, timeZone: string): string {
  return `${ymd}T00:00:00${offsetForTimeZone(timeZone, ymd)}`;
}

export function endOfLocalDayIso(ymd: string, timeZone: string): string {
  return `${ymd}T23:59:00${offsetForTimeZone(timeZone, ymd)}`;
}

export function localDateTimeIso(
  ymd: string,
  hm: string,
  timeZone: string,
): string {
  return `${ymd}T${normalizeClockHm(hm)}:00${offsetForTimeZone(timeZone, ymd)}`;
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
 * Put a model ISO on the settings timezone.
 * A trailing Z is an absolute instant (relative "in N hours"): convert it.
 * A numeric offset is a spoken wall clock with a possibly wrong offset: keep the digits.
 */
export function rezoneWallClockIso(
  iso: string | null | undefined,
  timeZone: string,
): string | null {
  if (!iso) return null;
  const raw = String(iso).trim();
  if (/z$/i.test(raw)) {
    const ymd = localYmd(raw, timeZone);
    const hm = localHm(raw, timeZone);
    if (!ymd || !hm) return raw;
    return localDateTimeIso(ymd, hm, timeZone);
  }
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
  return `Local calendar (${timeZone}):
- now ISO: ${nowIso}
- now local clock: ${clock}
- schedule today: ${scheduleToday} (${weekday}) = "today" in the speaker's language
- schedule tomorrow: ${scheduleTomorrow} = "tomorrow" in the speaker's language
- schedule +3 days: ${inThreeDays} = "in 3 days" in the speaker's language. Not a weekday name.
- next named weekday (no "last"; today counts): ${nextWeekdays}
- "next" + today's weekday (next Tuesday when schedule today is Tuesday): ${sameWeekdayNextWeek}. Not schedule today.
- civil date: ${calendarToday}${
    calendarToday !== scheduleToday
      ? ' (before overnight sleep = still previous wake-day)'
      : ''
  }

Resolve all dates yourself into ISO-8601 with numeric offset:
- Words for today/tomorrow (any language) map to schedule today/tomorrow above.
- After sleep, those anchors are the civil date even when the clock is still before wake.
- Before an overnight sleep (clock still before sleep, sleep after midnight), schedule today is the previous civil date.
- Relative "in N hours" (any language) = now ISO + N hours.
- Relative "in N days" (any language) = schedule today + N days.
- Day + clock: put the clock on that schedule day (never on schedule today when they said tomorrow).
- A named weekday with no "last" is the next one, including today when today is that weekday. Copy that date from the "next named weekday" line. When schedule today is Tuesday, Monday is the listed Monday, not schedule +3 days and not the Monday that already passed. On Saturday is the listed Saturday, not Thursday and not schedule +2 days. "next" plus today's weekday is the date on the "next + today's weekday" line, seven days later, not schedule today.
- Day without clock: flexible; earliest 00:00, deadline 23:59 that day; scheduledStart/End null.
- An afternoon ordinal ("the second of the day", two in the afternoon) is a clock at 14:00, not a calendar day and not tomorrow. A hedge makes it a preferred time: set scheduledStart to 14:00. Do not leave only a 00:00–23:59 window.
- Concrete time: they commit to the hour. Kind fixed.
- Approximate time: they soften that same hour. Kind flexible, scheduledStart at the hour. A number next to the softener stays the preferred hour and does not become fixed. Read the softening in the speaker's language. English "around" is only an example of the meaning, not a word to search for. "three" is 15:00, 16 stays 16:00.
- "around after three" is the same preferred time at 15:00 with scheduledStart set. Not an earliest-only bound.
- Bare hours 1–7 with no morning or night word are afternoon: "at 4" is 16:00, not 04:00.
- "half an hour before six", with no morning word, is 17:30, not 05:30.
- "in three hours" when the local clock is 13:00 is 16:00, not 13:00.
- "in four hours" when the local clock is 13:00 is 17:00, not 14:00. Add the hours to the local clock. Do not add them to the UTC hour and keep +03:00. No spoken length → default duration, understanding complete. Do not ask how long.
- "around noon" when it is already afternoon is a flexible preferred tomorrow at 12:00. Not fixed, and not a rest-of-today window.
- "after 18" is earliest 18:00 with scheduledStart null, not a fixed meeting at 18:00.
- "by end of day" is a deadline at 23:59 on schedule today, kind flexible, scheduledStart null. Not an unscheduled inbox item. The errand is the task name ("close the ticket").
- Morning or evening with no named day is a preferred clock only: morning ~09:00, evening ~18:00. earliest and deadline null. If that part of day is already past, use the nearest upcoming one. Morning already past → tomorrow ~09:00. Do not add a 00:00–23:59 envelope.
- "after work" is a flexible preferred around 18:00.
- "today in the evening", with no numbered clock, is a flexible preferred around 18:00 AND a day envelope: earliest 00:00, deadline 23:59 schedule today. Do not leave only the 18:00 slot.
- "at 15? no, better at 17" cancels 15:00. The last clock is fixed 17:00 on the named day. Not flexible and not a 00:00–23:59 envelope. "better at" inside a from–to span is still a preferred start, not this case.
- "tomorrow morning", with no numbered clock, is a flexible preferred around 09:00 AND earliest 00:00, deadline 23:59 schedule tomorrow.
- A named event that fills the span ("a conference tomorrow from 9 to 18") is fixed: scheduledStart at 09:00, scheduledEnd at 18:00, duration is those hours. Not a placement window.
- "edit a video tomorrow from 16 to 20" is a window: earliest 16:00, deadline 20:00, scheduledStart null. An errand inside the span is not a meeting that lasts the whole span.
- "tomorrow from 10 to 14 make calls, better at 11, for half an hour" is still that window: earliest 10:00, deadline 14:00, scheduledStart 11:00, duration 30. "better at" is a preferred start inside the span, not a fixed meeting. Do not drop the window.
- A placement window with no spoken length uses the default duration. understanding complete. Do not ask how long, even for a trip. "on Saturday between 10 and 14 go to the dacha" is that window on the listed Saturday.
- "every morning" and "every evening" are a daily repeat at that clock, kind recurring DAILY. Not one occurrence today. Morning keeps 7 at 07:00.
- A repeat with a clock ("English every Wednesday at 19") keeps that hour as scheduledStart. Do not drop it because that weekday is not schedule today.
- No day and no clock (and not a clear recurring pattern): unscheduled inbox; do not invent a day.
- New tasks: put a spoken clock on the day they named, even when that instant is already before now ISO. Do not erase it and do not move a concrete clock to tomorrow.`;
}
