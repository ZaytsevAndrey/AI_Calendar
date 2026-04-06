import {
  useGetEventsQuery,
  useGetEventQuery,
  useCreateEventMutation,
  useUpdateEventMutation,
  useDeleteEventMutation,
} from '../../../api/eventsApi';
import { GoogleCalendarEvent } from '../../../api/google-calendar.api';

// Підключення до календаря (dummy, якщо потрібно - реалізувати окремо через RTK Query)
// export const useCalendarConnection = ...

export const useCalendarEvents = (params: any) => {
  return useGetEventsQuery(params);
};

export const useCalendarEvent = (eventId: string, calendarId: string = 'primary') => {
  return useGetEventQuery({ eventId, calendarId });
};

// Для створення, оновлення, видалення подій
export const useCreateEvent = useCreateEventMutation;
export const useUpdateEvent = useUpdateEventMutation;
export const useDeleteEvent = useDeleteEventMutation;

// Для дня, тижня, місяця - просто прокидати відповідні params у useGetEventsQuery
export const useEventsForDay = (date: Date, calendarId: string = 'primary') => {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);
  return useGetEventsQuery({
    timeMin: startOfDay.toISOString(),
    timeMax: endOfDay.toISOString(),
    calendarId,
  });
};

export const useEventsForWeek = (startOfWeek: Date, calendarId: string = 'primary') => {
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);
  endOfWeek.setHours(23, 59, 59, 999);
  return useGetEventsQuery({
    timeMin: startOfWeek.toISOString(),
    timeMax: endOfWeek.toISOString(),
    calendarId,
  });
};

export const useEventsForMonth = (year: number, month: number, calendarId: string = 'primary') => {
  const startOfMonth = new Date(year, month - 1, 1);
  const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999);
  return useGetEventsQuery({
    timeMin: startOfMonth.toISOString(),
    timeMax: endOfMonth.toISOString(),
    calendarId,
  });
};

// Утиліти залишити без змін
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

export const isEventThisWeek = (event: GoogleCalendarEvent): boolean => {
  const today = new Date();
  const startOfWeek = new Date(today);
  const dayOfWeek = today.getDay();
  const daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  startOfWeek.setDate(today.getDate() - daysToSubtract);
  startOfWeek.setHours(0, 0, 0, 0);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);
  endOfWeek.setHours(23, 59, 59, 999);
  const eventDate = event.start.dateTime 
    ? new Date(event.start.dateTime)
    : new Date(event.start.date!);
  return eventDate >= startOfWeek && eventDate <= endOfWeek;
}; 