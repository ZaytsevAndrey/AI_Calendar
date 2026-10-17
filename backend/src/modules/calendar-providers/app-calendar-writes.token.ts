import type { AppCalendarProviderId } from './app-calendar-provider.util';

export const APP_CALENDAR_WRITES = Symbol('APP_CALENDAR_WRITES');

export type AppWriteResult = {
  id: string;
  appCalendarId: string;
  calendarProvider: AppCalendarProviderId;
};

export interface AppCalendarWrites {
  resolve(userId: string): Promise<AppCalendarProviderId | null>;
  isConnected(
    userId: string,
    provider: AppCalendarProviderId,
  ): Promise<boolean>;
  /** Create or rename the named app calendar on the chosen account. */
  syncHome(userId: string): Promise<void>;
  retargetIfDisconnected(
    userId: string,
    disconnected: AppCalendarProviderId,
  ): Promise<void>;
  createEvent(userId: string, event: Record<string, unknown>): Promise<AppWriteResult>;
  updateEvent(
    userId: string,
    provider: 'microsoft' | 'apple',
    eventId: string,
    event: Record<string, unknown>,
    calendarId?: string,
  ): Promise<void>;
  deleteEvent(
    userId: string,
    provider: 'microsoft' | 'apple',
    eventId: string,
    calendarId?: string,
  ): Promise<void>;
  patchTimes(
    userId: string,
    provider: 'microsoft' | 'apple',
    eventId: string,
    startIso: string,
    endIso: string,
    calendarId?: string,
  ): Promise<void>;
}
