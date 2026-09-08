import {
  useGetEventsQuery,
  useUpdateEventMutation,
  useDeleteEventMutation,
} from '../../../api/eventsApi';
import { GoogleCalendarEvent } from '../../../api/google-calendar.api';

export {
  PAST_APP_EVENT_COLOR,
  eventEndMs,
  getEventColor,
  isPastAppEvent,
} from './eventAppearance';

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

export const useUpdateEvent = useUpdateEventMutation;
export const useDeleteEvent = useDeleteEventMutation;

export const useEventsForDay = (date: Date, calendarId?: string) => {
  const startOfDay = startOfLocalDay(date);
  const endOfDay = endOfLocalDay(date);
  return useGetEventsQuery({
    timeMin: startOfDay.toISOString(),
    timeMax: endOfDay.toISOString(),
    calendarId,
  });
};

export const useEventsForWeek = (dateInWeek: Date, calendarId?: string) => {
  const startOfWeek = startOfWeekMonday(dateInWeek);
  const endOfWeek = endOfLocalDay(
    new Date(startOfWeek.getFullYear(), startOfWeek.getMonth(), startOfWeek.getDate() + 6),
  );
  return useGetEventsQuery({
    timeMin: startOfWeek.toISOString(),
    timeMax: endOfWeek.toISOString(),
    calendarId,
  });
};

export const useEventsForMonth = (year: number, month: number, calendarId?: string) => {
  const startOfMonth = new Date(year, month - 1, 1);
  const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999);
  return useGetEventsQuery({
    timeMin: startOfMonth.toISOString(),
    timeMax: endOfMonth.toISOString(),
    calendarId,
  });
};

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

export const isEventToday = (event: GoogleCalendarEvent): boolean => {
  const today = new Date();
  const eventDate = event.start.dateTime
    ? new Date(event.start.dateTime)
    : new Date(event.start.date!);
  return eventDate.toDateString() === today.toDateString();
};
