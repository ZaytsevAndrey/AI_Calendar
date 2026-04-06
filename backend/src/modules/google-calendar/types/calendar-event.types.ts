export interface GoogleCalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  start: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  attendees?: Array<{
    email: string;
    displayName?: string;
    responseStatus?: 'needsAction' | 'declined' | 'tentative' | 'accepted';
    self?: boolean;
  }>;
  recurringEventId?: string;
  status?: 'confirmed' | 'tentative' | 'cancelled';
  colorId?: string;
  created?: string;
  updated?: string;
  htmlLink?: string;
  organizer?: {
    email: string;
    displayName?: string;
    self?: boolean;
  };
  reminders?: {
    useDefault: boolean;
    overrides?: Array<{
      method: 'email' | 'popup';
      minutes: number;
    }>;
  };
}

export interface GoogleCalendarEventsResponse {
  events: GoogleCalendarEvent[];
  nextPageToken?: string;
  totalEvents: number;
}

export interface GoogleCalendar {
  id: string;
  summary: string;
  description?: string;
  primary?: boolean;
  accessRole: 'none' | 'freeBusyReader' | 'reader' | 'writer' | 'owner';
  backgroundColor?: string;
  foregroundColor?: string;
}

export interface GoogleCalendarListResponse {
  calendars: GoogleCalendar[];
}
