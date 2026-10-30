import { GoogleCalendarEvent } from '../../../api/google-calendar.api';
import type { PhasePaletteId } from 'theme/phasePalette';


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

/** Our app-calendar events that have fully ended (drawn faded). */
export function isPastAppEvent(event: GoogleCalendarEvent, now = Date.now()): boolean {
  if (!event.isAppGenerated) return false;
  const end = eventEndMs(event);
  return end != null && end <= now;
}

/** Google colorId → phase palette entry (backend writes the phase's colorId on our events). */
export const GOOGLE_COLOR_PALETTE: Record<string, PhasePaletteId> = {
  '1': 'violet',
  '2': 'teal',
  '3': 'violet',
  '4': 'pink',
  '5': 'amber',
  '6': 'orange',
  '7': 'cyan',
  '8': 'slate',
  '9': 'blue',
  '10': 'green',
  '11': 'rose',
};

/** Neutral bar for events from other calendars. */
export const EXTERNAL_EVENT_COLOR = 'rgb(var(--ide-muted))';

export function googleColorCss(colorId?: string | null): string {
  const id = (colorId && GOOGLE_COLOR_PALETTE[colorId]) || 'blue';
  return `rgb(var(--ph-${id}))`;
}

/** Chip color: the phase color for our events, neutral for external ones. Past is a class, not a color. */
export const getEventColor = (event: GoogleCalendarEvent): string => {
  if (!event.isAppGenerated) return EXTERNAL_EVENT_COLOR;
  return googleColorCss(event.colorId);
};
