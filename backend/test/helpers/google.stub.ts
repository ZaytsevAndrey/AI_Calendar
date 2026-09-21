import { randomUUID } from 'crypto';
import { UnauthorizedException } from '@nestjs/common';

type IssuedTicket = {
  access_token: string;
  refresh_token: string;
  expiresAt: number;
};

export function createGoogleCalendarStub() {
  const tickets = new Map<string, IssuedTicket>();

  const stub = {
    checkConnection: jest.fn().mockResolvedValue({ connected: false }),
    getStoredAppCalendarId: jest.fn().mockResolvedValue('app-cal'),
    getEvents: jest.fn().mockResolvedValue({
      events: [],
      nextPageToken: undefined,
      totalEvents: 0,
    }),
    getDisplayEvents: jest.fn().mockResolvedValue({ events: [] }),
    getEvent: jest.fn().mockResolvedValue(null),
    getCalendars: jest.fn().mockResolvedValue([]),
    createEvent: jest
      .fn()
      .mockImplementation(async (_userId: string, event: Record<string, unknown>) => ({
        id: 'stub-event',
        ...event,
      })),
    updateEvent: jest.fn().mockImplementation(
      async (_userId: string, eventId: string, event: Record<string, unknown>) => ({
        id: eventId,
        ...event,
      }),
    ),
    deleteEvent: jest.fn().mockResolvedValue({ success: true }),
    capRecurringSeriesUntil: jest.fn().mockResolvedValue(undefined),
    getLoginAuthUrl: jest
      .fn()
      .mockReturnValue('https://accounts.google.com/o/oauth2/v2/auth?e2e=1'),
    getAuthUrl: jest
      .fn()
      .mockReturnValue('https://accounts.google.com/o/oauth2/v2/auth?e2e=1'),
    issueTestTicket(ttlMs = 120_000) {
      const ticket = randomUUID();
      tickets.set(ticket, {
        access_token: `access-${ticket}`,
        refresh_token: `refresh-${ticket}`,
        expiresAt: Date.now() + ttlMs,
      });
      return ticket;
    },
    completeGoogleSignIn: jest.fn(async () => stub.issueTestTicket()),
    redeemLoginTicket: jest.fn((ticket: string) => {
      const row = tickets.get(ticket);
      tickets.delete(ticket);
      if (!row || row.expiresAt < Date.now()) {
        throw new UnauthorizedException('Sign-in session expired. Try again.');
      }
      return {
        access_token: row.access_token,
        refresh_token: row.refresh_token,
      };
    }),
    saveToken: jest.fn().mockResolvedValue({ success: true }),
    checkAllUsersWithTokens: jest.fn().mockResolvedValue([]),
    updateAppCalendarSummaryIfLinked: jest.fn().mockResolvedValue(undefined),
    disconnectCalendar: jest.fn().mockResolvedValue({ success: true }),
  };

  return stub;
}

export type GoogleCalendarStub = ReturnType<typeof createGoogleCalendarStub>;
