const RRULE_BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

export function toRruleUntilUtc(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

/** Set or replace RRULE UNTIL without changing FREQ/BYDAY/INTERVAL. */
export function setRruleUntil(rrule: string, until: Date): string {
  const untilToken = `UNTIL=${toRruleUntilUtc(until)}`;
  if (/UNTIL=/i.test(rrule)) {
    return rrule.replace(/UNTIL=[^;]*/i, untilToken);
  }
  return `${rrule};${untilToken}`;
}

function byDayList(weekDays: number[]): string {
  return [...new Set(weekDays)]
    .sort((a, b) => a - b)
    .map((d) => RRULE_BYDAY[d])
    .filter(Boolean)
    .join(',');
}

function withExdates(rrules: string[], excludeStarts?: Date[] | null): string[] {
  if (!excludeStarts?.length) return rrules;
  const stamps = [
    ...new Set(excludeStarts.map((start) => toRruleUntilUtc(start))),
  ].sort();
  if (!stamps.length) return rrules;
  return [...rrules, `EXDATE:${stamps.join(',')}`];
}

/**
 * One Google RRULE for a recurring task. UNTIL is the last scheduled start (inclusive).
 * DAILY + phase weekdays becomes WEEKLY+BYDAY so weekends/off-days are not invented.
 * Optional EXDATE covers user-skipped occurrences inside that window.
 */
export function buildGoogleRecurrenceRules(opts: {
  pattern?: string | null;
  firstStart: Date;
  lastStart: Date;
  weekDays?: number[] | null;
  excludeStarts?: Date[] | null;
}): string[] {
  const until = toRruleUntilUtc(opts.lastStart);
  const pattern = (opts.pattern || 'DAILY').toUpperCase();
  const weekdayFallback = [opts.firstStart.getDay()];
  const fromPhase = opts.weekDays?.length ? opts.weekDays : null;
  const ex = opts.excludeStarts;

  if (pattern === 'WEEKLY') {
    const by = byDayList(fromPhase ?? weekdayFallback);
    return withExdates([`RRULE:FREQ=WEEKLY;BYDAY=${by};UNTIL=${until}`], ex);
  }
  if (pattern === 'BIWEEKLY') {
    const by = byDayList(fromPhase ?? weekdayFallback);
    return withExdates(
      [`RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=${by};UNTIL=${until}`],
      ex,
    );
  }
  if (pattern === 'MONTHLY') {
    return withExdates([`RRULE:FREQ=MONTHLY;UNTIL=${until}`], ex);
  }
  if (fromPhase?.length) {
    const by = byDayList(fromPhase);
    if (by) {
      return withExdates(
        [`RRULE:FREQ=WEEKLY;BYDAY=${by};UNTIL=${until}`],
        ex,
      );
    }
  }
  return withExdates([`RRULE:FREQ=DAILY;UNTIL=${until}`], ex);
}
