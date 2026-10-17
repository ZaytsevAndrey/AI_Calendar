import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserIdentitiesService } from '../auth/user-identities.service';
import type {
  CalendarProvider,
  ProviderCalendar,
  ProviderEvent,
  ProviderEventPatch,
} from './calendar-provider.types';

type GraphCalendar = {
  id?: string;
  name?: string;
  isDefaultCalendar?: boolean;
  canEdit?: boolean;
};

type GraphEvent = {
  id?: string;
  subject?: string;
  bodyPreview?: string;
  location?: { displayName?: string };
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  isAllDay?: boolean;
  isCancelled?: boolean;
  showAs?: string;
  seriesMasterId?: string;
};

@Injectable()
export class MicrosoftCalendarProvider implements CalendarProvider {
  readonly id = 'microsoft' as const;
  private readonly logger = new Logger(MicrosoftCalendarProvider.name);

  constructor(
    private readonly config: ConfigService,
    private readonly identities: UserIdentitiesService,
  ) {}

  isConfigured(): boolean {
    return !!this.config.get<string>('MICROSOFT_CLIENT_ID')?.trim();
  }

  private ensureConfigured(): void {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'Microsoft Calendar is not configured (set MICROSOFT_CLIENT_ID)',
      );
    }
  }

  async isConnected(userId: string): Promise<boolean> {
    if (!this.isConfigured()) return false;
    const rows = await this.identities.listForUser(userId);
    return rows.some((r) => r.provider === 'microsoft' && !!r.accessToken);
  }

  async listCalendars(userId: string): Promise<ProviderCalendar[]> {
    this.ensureConfigured();
    const token = await this.getAccessToken(userId);
    if (!token) return [];
    const data = await this.graphJson<{ value?: GraphCalendar[] }>(
      token,
      'https://graph.microsoft.com/v1.0/me/calendars?$select=id,name,isDefaultCalendar,canEdit',
    );
    return (data.value ?? [])
      .filter((c) => !!c.id)
      .map((c) => ({
        id: String(c.id),
        summary: c.name || String(c.id),
        primary: !!c.isDefaultCalendar,
        selected: true,
        accessRole: c.canEdit === false ? 'reader' : 'writer',
        provider: 'microsoft' as const,
      }));
  }

  async listEvents(
    userId: string,
    timeMin: string,
    timeMax: string,
  ): Promise<ProviderEvent[]> {
    this.ensureConfigured();
    const token = await this.getAccessToken(userId);
    if (!token) return [];
    const calendars = await this.listCalendars(userId);
    const out: ProviderEvent[] = [];
    for (const cal of calendars) {
      try {
        const url =
          `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(cal.id)}/calendarView` +
          `?startDateTime=${encodeURIComponent(timeMin)}` +
          `&endDateTime=${encodeURIComponent(timeMax)}` +
          `&$select=id,subject,bodyPreview,location,start,end,isAllDay,isCancelled,showAs,seriesMasterId` +
          `&$top=250`;
        const data = await this.graphJson<{ value?: GraphEvent[] }>(token, url, {
          Prefer: 'outlook.timezone="UTC"',
        });
        for (const ev of data.value ?? []) {
          if (!ev.id) continue;
          out.push(this.mapEvent(ev, cal.id));
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.warn(`Skip Microsoft calendar ${cal.id}: ${msg}`);
      }
    }
    return out;
  }

  async updateEvent(
    userId: string,
    eventId: string,
    patch: ProviderEventPatch,
    calendarId?: string,
  ): Promise<ProviderEvent | null> {
    this.ensureConfigured();
    const token = await this.getAccessToken(userId);
    if (!token) return null;
    const body: Record<string, unknown> = {};
    if (patch.summary !== undefined) body.subject = patch.summary;
    if (patch.description !== undefined) {
      body.body = { contentType: 'text', content: patch.description };
    }
    if (patch.location !== undefined) {
      body.location = { displayName: patch.location };
    }
    if (patch.start) {
      body.start = this.toGraphDateTime(patch.start);
    }
    if (patch.end) {
      body.end = this.toGraphDateTime(patch.end);
    }
    const path = calendarId
      ? `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`
      : `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(eventId)}`;
    const updated = await this.graphJson<GraphEvent>(token, path, undefined, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    return this.mapEvent(updated, calendarId);
  }

  async deleteEvent(
    userId: string,
    eventId: string,
    calendarId?: string,
  ): Promise<void> {
    this.ensureConfigured();
    const token = await this.getAccessToken(userId);
    if (!token) return;
    const path = calendarId
      ? `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`
      : `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(eventId)}`;
    await this.graphJson(token, path, undefined, { method: 'DELETE' });
  }

  private mapEvent(ev: GraphEvent, calendarId?: string): ProviderEvent {
    const allDay = !!ev.isAllDay;
    const startDt = ev.start?.dateTime;
    const endDt = ev.end?.dateTime;
    return {
      id: String(ev.id),
      calendarId,
      summary: ev.subject,
      description: ev.bodyPreview,
      location: ev.location?.displayName,
      start: allDay
        ? { date: startDt?.slice(0, 10) }
        : {
            dateTime: this.toIso(startDt, ev.start?.timeZone),
            timeZone: ev.start?.timeZone,
          },
      end: allDay
        ? { date: endDt?.slice(0, 10) }
        : {
            dateTime: this.toIso(endDt, ev.end?.timeZone),
            timeZone: ev.end?.timeZone,
          },
      recurringEventId: ev.seriesMasterId,
      status: ev.isCancelled ? 'cancelled' : undefined,
      transparency: ev.showAs === 'free' ? 'transparent' : undefined,
      isAppGenerated: false,
      provider: 'microsoft',
    };
  }

  /** Graph wants wall time + timeZone (no trailing Z / offset on dateTime). */
  private toGraphDateTime(part: {
    dateTime: string;
    timeZone?: string;
  }): { dateTime: string; timeZone: string } {
    const raw = part.dateTime.trim();
    const timeZone = part.timeZone || 'UTC';
    // Strip Z / offset and fractional seconds — Graph is picky.
    const dateTime = raw
      .replace(/Z$/i, '')
      .replace(/[+-]\d{2}:\d{2}$/, '')
      .replace(/\.\d+$/, '');
    return { dateTime, timeZone };
  }

  /** Graph returns local wall times without Z; normalize to ISO when possible. */
  private toIso(dateTime?: string, _timeZone?: string): string | undefined {
    if (!dateTime) return undefined;
    if (dateTime.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(dateTime)) {
      return dateTime;
    }
    // Prefer treating as UTC when Prefer outlook.timezone="UTC" was sent.
    return `${dateTime.replace(/\.\d+$/, '')}Z`;
  }

  private async getAccessToken(userId: string): Promise<string | null> {
    const rows = await this.identities.listForUser(userId);
    const identity = rows.find((r) => r.provider === 'microsoft');
    if (!identity?.accessToken) return null;
    const skewMs = 60_000;
    if (
      identity.tokenExpiry &&
      identity.tokenExpiry.getTime() > Date.now() + skewMs
    ) {
      return identity.accessToken;
    }
    if (!identity.refreshToken) {
      return identity.accessToken;
    }
    try {
      return await this.refreshAccessToken(userId, identity);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Microsoft token refresh failed: ${msg}`);
      return identity.accessToken;
    }
  }

  private async refreshAccessToken(
    userId: string,
    identity: {
      providerUserId: string;
      refreshToken: string | null;
      email: string | null;
    },
  ): Promise<string> {
    const clientId = this.config.get<string>('MICROSOFT_CLIENT_ID')!.trim();
    const clientSecret = this.config
      .get<string>('MICROSOFT_CLIENT_SECRET')!
      .trim();
    const tenant =
      this.config.get<string>('MICROSOFT_TENANT')?.trim() || 'common';
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: identity.refreshToken!,
      scope: 'openid profile email offline_access User.Read Calendars.ReadWrite',
    });
    const res = await fetch(
      `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      },
    );
    const json = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error_description?: string;
    };
    if (!res.ok || !json.access_token) {
      throw new Error(json.error_description || 'refresh failed');
    }
    await this.identities.upsert({
      userId,
      provider: 'microsoft',
      providerUserId: identity.providerUserId,
      email: identity.email,
      accessToken: json.access_token,
      refreshToken: json.refresh_token ?? identity.refreshToken,
      tokenExpiry: json.expires_in
        ? new Date(Date.now() + json.expires_in * 1000)
        : null,
    });
    return json.access_token;
  }

  private async graphJson<T>(
    token: string,
    url: string,
    extraHeaders?: Record<string, string>,
    init?: RequestInit,
  ): Promise<T> {
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...extraHeaders,
        ...(init?.headers as Record<string, string> | undefined),
      },
    });
    if (res.status === 204) return {} as T;
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Graph ${res.status}: ${text.slice(0, 300)}`);
    }
    if (!text) return {} as T;
    return JSON.parse(text) as T;
  }
}
