const RRULE_BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

export function toRruleUntilUtc(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

function byDayList(weekDays: number[]): string {
  return [...new Set(weekDays)]
    .sort((a, b) => a - b)
    .map((d) => RRULE_BYDAY[d])
    .filter(Boolean)
    .join(',');
}

/**
 * One Google RRULE for a recurring task. UNTIL is the last scheduled start (inclusive).
 * DAILY + phase weekdays becomes WEEKLY+BYDAY so weekends/off-days are not invented.
 */
export function buildGoogleRecurrenceRules(opts: {
  pattern?: string | null;
  firstStart: Date;
  lastStart: Date;
  weekDays?: number[] | null;
}): string[] {
  const until = toRruleUntilUtc(opts.lastStart);
  const pattern = (opts.pattern || 'DAILY').toUpperCase();
  const weekdayFallback = [opts.firstStart.getDay()];
  const fromPhase = opts.weekDays?.length ? opts.weekDays : null;

  if (pattern === 'WEEKLY') {
    const by = byDayList(fromPhase ?? weekdayFallback);
    return [`RRULE:FREQ=WEEKLY;BYDAY=${by};UNTIL=${until}`];
  }
  if (pattern === 'BIWEEKLY') {
    const by = byDayList(fromPhase ?? weekdayFallback);
    return [`RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=${by};UNTIL=${until}`];
  }
  if (pattern === 'MONTHLY') {
    return [`RRULE:FREQ=MONTHLY;UNTIL=${until}`];
  }
  if (fromPhase?.length) {
    const by = byDayList(fromPhase);
    if (by) return [`RRULE:FREQ=WEEKLY;BYDAY=${by};UNTIL=${until}`];
  }
  return [`RRULE:FREQ=DAILY;UNTIL=${until}`];
}
