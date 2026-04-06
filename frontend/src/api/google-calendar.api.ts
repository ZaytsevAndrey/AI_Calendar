import axiosInstance from './axios';

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

export interface GetEventsParams {
    timeMin: string;
    timeMax: string;
    maxResults?: number;
    pageToken?: string;
    calendarId?: string;
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
    // All fields are optional for updates
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
    // Get Google Calendar authorization URL
    getAuthUrl() {
        return axiosInstance.get('/google-calendar/auth-url');
    }

    // Check Google Calendar connection status
    checkConnection() {
        return axiosInstance.get('/google-calendar/check-connection');
    }

    // Disconnect Google Calendar
    disconnectCalendar() {
        return axiosInstance.delete('/google-calendar/disconnect');
    }

    // Save Google Calendar token
    saveToken(code: string) {
        return axiosInstance.post('/google-calendar/save-token', { code });
    }

    // Get list of user calendars
    getCalendars() {
        return axiosInstance.get<GoogleCalendar[]>('/google-calendar/calendars');
    }

    // Get events from Google Calendar
    getEvents(params: GetEventsParams) {
        console.log('getEvents called with params:', params);
        const queryParams = new URLSearchParams();
        
        queryParams.append('timeMin', params.timeMin);
        queryParams.append('timeMax', params.timeMax);
        
        if (params.maxResults) {
            queryParams.append('maxResults', params.maxResults.toString());
        }
        
        if (params.pageToken) {
            queryParams.append('pageToken', params.pageToken);
        }
        
        if (params.calendarId) {
            queryParams.append('calendarId', params.calendarId);
        }

        const url = `/google-calendar/events?${queryParams.toString()}`;
        console.log('getEvents making request to:', url);
        
        return axiosInstance.get<GoogleCalendarEventsResponse>(url);
    }

    // Get specific event by ID
    getEvent(eventId: string, calendarId: string = 'primary') {
        const queryParams = new URLSearchParams();
        queryParams.append('calendarId', calendarId);
        
        return axiosInstance.get<GoogleCalendarEvent>(`/google-calendar/events/${eventId}?${queryParams.toString()}`);
    }

    // Create new event
    createEvent(eventData: CreateEventParams, calendarId: string = 'primary') {
        const queryParams = new URLSearchParams();
        queryParams.append('calendarId', calendarId);
        
        return axiosInstance.post<GoogleCalendarEvent>(`/google-calendar/events?${queryParams.toString()}`, eventData);
    }

    // Update existing event
    updateEvent(eventId: string, eventData: UpdateEventParams, calendarId: string = 'primary') {
        const queryParams = new URLSearchParams();
        queryParams.append('calendarId', calendarId);
        
        return axiosInstance.put<GoogleCalendarEvent>(`/google-calendar/events/${eventId}?${queryParams.toString()}`, eventData);
    }

    // Delete event
    deleteEvent(eventId: string, calendarId: string = 'primary') {
        const queryParams = new URLSearchParams();
        queryParams.append('calendarId', calendarId);
        
        return axiosInstance.delete(`/google-calendar/events/${eventId}?${queryParams.toString()}`);
    }

    // Utility methods for date formatting
    formatDateForAPI(date: Date): string {
        return date.toISOString();
    }

    formatDateRange(startDate: Date, endDate: Date): { timeMin: string; timeMax: string } {
        return {
            timeMin: this.formatDateForAPI(startDate),
            timeMax: this.formatDateForAPI(endDate),
        };
    }

    // Get events for a specific day
    getEventsForDay(date: Date, calendarId: string = 'primary') {
        console.log('getEventsForDay called with:', { date, calendarId });
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);
        
        const endOfDay = new Date(date);
        endOfDay.setHours(23, 59, 59, 999);

        const params = {
            timeMin: this.formatDateForAPI(startOfDay),
            timeMax: this.formatDateForAPI(endOfDay),
            calendarId,
        };
        console.log('getEventsForDay params:', params);
        return this.getEvents(params);
    }

    // Get events for a specific week
    getEventsForWeek(startOfWeek: Date, calendarId: string = 'primary') {
        console.log('getEventsForWeek called with:', { startOfWeek, calendarId });
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        endOfWeek.setHours(23, 59, 59, 999);

        const params = {
            timeMin: this.formatDateForAPI(startOfWeek),
            timeMax: this.formatDateForAPI(endOfWeek),
            calendarId,
        };
        console.log('getEventsForWeek params:', params);
        return this.getEvents(params);
    }

    // Get events for a specific month
    getEventsForMonth(year: number, month: number, calendarId: string = 'primary') {
        console.log('getEventsForMonth called with:', { year, month, calendarId });
        const startOfMonth = new Date(year, month - 1, 1);
        const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999);

        const params = {
            timeMin: this.formatDateForAPI(startOfMonth),
            timeMax: this.formatDateForAPI(endOfMonth),
            calendarId,
        };
        console.log('getEventsForMonth params:', params);
        return this.getEvents(params);
    }
}

export const googleCalendarAPI = new GoogleCalendarAPI();
export default googleCalendarAPI; 