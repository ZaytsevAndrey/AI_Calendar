import { Injectable } from '@nestjs/common';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service';
import type {
  CalendarProvider,
  ProviderCalendar,
  ProviderEvent,
  ProviderEventPatch,
} from './calendar-provider.types';

/** Adapts the existing Google Calendar service to the unified provider interface. */
@Injectable()
export class GoogleCalendarProvider implements CalendarProvider {
  readonly id = 'google' as const;

  constructor(private readonly google: GoogleCalendarService) {}

  async isConnected(userId: string): Promise<boolean> {
    const status = await this.google.checkConnection(userId);
    return !!status?.connected;
  }

  async listCalendars(userId: string): Promise<ProviderCalendar[]> {
    const list = await this.google.getCalendars(userId);
    return (list ?? []).map((c) => ({
      id: String(c.id ?? ''),
      summary: String(c.summary ?? c.id ?? 'Calendar'),
      primary: !!c.primary,
      selected: c.selected !== false,
      accessRole: c.accessRole ?? undefined,
      provider: 'google' as const,
    }));
  }

  async listEvents(
    userId: string,
    timeMin: string,
    timeMax: string,
  ): Promise<ProviderEvent[]> {
    const page = await this.google.getDisplayEvents(userId, timeMin, timeMax);
    const events = Array.isArray(page) ? page : (page?.events ?? []);
    return events
      .filter((e) => !!e?.id)
      .map((e) => ({
        id: String(e.id),
        calendarId: e.calendarId ? String(e.calendarId) : undefined,
        summary: e.summary != null ? String(e.summary) : undefined,
        description: e.description != null ? String(e.description) : undefined,
        location: e.location != null ? String(e.location) : undefined,
        start: (e.start ?? {}) as ProviderEvent['start'],
        end: (e.end ?? {}) as ProviderEvent['end'],
        recurringEventId:
          e.recurringEventId != null ? String(e.recurringEventId) : undefined,
        status: e.status != null ? String(e.status) : undefined,
        transparency:
          e.transparency != null ? String(e.transparency) : undefined,
        isAppGenerated: Boolean(e.isAppGenerated),
        provider: 'google' as const,
      }));
  }

  async updateEvent(
    userId: string,
    eventId: string,
    patch: ProviderEventPatch,
    calendarId?: string,
  ): Promise<ProviderEvent | null> {
    const updated = await this.google.updateEvent(userId, eventId, patch, {
      calendarId,
    });
    if (!updated?.id) return null;
    return {
      id: String(updated.id),
      calendarId,
      summary: updated.summary != null ? String(updated.summary) : undefined,
      start: (updated.start ?? {}) as ProviderEvent['start'],
      end: (updated.end ?? {}) as ProviderEvent['end'],
      provider: 'google' as const,
    };
  }

  async deleteEvent(
    userId: string,
    eventId: string,
    calendarId?: string,
  ): Promise<void> {
    await this.google.deleteEvent(userId, eventId, calendarId);
  }
}
