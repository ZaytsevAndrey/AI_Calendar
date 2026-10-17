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
- Concrete time commits to the hour (kind fixed). Approximate softens it (kind flexible, scheduledStart at the hour, never fixed). Softened ordinal: around the sixth is flexible preferred 18:00; length is only duration; ordinal is not in the name.
- Bare 1–7 afternoon unless morning/night. Quarter/half toward an hour is the clock (quarter to five → 16:45), not the length.
- "in N hours" adds to the local clock. "after 18" earliest only. "by end of day" / "from now until 18" are windows. Named-event fill of a span is fixed; errand inside a span is a window.
- Before/after another activity: match Open tasks for the bound. No match → ask. After work / after lunch are preferred clocks, not that lookup.
- Morning/evening with no day: preferred only (~09:00/~18:00); if past → nearest upcoming. Named day + evening/morning → preferred AND day envelope. Named day + morning already past → ask, do not keep rest of day.
- Recurring: every morning/evening → DAILY; every N days → DAILY; last day of month → MONTHLY; weekly clock stays scheduledStart.
- No day and no clock: unscheduled. Spoken clock stays on the named day even when already past now.
}`;
}
