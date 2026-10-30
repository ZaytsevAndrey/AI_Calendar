import type { GoogleCalendarEvent } from 'api/google-calendar.api';
import { ymdFromLocalDate } from 'utils/ianaDateTime';

export type AllDayBar = {
  event: GoogleCalendarEvent;
  /** First and last visible column (inclusive). */
  from: number;
  to: number;
  row: number;
};

function eventDays(event: GoogleCalendarEvent): { start: string; endExclusive: string } | null {
  const start = event.start?.date ?? event.start?.dateTime?.slice(0, 10);
  if (!start) return null;
  const end = event.end?.date ?? event.end?.dateTime?.slice(0, 10);
  // Google all-day `end.date` is exclusive; a missing or equal end means one day.
  const endExclusive = end && end > start ? end : nextYmd(start);
  return { start, endExclusive };
}

function nextYmd(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return ymdFromLocalDate(new Date(y, m - 1, d + 1));
}

/**
 * All-day events as bars across the visible days. A bar spans every day it covers;
 * bars that overlap go to the next row.
 */
export function layoutAllDay(events: GoogleCalendarEvent[], days: Date[]): AllDayBar[] {
  const ymds = days.map(ymdFromLocalDate);
  const bars: Omit<AllDayBar, 'row'>[] = [];
  for (const event of events) {
    const span = eventDays(event);
    if (!span) continue;
    let from = -1;
    let to = -1;
    ymds.forEach((ymd, index) => {
      if (ymd >= span.start && ymd < span.endExclusive) {
        if (from < 0) from = index;
        to = index;
      }
    });
    if (from >= 0) bars.push({ event, from, to });
  }
  bars.sort((a, b) => a.from - b.from || b.to - b.from - (a.to - a.from));
  const rowsEnd: number[] = [];
  return bars.map((bar) => {
    let row = rowsEnd.findIndex((end) => end < bar.from);
    if (row < 0) {
      row = rowsEnd.length;
      rowsEnd.push(bar.to);
    } else {
      rowsEnd[row] = bar.to;
    }
    return { ...bar, row };
  });
}
