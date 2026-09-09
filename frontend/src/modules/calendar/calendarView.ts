import { format } from 'date-fns';
import { GoogleCalendarEvent } from '../../api/google-calendar.api';
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

/** Hour labels shown on the day grid (sleep hours omitted). */
export function wakingHourSlots(sleep?: SleepWindow): string[] {
  const slots: string[] = [];
  for (let hour = 0; hour < 24; hour++) {
    const time = `${hour.toString().padStart(2, '0')}:00`;
    if (!isSleepClockTime(time, sleep)) slots.push(time);
  }
  return slots;
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

/** Week/month chips: all-day stays visible; timed events in sleep hours are hidden. */
export function gridEventsForDay(
  events: GoogleCalendarEvent[],
  day: Date,
  sleep?: SleepWindow,
): GoogleCalendarEvent[] {
  return eventsForDay(events, day).filter(
    (event) => !event.start.dateTime || !isEventInSleepHours(event, sleep),
  );
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
): GoogleCalendarEvent[] {
  const days = getDaysInView(view, date);
  const seen = new Set<string>();
  const visible: GoogleCalendarEvent[] = [];
  for (const day of days) {
    const dayEvents =
      view === 'day'
        ? eventsForDay(events, day).filter((event) => {
            if (!event.start.dateTime) return false;
            return !isEventInSleepHours(event, sleep);
          })
        : gridEventsForDay(events, day, sleep);
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

export function eventsQueryRange(
  view: CalendarView,
  date: Date,
): { timeMin: string; timeMax: string } {
  if (view === 'day') {
    return {
      timeMin: startOfLocalDay(date).toISOString(),
      timeMax: endOfLocalDay(date).toISOString(),
    };
  }
  if (view === 'week') {
    const startOfWeek = startOfWeekMonday(date);
    return {
      timeMin: startOfWeek.toISOString(),
      timeMax: endOfLocalDay(
        new Date(
          startOfWeek.getFullYear(),
          startOfWeek.getMonth(),
          startOfWeek.getDate() + 6,
        ),
      ).toISOString(),
    };
  }
  const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
  const endOfMonth = new Date(
    date.getFullYear(),
    date.getMonth() + 1,
    0,
    23,
    59,
    59,
    999,
  );
  return {
    timeMin: startOfMonth.toISOString(),
    timeMax: endOfMonth.toISOString(),
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
