const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

const WEEKDAY_PATTERNS: Array<[number, RegExp]> = [
  [1, /понеділок|понедельник|\bmonday\b/],
  [2, /вівторк|вторник|\btuesday\b/],
  [3, /серед[ауи]|сред[ауы]|\bwednesday\b/],
  [4, /четверг?а?|\bthursday\b/],
  [5, /п'?ятниц|пятниц|\bfriday\b/],
  [6, /субот|суббот|\bsaturday\b/],
  [0, /нед[іи]л[юяі]|воскресень|\bsunday\b/],
];

export type InferredScheduleWindow = {
  startYmd: string;
  endYmd: string;
  weekDays?: number[];
};

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

function namedWeekdaysInOrder(text: string): number[] {
  const hits: { dow: number; index: number }[] = [];
  for (const [dow, pattern] of WEEKDAY_PATTERNS) {
    const match = pattern.exec(text);
    if (match && match.index >= 0) {
      hits.push({ dow, index: match.index });
    }
  }
  hits.sort((a, b) => a.index - b.index);
  return hits.map((hit) => hit.dow);
}

function ymdOnOrAfter(fromYmd: string, dow: number): string {
  const first = nextWeekdayYmd(fromYmd, dow);
  return first < fromYmd ? addDaysToYmd(first, 7) : first;
}

function daysInYmdRange(startYmd: string, endYmd: string): number[] {
  const days: number[] = [];
  let cursor = startYmd;
  while (cursor <= endYmd) {
    days.push(weekdayIndex(cursor));
    cursor = addDaysToYmd(cursor, 1);
  }
  return days;
}

function isContiguousSelection(
  selected: number[],
  startYmd: string,
  endYmd: string,
): boolean {
  const span = daysInYmdRange(startYmd, endYmd);
  return (
    span.every((day) => selected.includes(day)) &&
    selected.every((day) => span.includes(day))
  );
}

function looksLikeDateRange(text: string, weekdayCount: number): boolean {
  if (/(?:^|\s)(?:з|с)\s+/.test(text) && /(?:^|\s)(?:по|до)\s+/.test(text)) {
    return true;
  }
  if (/\bfrom\b/.test(text) && /\bto\b/.test(text)) return true;
  return weekdayCount >= 2 && /\bto\b/.test(text);
}

function windowFromWeekdays(
  todayYmd: string,
  weekdays: number[],
  rangeLike: boolean,
): InferredScheduleWindow {
  const startYmd = nextWeekdayYmd(todayYmd, weekdays[0]);
  let endYmd = ymdOnOrAfter(startYmd, weekdays[weekdays.length - 1]);
  for (const dow of weekdays) {
    const ymd = ymdOnOrAfter(startYmd, dow);
    if (ymd > endYmd) endYmd = ymd;
  }
  const weekDays =
    !rangeLike &&
    weekdays.length > 1 &&
    !isContiguousSelection(weekdays, startYmd, endYmd)
      ? weekdays
      : undefined;
  return { startYmd, endYmd, weekDays };
}

export function inferClockHmRange(
  transcript: string,
): { startHm: string; endHm: string } | null {
  const text = transcript.toLowerCase();
  const stamped = [...text.matchAll(/\b(\d{1,2})[:.](\d{2})\b/g)];
  if (stamped.length >= 2) {
    const startH = Number(stamped[0][1]);
    const startM = Number(stamped[0][2]);
    const endH = Number(stamped[1][1]);
    const endM = Number(stamped[1][2]);
    if (
      startH <= 23 &&
      endH <= 23 &&
      startM <= 59 &&
      endM <= 59 &&
      endH * 60 + endM > startH * 60 + startM
    ) {
      return {
        startHm: `${pad2(startH)}:${pad2(startM)}`,
        endHm: `${pad2(endH)}:${pad2(endM)}`,
      };
    }
  }
  const loose = text.match(
    /(?:^|[^\p{L}])(?:з|с|from)\s+(\d{1,2})\s+(?:до|по|to)\s+(\d{1,2})(?:[^\p{L}]|$)/u,
  );
  if (loose) {
    const startH = Number(loose[1]);
    const endH = Number(loose[2]);
    if (startH <= 23 && endH <= 23 && endH > startH) {
      return { startHm: `${pad2(startH)}:00`, endHm: `${pad2(endH)}:00` };
    }
  }
  return null;
}

export function inferScheduleWindow(
  transcript: string,
  todayYmd: string,
): InferredScheduleWindow | null {
  const text = transcript.toLowerCase().replace(/[’']/g, "'");
  if (
    text.includes('післязавтра') ||
    text.includes('послезавтра') ||
    text.includes('day after tomorrow')
  ) {
    const ymd = addDaysToYmd(todayYmd, 2);
    return { startYmd: ymd, endYmd: ymd };
  }
  if (text.includes('завтра') || /\btomorrow\b/.test(text)) {
    const ymd = addDaysToYmd(todayYmd, 1);
    return { startYmd: ymd, endYmd: ymd };
  }
  if (text.includes('сьогодні') || text.includes('сегодня') || /\btoday\b/.test(text)) {
    return { startYmd: todayYmd, endYmd: todayYmd };
  }

  const weekdays = namedWeekdaysInOrder(text);
  if (weekdays.length === 1) {
    const ymd = nextWeekdayYmd(todayYmd, weekdays[0]);
    return { startYmd: ymd, endYmd: ymd };
  }
  if (weekdays.length >= 2) {
    return windowFromWeekdays(todayYmd, weekdays, looksLikeDateRange(text, weekdays.length));
  }
  return null;
}

export function inferDueYmd(transcript: string, todayYmd: string): string | null {
  return inferScheduleWindow(transcript, todayYmd)?.startYmd ?? null;
}

export function buildLocalCalendarContext(nowIso: string, timeZone: string): string {
  const today = localYmd(nowIso, timeZone);
  const tomorrow = addDaysToYmd(today, 1);
  const weekday = WEEKDAY_NAMES[weekdayIndex(today)];
  return `Local calendar (${timeZone}):
- today: ${today} (${weekday})
- tomorrow: ${tomorrow}
If the speaker names a calendar day or range without a clock time, set earliestStartTime to 00:00 of the first day and deadline to 23:59 of the last day (this timezone). Keep eventType admin. Do not set scheduledStartTime for day-only speech.`;
}
