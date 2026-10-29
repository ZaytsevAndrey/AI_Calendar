import { parseYmd } from './dateRange';
import { formatTimeValue, parseTimeValue } from './timeValue';

export type DateTimeRangeValue = {
  startDate: string;
  endDate: string;
  start: string;
  end: string;
};

export type DateTimeRangeEdit = {
  range: DateTimeRangeValue;
  /** Set when the end clock follows the start on the same civil day. */
  linkedMinutes: number | null;
};

export function clockMinutes(value: string): number | null {
  const parsed = parseTimeValue(value);
  if (!parsed) return null;
  return parsed.hours * 60 + parsed.minutes;
}

/** Same-day clock plus minutes. Null when the result is not strictly later that day. */
export function addClockMinutes(value: string, minutes: number): string | null {
  const base = clockMinutes(value);
  if (base == null || !Number.isFinite(minutes) || minutes <= 0) return null;
  const total = base + Math.trunc(minutes);
  if (total >= 24 * 60) return null;
  return formatTimeValue(Math.floor(total / 60), total % 60);
}

export function sameDayDuration(start: string, end: string): number | null {
  const from = clockMinutes(start);
  const to = clockMinutes(end);
  if (from == null || to == null || to <= from) return null;
  return to - from;
}

function civilDaySpan(startDate: string, endDate: string): number | null {
  const from = parseYmd(startDate);
  const to = parseYmd(endDate);
  if (!from || !to) return null;
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

/** Minutes from the start clock on the first day to the end clock on the last day. */
export function rangeDurationMinutes(value: DateTimeRangeValue): number | null {
  const startDate = value.startDate;
  const endDate = value.endDate || startDate;
  if (!startDate || !value.start || !value.end || endDate < startDate) return null;
  const from = clockMinutes(value.start);
  const to = clockMinutes(value.end);
  const days = civilDaySpan(startDate, endDate);
  if (from == null || to == null || days == null || days < 0) return null;
  const total = days * 24 * 60 + (to - from);
  return total > 0 ? total : null;
}

function sameCivilDay(range: DateTimeRangeValue): boolean {
  return !range.startDate || !range.endDate || range.startDate === range.endDate;
}

export function withDates(
  edit: DateTimeRangeEdit,
  startDate: string,
  endDate: string,
): DateTimeRangeEdit {
  return {
    linkedMinutes: startDate === endDate ? edit.linkedMinutes : null,
    range: { ...edit.range, startDate, endDate },
  };
}

/**
 * On one day, an empty end takes `defaultMinutes` and stays linked to the start.
 * A range of days keeps its end date. A hand-picked end clock stays put.
 */
export function withStart(
  edit: DateTimeRangeEdit,
  start: string,
  defaultMinutes: number,
): DateTimeRangeEdit {
  const minutes =
    edit.linkedMinutes ?? (edit.range.end || !sameCivilDay(edit.range) ? null : defaultMinutes);
  if (minutes == null) {
    return { linkedMinutes: null, range: { ...edit.range, start } };
  }
  const end = addClockMinutes(start, minutes);
  if (!end) {
    return { linkedMinutes: null, range: { ...edit.range, start, end: '' } };
  }
  return {
    linkedMinutes: minutes,
    range: {
      ...edit.range,
      start,
      end,
      endDate: edit.range.startDate || edit.range.endDate,
    },
  };
}

export function withEnd(edit: DateTimeRangeEdit, end: string): DateTimeRangeEdit {
  return { linkedMinutes: null, range: { ...edit.range, end } };
}

/** A duration chip keeps both clocks on the start day. */
export function withDuration(edit: DateTimeRangeEdit, minutes: number): DateTimeRangeEdit {
  if (!edit.range.start) return edit;
  const end = addClockMinutes(edit.range.start, minutes);
  if (!end) return edit;
  return {
    linkedMinutes: minutes,
    range: {
      ...edit.range,
      end,
      endDate: edit.range.startDate || edit.range.endDate,
    },
  };
}
