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

export function addDaysToYmd(ymd: string, days: number): string {
  const [year, month, day] = ymd.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day + days));
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

export function endOfLocalDayIso(ymd: string, timeZone: string): string {
  return `${ymd}T23:59:00${offsetForTimeZone(timeZone, ymd)}`;
}

export function inferDueYmd(transcript: string, todayYmd: string): string | null {
  const text = transcript.toLowerCase().replace(/[’']/g, "'");
  if (
    text.includes('післязавтра') ||
    text.includes('послезавтра') ||
    text.includes('day after tomorrow')
  ) {
    return addDaysToYmd(todayYmd, 2);
  }
  if (text.includes('завтра') || /\btomorrow\b/.test(text)) {
    return addDaysToYmd(todayYmd, 1);
  }
  if (text.includes('сьогодні') || text.includes('сегодня') || /\btoday\b/.test(text)) {
    return todayYmd;
  }

  const weekdays: Array<[number, RegExp]> = [
    [1, /понеділок|понедельник|\bmonday\b/],
    [2, /вівторк|вторник|\btuesday\b/],
    [3, /серед[ауи]|сред[ауы]|\bwednesday\b/],
    [4, /четверг?а?|\bthursday\b/],
    [5, /п'?ятниц|пятниц|\bfriday\b/],
    [6, /субот|суббот|\bsaturday\b/],
    [0, /неділ|воскресень|\bsunday\b/],
  ];
  for (const [dow, pattern] of weekdays) {
    if (pattern.test(text)) return nextWeekdayYmd(todayYmd, dow);
  }
  return null;
}

export function buildLocalCalendarContext(nowIso: string, timeZone: string): string {
  const today = localYmd(nowIso, timeZone);
  const tomorrow = addDaysToYmd(today, 1);
  const weekday = WEEKDAY_NAMES[weekdayIndex(today)];
  return `Local calendar (${timeZone}):
- today: ${today} (${weekday})
- tomorrow: ${tomorrow}
If the speaker names a calendar day without a clock time, set deadline to that day's 23:59 in this timezone. Keep eventType admin and leave scheduledStartTime/scheduledEndTime null.`;
}
