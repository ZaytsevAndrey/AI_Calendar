import axiosInstance from './axios';
import type {
  CalendarEventOverlayDTO,
  CalendarProviderId,
} from 'modules/calendar/schedulingKind';

export type { CalendarEventOverlayDTO, CalendarProviderId };

export async function listCalendarOverlays(): Promise<CalendarEventOverlayDTO[]> {
  const { data } = await axiosInstance.get<CalendarEventOverlayDTO[]>(
    '/calendar-overlays',
  );
  return data;
}

export async function setCalendarOverlayMode(
  provider: CalendarProviderId,
  eventId: string,
  body: { schedulingMode: 'fixed' | 'flexible'; calendarId?: string },
): Promise<CalendarEventOverlayDTO> {
  const { data } = await axiosInstance.put<CalendarEventOverlayDTO>(
    `/calendar-overlays/${provider}/${encodeURIComponent(eventId)}`,
    body,
  );
  return data;
}

export async function unscheduleExternalEvent(
  provider: CalendarProviderId,
  eventId: string,
  body: { calendarId?: string; title?: string },
): Promise<{ taskId: string }> {
  const { data } = await axiosInstance.post<{ taskId: string }>(
    `/calendar-overlays/${provider}/${encodeURIComponent(eventId)}/unschedule`,
    body,
  );
  return data;
}

export type ProviderCalendarsResponse = {
  providers: CalendarProviderId[];
  sections: Partial<Record<CalendarProviderId, Array<{
    id: string;
    summary: string;
    primary?: boolean;
    provider: CalendarProviderId;
  }>>>;
  calendars: Array<{
    id: string;
    summary: string;
    primary?: boolean;
    provider: CalendarProviderId;
  }>;
};

export async function listProviderCalendars(): Promise<ProviderCalendarsResponse> {
  const { data } = await axiosInstance.get<ProviderCalendarsResponse>(
    '/calendar-providers/calendars',
  );
  return data;
}

export async function getAuthProvidersStatus(): Promise<{
  google: boolean;
  microsoft: boolean;
  apple: boolean;
}> {
  const { data } = await axiosInstance.get<{
    google: boolean;
    microsoft: boolean;
    apple: boolean;
  }>('/auth/providers/status');
  return data;
}

export async function getMicrosoftAuthUrl(link = false): Promise<{ url: string }> {
  const { data } = await axiosInstance.get<{ url: string }>(
    link ? '/auth/microsoft/link' : '/auth/microsoft',
  );
  return data;
}

export type LinkedIdentityDTO = {
  id: string;
  provider: CalendarProviderId;
  email: string | null;
  isRegistrationIdentity: boolean;
  connected: boolean;
  createdAt: string;
};

export async function listLinkedIdentities(): Promise<LinkedIdentityDTO[]> {
  const { data } = await axiosInstance.get<LinkedIdentityDTO[]>(
    '/auth/identities',
  );
  return data;
}

export async function disconnectIdentity(
  provider: CalendarProviderId,
  opts: { confirm: boolean; deleteOverlays?: boolean },
): Promise<void> {
  await axiosInstance.post(`/auth/identities/${provider}/disconnect`, opts);
}

/** Link iCloud Calendar with Apple ID + app-specific password (CalDAV). */
export async function connectAppleCalDav(body: {
  appleId: string;
  appSpecificPassword: string;
}): Promise<{ ok: boolean; email: string }> {
  const { data } = await axiosInstance.post<{ ok: boolean; email: string }>(
    '/auth/apple/caldav',
    body,
  );
  return data;
}
