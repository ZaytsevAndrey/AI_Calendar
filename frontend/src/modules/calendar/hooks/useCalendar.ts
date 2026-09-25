import {
  useGetEventsQuery,
  useUpdateEventMutation,
  useDeleteEventMutation,
} from '../../../api/eventsApi';
import { GoogleCalendarEvent } from '../../../api/google-calendar.api';
import { useGetUserSettingsQuery } from '../../../api/userSettingsApi';
import { eventStartDate, eventsQueryRange, sameLocalDay, SleepWindow } from '../calendarView';

export {
  PAST_APP_EVENT_COLOR,
  eventEndMs,
  getEventColor,
  isPastAppEvent,
} from './eventAppearance';

export {
  formatEventTime,
  startOfLocalDay,
  startOfWeekMonday,
  visibleGoogleEvents,
} from '../calendarView';

export const useUpdateEvent = useUpdateEventMutation;
export const useDeleteEvent = useDeleteEventMutation;

function useSleepWindow(): SleepWindow {
  const { data: settings } = useGetUserSettingsQuery();
  return {
    sleepTime: settings?.sleepTime,
    wakeTime: settings?.wakeTime,
  };
}

export const useEventsForDay = (date: Date, calendarId?: string) => {
  const sleep = useSleepWindow();
  const { timeMin, timeMax } = eventsQueryRange('day', date, sleep);
  return useGetEventsQuery({
    timeMin,
    timeMax,
    calendarId,
  });
};

export const useEventsForWeek = (dateInWeek: Date, calendarId?: string) => {
  const sleep = useSleepWindow();
  const { timeMin, timeMax } = eventsQueryRange('week', dateInWeek, sleep);
  return useGetEventsQuery({
    timeMin,
    timeMax,
    calendarId,
  });
};

export const useEventsForMonth = (year: number, month: number, calendarId?: string) => {
  const sleep = useSleepWindow();
  const { timeMin, timeMax } = eventsQueryRange(
    'month',
    new Date(year, month - 1, 1),
    sleep,
  );
  return useGetEventsQuery({
    timeMin,
    timeMax,
    calendarId,
  });
};

export const isEventToday = (event: GoogleCalendarEvent): boolean => {
  const eventDate = eventStartDate(event);
  return eventDate ? sameLocalDay(eventDate, new Date()) : false;
};
