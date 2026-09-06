import {
  useGetEventsQuery,
  useUpdateEventMutation,
  useDeleteEventMutation,
} from '../../../api/eventsApi';
import { GoogleCalendarEvent } from '../../../api/google-calendar.api';

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

/**
 * For ranges that overlap today/future, skip days before today so past events are not fetched.
 * Fully historical ranges (e.g. yesterday) are left unchanged.
 */
export function clampRangeStartToToday(rangeStart: Date, rangeEnd: Date, now = new Date()): Date {
  const today = startOfLocalDay(now);
  if (rangeEnd.getTime() < today.getTime()) return rangeStart;
  return rangeStart.getTime() < today.getTime() ? today : rangeStart;
}

export function getGoogleEventEndMs(event: GoogleCalendarEvent): number | null {
  if (event.end?.dateTime) {
    const t = new Date(event.end.dateTime).getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (event.end?.date) {
    const t = new Date(`${event.end.date}T00:00:00`).getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (event.start?.dateTime) {
    const t = new Date(event.start.dateTime).getTime();
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

/** Still happening or upcoming; cancelled events are never current. */
export function isGoogleEventCurrent(event: GoogleCalendarEvent, nowMs = Date.now()): boolean {
  if (event.status === 'cancelled') return false;
  const endMs = getGoogleEventEndMs(event);
  if (endMs == null) return true;
  return endMs >= nowMs;
}

export function isCalendarRangeCurrentOrFuture(
  view: 'day' | 'week' | 'month',
  date: Date,
  now = new Date(),
): boolean {
  if (view === 'day') {
    return endOfLocalDay(date).getTime() >= now.getTime();
  }
  if (view === 'week') {
    const start = startOfWeekMonday(date);
    const end = endOfLocalDay(new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6));
    return end.getTime() >= now.getTime();
  }
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
  return end.getTime() >= now.getTime();
}

export function visibleGoogleEvents(
  events: GoogleCalendarEvent[],
  view: 'day' | 'week' | 'month',
  date: Date,
  now = new Date(),
): GoogleCalendarEvent[] {
  const nowMs = now.getTime();
  if (!isCalendarRangeCurrentOrFuture(view, date, now)) {
    return events.filter((event) => event.status !== 'cancelled');
  }
  return events.filter((event) => isGoogleEventCurrent(event, nowMs));
}

export const useUpdateEvent = useUpdateEventMutation;
export const useDeleteEvent = useDeleteEventMutation;

export const useEventsForDay = (date: Date, calendarId?: string) => {
  const startOfDay = startOfLocalDay(date);
  const endOfDay = endOfLocalDay(date);
  const timeMin = clampRangeStartToToday(startOfDay, endOfDay);
  return useGetEventsQuery({
    timeMin: timeMin.toISOString(),
    timeMax: endOfDay.toISOString(),
    calendarId,
  });
};

export const useEventsForWeek = (dateInWeek: Date, calendarId?: string) => {
  const startOfWeek = startOfWeekMonday(dateInWeek);
  const endOfWeek = endOfLocalDay(
    new Date(startOfWeek.getFullYear(), startOfWeek.getMonth(), startOfWeek.getDate() + 6),
  );
  const timeMin = clampRangeStartToToday(startOfWeek, endOfWeek);
  return useGetEventsQuery({
    timeMin: timeMin.toISOString(),
    timeMax: endOfWeek.toISOString(),
    calendarId,
  });
};

export const useEventsForMonth = (year: number, month: number, calendarId?: string) => {
  const startOfMonth = new Date(year, month - 1, 1);
  const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999);
  const timeMin = clampRangeStartToToday(startOfMonth, endOfMonth);
  return useGetEventsQuery({
    timeMin: timeMin.toISOString(),
    timeMax: endOfMonth.toISOString(),
    calendarId,
  });
};

// Keep utilities unchanged
export const formatEventTime = (event: GoogleCalendarEvent): string => {
  if (event.start.dateTime) {
    const startDate = new Date(event.start.dateTime);
    const endDate = event.end.dateTime ? new Date(event.end.dateTime) : null;
    const startTime = startDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    if (endDate) {
      const endTime = endDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      return `${startTime} - ${endTime}`;
    }
    return startTime;
  }
  return event.start.date || 'All day';
};

export const getEventColor = (event: GoogleCalendarEvent): string => {
  const colorMap: { [key: string]: string } = {
    '1': '#7986cb',
    '2': '#33b679',
    '3': '#8e63ce',
    '4': '#e67c73',
    '5': '#f6c026',
    '6': '#f5511d',
    '7': '#039be5',
    '8': '#616161',
    '9': '#3f51b5',
    '10': '#0b8043',
    '11': '#d60000',
  };
  return event.colorId ? colorMap[event.colorId] || '#039be5' : '#039be5';
};

export const isEventToday = (event: GoogleCalendarEvent): boolean => {
  const today = new Date();
  const eventDate = event.start.dateTime 
    ? new Date(event.start.dateTime)
    : new Date(event.start.date!);
  return eventDate.toDateString() === today.toDateString();
}; 