import { format } from 'date-fns';
import { enGB } from 'date-fns/locale';
import { GoogleCalendarEvent } from '../../api/google-calendar.api';
import {
  minutesToTime,
  resolveActiveWindow,
  resolvePhaseRangeInActiveWindow,
} from '../phases/utils/phasesTimeUtils';
import { formatClock, formatLongDate, formatMonthYear, formatWeekRange } from '../../utils/formatDate';

export type CalendarView = 'day' | 'week' | 'month';

export type SleepWindow = {
  sleepTime?: string | null;
  wakeTime?: string | null;
};

export function startOfLocalDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfLocalDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/** Monday as week start (same convention as CalendarGrid). */
export function startOfWeekMonday(date: Date): Date {
  const d = startOfLocalDay(date);
  const dayOfWeek = d.getDay();
  const daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  d.setDate(d.getDate() - daysToSubtract);
  return d;
}

export function visibleGoogleEvents(events: GoogleCalendarEvent[]): GoogleCalendarEvent[] {
  return events.filter((event) => event.status !== 'cancelled');
}

export function eventStartDate(event: GoogleCalendarEvent): Date | null {
  if (event.start.dateTime) {
    const d = new Date(event.start.dateTime);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (event.start.date) {
    const d = new Date(`${event.start.date}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function eventEndDate(event: GoogleCalendarEvent): Date | null {
  if (event.end.dateTime) {
    const d = new Date(event.end.dateTime);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (event.end.date) {
    const d = new Date(`${event.end.date}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function isAllDayEvent(event: GoogleCalendarEvent): boolean {
  return !event.start.dateTime && !!event.start.date;
}

export function sameLocalDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

export function eventsForDay(
  events: GoogleCalendarEvent[],
  day: Date,
): GoogleCalendarEvent[] {
  return events.filter((event) => {
    const start = eventStartDate(event);
    return start ? sameLocalDay(start, day) : false;
  });
}

export function clockToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

export function isSleepClockTime(time: string, sleep?: SleepWindow): boolean {
  const timeMinutes = clockToMinutes(time);
  const hasCustom =
    Boolean(sleep?.sleepTime?.trim()) && Boolean(sleep?.wakeTime?.trim());
  const sleepStart = clockToMinutes(hasCustom ? sleep!.sleepTime! : '23:00');
  const sleepEnd = clockToMinutes(hasCustom ? sleep!.wakeTime! : '06:00');

  if (sleepStart > sleepEnd) {
    // [sleep, wake) so the wake hour is the first visible slot.
    return timeMinutes >= sleepStart || timeMinutes < sleepEnd;
  }
  return timeMinutes >= sleepStart && timeMinutes < sleepEnd;
}

function eventClockHm(event: GoogleCalendarEvent): string | null {
  if (!event.start.dateTime) return null;
  const start = new Date(event.start.dateTime);
  if (Number.isNaN(start.getTime())) return null;
  return start.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function isEventInSleepHours(
  event: GoogleCalendarEvent,
  sleep?: SleepWindow,
): boolean {
  const hm = eventClockHm(event);
  return hm ? isSleepClockTime(hm, sleep) : false;
}

const MINUTES_PER_DAY = 24 * 60;

export type ClockPhase = {
  startTime: string;
  endTime: string;
  type?: string | null;
  name?: string | null;
  weekDays?: number[] | null;
};

/** Personal-day minutes. `end` may be past 24:00 when sleep is after midnight. */
export type CalendarAxis = {
  startMin: number;
  endMin: number;
  /** Visible stretches inside the personal day. Gaps between phases are omitted. */
  segments: { start: number; end: number }[];
  spanMin: number;
};

export type VisibleHourBand = {
  label: string;
  /** Offset from the top of the visible axis, in minutes. */
  displayMin: number;
  durationMin: number;
  personalMin: number;
};

function clockHm(value: string): string {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return value.trim();
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

function wakeSleepClocks(sleep?: SleepWindow): { wake: string; sleep: string } {
  const hasCustom =
    Boolean(sleep?.sleepTime?.trim()) && Boolean(sleep?.wakeTime?.trim());
  return {
    wake: clockHm(hasCustom ? sleep!.wakeTime! : '06:00'),
    sleep: clockHm(hasCustom ? sleep!.sleepTime! : '23:00'),
  };
}

function addLocalDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function isSchedulablePhase(phase: ClockPhase): boolean {
  return phase.type !== 'sleep_time' && phase.type !== 'main_phase' && phase.name !== 'Focus hours';
}

function mergeSegments(
  ranges: { start: number; end: number }[],
): { start: number; end: number }[] {
  const sorted = ranges
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (!last || range.start > last.end) merged.push({ ...range });
    else last.end = Math.max(last.end, range.end);
  }
  return merged;
}

/** Wake until sleep. After-midnight hours before sleep belong to this personal day. */
export function personalDayWindow(sleep?: SleepWindow): {
  start: number;
  end: number;
  spansNextDay: boolean;
} {
  const clocks = wakeSleepClocks(sleep);
  return resolveActiveWindow(clocks.wake, clocks.sleep);
}

export function phasesForDays(phases: ClockPhase[], days: Date[]): ClockPhase[] {
  if (!days.length) return phases.filter(isSchedulablePhase);
  return phases.filter((phase) => {
    if (!isSchedulablePhase(phase)) return false;
    if (!phase.weekDays?.length) return true;
    return days.some((day) => phase.weekDays!.includes(day.getDay()));
  });
}

/**
 * Visible clock for one personal day.
 * Sleep is omitted. Hours no schedulable phase covers are omitted too.
 * With no phases, the whole wake-to-sleep window stays visible.
 * 00:00 until sleep is the end of the day, not a strip at the top.
 */
export function buildCalendarAxis(sleep?: SleepWindow, phases?: ClockPhase[]): CalendarAxis {
  const window = personalDayWindow(sleep);
  const schedulable = (phases ?? []).filter(isSchedulablePhase);
  let segments = schedulable.length
    ? mergeSegments(
        schedulable.map((phase) => {
          const range = resolvePhaseRangeInActiveWindow(
            phase.startTime,
            phase.endTime,
            window,
          );
          return {
            start: Math.max(range.start, window.start),
            end: Math.min(range.end, window.end),
          };
        }),
      )
    : [];
  if (!segments.length) {
    segments = [{ start: window.start, end: window.end }];
  }
  const spanMin = segments.reduce((total, segment) => total + (segment.end - segment.start), 0);
  return {
    startMin: window.start,
    endMin: window.end,
    segments,
    spanMin: Math.max(spanMin, 60),
  };
}

/** Map a personal-day minute onto the packed visible axis. Gap minutes return null. */
export function personalToDisplay(axis: CalendarAxis, personalMin: number): number | null {
  let offset = 0;
  for (const segment of axis.segments) {
    if (personalMin < segment.start) return null;
    if (personalMin <= segment.end) return offset + (personalMin - segment.start);
    offset += segment.end - segment.start;
  }
  return null;
}

/**
 * Inverse of `personalToDisplay`. A shared boundary between two visible
 * stretches belongs to the later stretch, so a drop lands on the next phase
 * rather than inside the hidden gap.
 */
export function displayToPersonal(axis: CalendarAxis, displayMin: number): number {
  const clamped = Math.max(0, Math.min(axis.spanMin, displayMin));
  let offset = 0;
  for (let index = 0; index < axis.segments.length; index += 1) {
    const segment = axis.segments[index];
    const length = segment.end - segment.start;
    const isLast = index === axis.segments.length - 1;
    if (clamped < offset + length || (isLast && clamped <= offset + length)) {
      return segment.start + (clamped - offset);
    }
    offset += length;
  }
  const last = axis.segments[axis.segments.length - 1];
  return last ? last.end : axis.startMin;
}

export function visibleHourBands(axis: CalendarAxis): VisibleHourBand[] {
  const bands: VisibleHourBand[] = [];
  for (const segment of axis.segments) {
    const firstHour = Math.floor(segment.start / 60);
    const lastHour = Math.ceil(segment.end / 60);
    for (let hour = firstHour; hour < lastHour; hour += 1) {
      const hourStart = hour * 60;
      const overlapStart = Math.max(hourStart, segment.start);
      const overlapEnd = Math.min(hourStart + 60, segment.end);
      if (overlapEnd <= overlapStart) continue;
      const displayMin = personalToDisplay(axis, overlapStart);
      if (displayMin == null) continue;
      bands.push({
        label: minutesToTime(overlapStart),
        displayMin,
        durationMin: overlapEnd - overlapStart,
        personalMin: overlapStart,
      });
    }
  }
  return bands;
}

/** Hour labels on the personal day, wake through the last hour before sleep. */
export function wakingHourSlots(sleep?: SleepWindow, phases?: ClockPhase[]): string[] {
  return visibleHourBands(buildCalendarAxis(sleep, phases)).map((band) => band.label);
}

function instantPersonalMinutes(
  instant: Date,
  columnDay: Date,
  axis: CalendarAxis,
  inclusiveEnd: boolean,
): number | null {
  const clock = instant.getHours() * 60 + instant.getMinutes();
  const column = startOfLocalDay(columnDay);
  const instantDay = startOfLocalDay(instant);
  const fits = (personal: number) =>
    personal >= axis.startMin &&
    (inclusiveEnd ? personal <= axis.endMin : personal < axis.endMin);

  if (sameLocalDay(instantDay, column)) {
    return fits(clock) ? clock : null;
  }
  if (axis.endMin > MINUTES_PER_DAY && sameLocalDay(instantDay, addLocalDays(column, 1))) {
    const wrapped = clock + MINUTES_PER_DAY;
    return fits(wrapped) ? wrapped : null;
  }
  return null;
}

function clipPersonalToDisplay(
  startMin: number,
  endMin: number,
  axis: CalendarAxis,
): { startMin: number; endMin: number } | null {
  let displayStart: number | null = null;
  let displayEnd: number | null = null;
  for (const segment of axis.segments) {
    const start = Math.max(startMin, segment.start);
    const end = Math.min(endMin, segment.end);
    if (end <= start) continue;
    const mappedStart = personalToDisplay(axis, start);
    const mappedEnd = personalToDisplay(axis, end);
    if (mappedStart == null || mappedEnd == null) continue;
    displayStart = displayStart == null ? mappedStart : Math.min(displayStart, mappedStart);
    displayEnd = displayEnd == null ? mappedEnd : Math.max(displayEnd, mappedEnd);
  }
  if (displayStart == null || displayEnd == null || displayEnd <= displayStart) return null;
  return { startMin: displayStart, endMin: displayEnd };
}

/** Timed event drawn on this personal-day column, in packed display minutes. */
export function eventDisplayRange(
  event: GoogleCalendarEvent,
  columnDay: Date,
  axis: CalendarAxis,
): { startMin: number; endMin: number } | null {
  if (!event.start.dateTime) return null;
  const start = eventStartDate(event);
  if (!start) return null;
  const end = eventEndDate(event) ?? new Date(start.getTime() + 15 * 60 * 1000);
  const personalStart = instantPersonalMinutes(start, columnDay, axis, false);
  if (personalStart == null) return null;
  let personalEnd = instantPersonalMinutes(end, columnDay, axis, true);
  if (personalEnd == null || personalEnd <= personalStart) {
    if (end.getTime() <= start.getTime()) return null;
    personalEnd = axis.endMin;
  }
  return clipPersonalToDisplay(personalStart, Math.min(personalEnd, axis.endMin), axis);
}

export function habitDisplayOnColumn(
  chipYmd: string,
  clockMin: number,
  durationMin: number,
  columnDay: Date,
  axis: CalendarAxis,
): { displayStart: number; displayDuration: number } | null {
  const columnYmd = format(startOfLocalDay(columnDay), 'yyyy-MM-dd');
  const nextYmd = format(addLocalDays(startOfLocalDay(columnDay), 1), 'yyyy-MM-dd');
  let personalStart: number | null = null;
  if (
    chipYmd === columnYmd &&
    clockMin >= axis.startMin &&
    clockMin < Math.min(axis.endMin, MINUTES_PER_DAY)
  ) {
    personalStart = clockMin;
  } else if (
    axis.endMin > MINUTES_PER_DAY &&
    chipYmd === nextYmd &&
    clockMin + MINUTES_PER_DAY < axis.endMin
  ) {
    personalStart = clockMin + MINUTES_PER_DAY;
  }
  if (personalStart == null) return null;
  const clipped = clipPersonalToDisplay(personalStart, personalStart + Math.max(durationMin, 1), axis);
  if (!clipped) return null;
  return {
    displayStart: clipped.startMin,
    displayDuration: clipped.endMin - clipped.startMin,
  };
}

export function eventsForHourSlot(
  events: GoogleCalendarEvent[],
  hour: number,
  sleep?: SleepWindow,
): GoogleCalendarEvent[] {
  return events.filter((event) => {
    if (!event.start.dateTime) return false;
    const start = new Date(event.start.dateTime);
    if (Number.isNaN(start.getTime())) return false;
    if (isEventInSleepHours(event, sleep)) return false;
    return start.getHours() === hour;
  });
}

/**
 * Chips for one personal day. All-day stays on the civil date.
 * A timed block after midnight and before sleep belongs to the previous personal day.
 * Blocks during sleep, or outside every schedulable phase, are omitted.
 */
export function gridEventsForDay(
  events: GoogleCalendarEvent[],
  day: Date,
  sleep?: SleepWindow,
  phases?: ClockPhase[],
): GoogleCalendarEvent[] {
  const axis = buildCalendarAxis(sleep, phases);
  return events.filter((event) => {
    if (!event.start.dateTime) {
      const start = eventStartDate(event);
      return start ? sameLocalDay(start, day) : false;
    }
    return eventDisplayRange(event, day, axis) != null;
  });
}

export function getDaysInView(view: CalendarView, date: Date): Date[] {
  const days: Date[] = [];

  switch (view) {
    case 'day': {
      days.push(new Date(date));
      break;
    }
    case 'week': {
      const startOfWeek = startOfWeekMonday(date);
      for (let i = 0; i < 7; i++) {
        const day = new Date(startOfWeek);
        day.setDate(startOfWeek.getDate() + i);
        days.push(day);
      }
      break;
    }
    case 'month': {
      const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
      const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0);
      const startOfWeek = new Date(startOfMonth);
      const firstDayOfWeek = startOfMonth.getDay();
      const daysToSubtract = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1;
      startOfWeek.setDate(startOfMonth.getDate() - daysToSubtract);

      const endOfWeek = new Date(endOfMonth);
      const lastDayOfWeek = endOfMonth.getDay();
      const daysToAdd = lastDayOfWeek === 0 ? 0 : 7 - lastDayOfWeek;
      endOfWeek.setDate(endOfMonth.getDate() + daysToAdd);

      const current = new Date(startOfWeek);
      while (current <= endOfWeek) {
        days.push(new Date(current));
        current.setDate(current.getDate() + 1);
      }
      break;
    }
  }

  return days;
}

export function eventsVisibleInView(
  view: CalendarView,
  date: Date,
  events: GoogleCalendarEvent[],
  sleep?: SleepWindow,
  phases?: ClockPhase[],
): GoogleCalendarEvent[] {
  const days = getDaysInView(view, date);
  const seen = new Set<string>();
  const visible: GoogleCalendarEvent[] = [];
  for (const day of days) {
    const dayEvents = gridEventsForDay(events, day, sleep, phases).filter((event) =>
      view === 'day' ? !!event.start.dateTime : true,
    );
    for (const event of dayEvents) {
      if (seen.has(event.id)) continue;
      seen.add(event.id);
      visible.push(event);
    }
  }
  return visible;
}

export function chipLabel(event: GoogleCalendarEvent): string {
  const title = event.summary || 'Event';
  if (!event.start.dateTime) return title;
  const start = new Date(event.start.dateTime);
  if (Number.isNaN(start.getTime())) return title;
  return `${formatClock(start)} ${title}`;
}

export function formatEventTime(event: GoogleCalendarEvent): string {
  if (event.start.dateTime) {
    const startDate = new Date(event.start.dateTime);
    const endDate = event.end.dateTime ? new Date(event.end.dateTime) : null;
    const startTime = startDate.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    if (endDate) {
      const endTime = endDate.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
      return `${startTime} - ${endTime}`;
    }
    return startTime;
  }
  return event.start.date || 'All day';
}

export function formatEventListDate(event: GoogleCalendarEvent): string {
  const start = eventStartDate(event);
  if (!start) return 'Time not set';
  return start.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatEventListTime(event: GoogleCalendarEvent): string {
  if (isAllDayEvent(event)) return 'All day';
  const start = eventStartDate(event);
  const end = eventEndDate(event);
  if (!start) return 'Time not set';
  const timeOpts: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  };
  const startLabel = start.toLocaleTimeString('en-GB', timeOpts);
  if (!end) return startLabel;
  return `${startLabel} – ${end.toLocaleTimeString('en-GB', timeOpts)}`;
}

export function tooltipText(event: GoogleCalendarEvent): string {
  const parts = [event.summary || 'Event', formatEventTime(event)];
  if (event.description) parts.push(event.description);
  if (event.location) parts.push(`Location: ${event.location}`);
  return parts.join('\n');
}

/** End of the last personal day. After-midnight sleep extends into the next civil morning. */
function personalDayQueryEnd(lastDay: Date, sleep?: SleepWindow): Date {
  const window = personalDayWindow(sleep);
  if (!window.spansNextDay) return endOfLocalDay(lastDay);
  const end = addLocalDays(startOfLocalDay(lastDay), 1);
  const tail = window.end - MINUTES_PER_DAY;
  end.setHours(Math.floor(tail / 60), tail % 60, 0, 0);
  return end;
}

export function eventsQueryRange(
  view: CalendarView,
  date: Date,
  sleep?: SleepWindow,
): { timeMin: string; timeMax: string } {
  if (view === 'day') {
    return {
      timeMin: startOfLocalDay(date).toISOString(),
      timeMax: personalDayQueryEnd(date, sleep).toISOString(),
    };
  }
  if (view === 'week') {
    const startOfWeek = startOfWeekMonday(date);
    const lastDay = new Date(
      startOfWeek.getFullYear(),
      startOfWeek.getMonth(),
      startOfWeek.getDate() + 6,
    );
    return {
      timeMin: startOfWeek.toISOString(),
      timeMax: personalDayQueryEnd(lastDay, sleep).toISOString(),
    };
  }
  const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
  const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return {
    timeMin: startOfMonth.toISOString(),
    timeMax: personalDayQueryEnd(endOfMonth, sleep).toISOString(),
  };
}

export function visibleRangeYmd(
  view: CalendarView,
  date: Date,
): { startDate: string; endDate: string } {
  if (view === 'day') {
    const day = format(date, 'yyyy-MM-dd');
    return { startDate: day, endDate: day };
  }
  if (view === 'week') {
    const start = startOfWeekMonday(date);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return {
      startDate: format(start, 'yyyy-MM-dd'),
      endDate: format(end, 'yyyy-MM-dd'),
    };
  }
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return {
    startDate: format(start, 'yyyy-MM-dd'),
    endDate: format(end, 'yyyy-MM-dd'),
  };
}

export function shiftPeriod(date: Date, view: CalendarView, delta: number): Date {
  const next = new Date(date);
  if (view === 'day') next.setDate(next.getDate() + delta);
  else if (view === 'week') next.setDate(next.getDate() + delta * 7);
  else next.setMonth(next.getMonth() + delta);
  return next;
}

export function periodLabel(date: Date, view: CalendarView): string {
  if (view === 'day') return formatLongDate(date);
  if (view === 'month') return formatMonthYear(date);
  const start = startOfWeekMonday(date);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return formatWeekRange(start, end);
}

/** Short label for the phone date control. The full periodLabel stays in the accessible name. */
export function compactPeriodLabel(date: Date, view: CalendarView): string {
  const loc = { locale: enGB };
  if (view === 'day') return format(date, 'EEE d MMM', loc);
  if (view === 'month') return format(date, 'MMM yyyy', loc);
  const start = startOfWeekMonday(date);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    return `${format(start, 'd', loc)}–${format(end, 'd MMM', loc)}`;
  }
  return `${format(start, 'd MMM', loc)}–${format(end, 'd MMM', loc)}`;
}
