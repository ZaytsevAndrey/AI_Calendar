import { localYmd, weekdayIndex } from '../voice/voice-local-date.util';

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
  /** Civil weekday and month day are read in this zone (else the server's). */
  timeZone?: string | null;
  /** Series start (DTSTART); MONTHLY keeps its day of month. Defaults to `firstStart`. */
  anchorStart?: Date | null;
}): string[] {
  const until = toRruleUntilUtc(opts.lastStart);
  const pattern = (opts.pattern || 'DAILY').toUpperCase();
  const civilYmd = (date: Date) =>
    opts.timeZone
      ? localYmd(date.toISOString(), opts.timeZone)
      : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const weekdayFallback = [weekdayIndex(civilYmd(opts.firstStart))];
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
    // Same day as the series start; a 29th–31st falls back to the month end
    // (matches the local series days).
    const day = Number(civilYmd(opts.anchorStart ?? opts.firstStart).slice(8, 10));
    const byMonthDay =
      day <= 28
        ? `BYMONTHDAY=${day}`
        : `BYMONTHDAY=${Array.from({ length: day - 27 }, (_, i) => 28 + i).join(',')};BYSETPOS=-1`;
    return withExdates([`RRULE:FREQ=MONTHLY;${byMonthDay};UNTIL=${until}`], ex);
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
