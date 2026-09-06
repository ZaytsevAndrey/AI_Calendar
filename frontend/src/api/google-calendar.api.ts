import axiosInstance from './axios';

export interface GoogleCalendarEvent {
    id: string;
    calendarId?: string;
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
    phaseId?: string;
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

export interface CreateEventParams {
    summary: string;
    description?: string;
    location?: string;
    start: {
        dateTime: string;
        timeZone?: string;
    };
    end: {
        dateTime: string;
        timeZone?: string;
    };
    attendees?: Array<{
        email: string;
        displayName?: string;
    }>;
    reminders?: {
        useDefault: boolean;
        overrides?: Array<{
            method: 'email' | 'popup';
            minutes: number;
        }>;
    };
}

export interface UpdateEventParams extends Partial<CreateEventParams> {
    summary?: string;
    description?: string;
    location?: string;
    start?: {
        dateTime: string;
        timeZone?: string;
    };
    end?: {
        dateTime: string;
        timeZone?: string;
    };
}

class GoogleCalendarAPI {
    checkConnection() {
        return axiosInstance.get('/google-calendar/check-connection');
    }
}

export const googleCalendarAPI = new GoogleCalendarAPI();
export default googleCalendarAPI;
