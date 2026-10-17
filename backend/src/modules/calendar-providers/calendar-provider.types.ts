/** Supported external calendar / identity providers. */
export type CalendarProviderId = 'google' | 'microsoft' | 'apple';

export type SchedulingMode = 'fixed' | 'flexible';

export type ProviderCalendar = {
  id: string;
  summary: string;
  primary?: boolean;
  selected?: boolean;
  accessRole?: string;
  provider: CalendarProviderId;
};

export type ProviderEvent = {
  id: string;
  calendarId?: string;
  summary?: string;
  description?: string;
  location?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  recurringEventId?: string;
  status?: string;
  /** Google `transparent` / Outlook `free` / Apple `TRANSPARENT` — not busy. */
  transparency?: string;
  isAppGenerated?: boolean;
  provider: CalendarProviderId;
};

export type ProviderEventPatch = {
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime: string; timeZone?: string };
  end?: { dateTime: string; timeZone?: string };
};

/**
 * Unified surface for Google / Microsoft / Apple calendars.
 * Implementations live behind this interface so product logic stays provider-agnostic.
 */
export interface CalendarProvider {
  readonly id: CalendarProviderId;
  isConnected(userId: string): Promise<boolean>;
  listCalendars(userId: string): Promise<ProviderCalendar[]>;
  listEvents(
    userId: string,
    timeMin: string,
    timeMax: string,
  ): Promise<ProviderEvent[]>;
  updateEvent(
    userId: string,
    eventId: string,
    patch: ProviderEventPatch,
    calendarId?: string,
  ): Promise<ProviderEvent | null>;
  deleteEvent(
    userId: string,
    eventId: string,
    calendarId?: string,
  ): Promise<void>;
}
