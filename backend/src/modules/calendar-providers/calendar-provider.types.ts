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

export type EventPerson = {
  email?: string;
  displayName?: string;
  responseStatus?: string;
  self?: boolean;
  optional?: boolean;
  resource?: boolean;
};

export type EventLink = {
  label: string;
  url?: string;
};

/** User-facing extras. Empty values stay unset so the preview can hide the row. */
export type EventPreviewDetails = {
  calendarName?: string;
  joinLinks?: EventLink[];
  phones?: string[];
  locations?: string[];
  attachments?: EventLink[];
  source?: EventLink;
  categories?: string[];
  comment?: string;
  /** low | high. Normal is omitted. */
  importance?: string;
  /** private | confidential | personal. Default/public/normal is omitted. */
  sensitivity?: string;
  /** busy | free | tentative | oof | workingElsewhere */
  showAs?: string;
  /** outOfOffice | focusTime | workingLocation | birthday | fromGmail */
  eventKind?: string;
  kindDetail?: string;
  descriptionHtml?: string;
  structuredLocation?: string;
  /** Apple PRIORITY 1–9. */
  priority?: number;
  recurrenceText?: string;
  /** Outlook knew about files but did not return their names. */
  hasAttachments?: boolean;
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
  attendees?: EventPerson[];
  organizer?: EventPerson;
  htmlLink?: string;
  visibility?: string;
  reminders?: {
    useDefault?: boolean;
    overrides?: { method?: string; minutes: number }[];
  };
  created?: string;
  updated?: string;
  preview?: EventPreviewDetails;
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
