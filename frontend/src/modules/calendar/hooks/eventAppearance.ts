import { GoogleCalendarEvent } from '../../../api/google-calendar.api';

export const PAST_APP_EVENT_COLOR = '#9e9e9e';

export function eventEndMs(event: GoogleCalendarEvent): number | null {
  if (event.end?.dateTime) {
    const t = new Date(event.end.dateTime).getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (event.end?.date) {
    const t = new Date(`${event.end.date}T00:00:00`).getTime();
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

/** Gray styling only for our app-calendar events that have fully ended. */
export function isPastAppEvent(event: GoogleCalendarEvent, now = Date.now()): boolean {
  if (!event.isAppGenerated) return false;
  const end = eventEndMs(event);
  return end != null && end <= now;
}

export const getEventColor = (event: GoogleCalendarEvent): string => {
  if (isPastAppEvent(event)) return PAST_APP_EVENT_COLOR;
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
