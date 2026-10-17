import { UnauthorizedException } from '@nestjs/common';
import { AppleCalendarProvider } from './apple-calendar.provider';

const createDAVClient = jest.fn();

jest.mock('tsdav', () => ({
  createDAVClient: (...args: unknown[]) => createDAVClient(...args),
}));

describe('AppleCalendarProvider', () => {
  const userId = 'user-1';
  const identities = {
    listForUser: jest.fn(),
    upsert: jest.fn(),
    disconnect: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    identities.listForUser.mockResolvedValue([]);
    identities.upsert.mockResolvedValue({});
  });

  function provider() {
    return new AppleCalendarProvider(identities as never);
  }

  it('is always configured and reports connected from identity token', async () => {
    const p = provider();
    expect(p.isConfigured()).toBe(true);
    identities.listForUser.mockResolvedValue([
      { provider: 'apple', accessToken: 'xxxx-xxxx-xxxx-xxxx' },
    ]);
    await expect(p.isConnected(userId)).resolves.toBe(true);
  });

  it('connectCalDav stores identity after CalDAV succeeds', async () => {
    createDAVClient.mockResolvedValue({
      fetchCalendars: jest.fn().mockResolvedValue([{ url: 'https://caldav.icloud.com/x/' }]),
    });
    const p = provider();
    await expect(
      p.connectCalDav(userId, 'me@icloud.com', 'abcd-efgh-ijkl-mnop'),
    ).resolves.toEqual({ email: 'me@icloud.com', calendarCount: 1 });
    expect(identities.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        provider: 'apple',
        providerUserId: 'me@icloud.com',
        email: 'me@icloud.com',
        refreshToken: null,
        accessToken: 'abcdefghijklmnop',
      }),
    );
  });

  it('connectCalDav rejects when iCloud returns no calendars', async () => {
    createDAVClient.mockResolvedValue({
      fetchCalendars: jest.fn().mockResolvedValue([]),
    });
    const p = provider();
    await expect(
      p.connectCalDav(userId, 'me@icloud.com', 'abcd-efgh-ijkl-mnop'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('connectCalDav rejects bad CalDAV credentials', async () => {
    createDAVClient.mockRejectedValue(new Error('401'));
    const p = provider();
    await expect(
      p.connectCalDav(userId, 'me@icloud.com', 'bad-password'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(identities.upsert).not.toHaveBeenCalled();
  });

  it('lists events mapped from ICS objects', async () => {
    identities.listForUser.mockResolvedValue([
      {
        provider: 'apple',
        email: 'me@icloud.com',
        accessToken: 'abcd-efgh-ijkl-mnop',
      },
    ]);
    const ics = `BEGIN:VEVENT
UID:u1
SUMMARY:Hello
DTSTART:20260401T100000Z
DTEND:20260401T110000Z
END:VEVENT`;
    createDAVClient.mockResolvedValue({
      fetchCalendars: jest
        .fn()
        .mockResolvedValue([{ url: 'https://caldav.icloud.com/cal1/', displayName: 'Home' }]),
      fetchCalendarObjects: jest.fn().mockImplementation(async (opts) => {
        // Simulate iCloud href without .ics — must not be filtered out.
        const url = 'https://caldav.icloud.com/cal1/ABC-123';
        expect(opts.urlFilter(url)).toBe(true);
        expect(opts.useMultiGet).toBe(true);
        expect(opts.expand).toBe(false);
        return [{ url, data: ics, etag: '"1"' }];
      }),
    });
    const p = provider();
    const events = await p.listEvents(
      userId,
      '2026-04-01T00:00:00.000Z',
      '2026-04-02T00:00:00.000Z',
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: Buffer.from(
        'https://caldav.icloud.com/cal1/ABC-123',
        'utf8',
      ).toString('base64url'),
      calendarId: 'https://caldav.icloud.com/cal1/',
      summary: 'Hello',
      provider: 'apple',
    });
  });

  it('does not full-fetch when time-range returns empty', async () => {
    identities.listForUser.mockResolvedValue([
      {
        provider: 'apple',
        email: 'me@icloud.com',
        accessToken: 'abcdefghijklmnop',
      },
    ]);
    const fetchCalendarObjects = jest.fn().mockResolvedValue([]);
    createDAVClient.mockResolvedValue({
      fetchCalendars: jest
        .fn()
        .mockResolvedValue([{ url: 'https://caldav.icloud.com/cal1/', displayName: 'Home' }]),
      fetchCalendarObjects,
    });
    const p = provider();
    const events = await p.listEvents(
      userId,
      '2026-04-01T00:00:00.000Z',
      '2026-04-02T00:00:00.000Z',
    );
    expect(events).toHaveLength(0);
    expect(fetchCalendarObjects).toHaveBeenCalledTimes(1);
    expect(fetchCalendarObjects.mock.calls[0][0].timeRange).toEqual({
      start: '2026-04-01T00:00:00Z',
      end: '2026-04-02T00:00:00Z',
    });
  });

  it('deletes by opaque id and clears list cache', async () => {
    identities.listForUser.mockResolvedValue([
      {
        provider: 'apple',
        email: 'me@icloud.com',
        accessToken: 'abcdefghijklmnop',
      },
    ]);
    const objectUrl =
      'https://caldav.icloud.com/18070852993/calendars/A7FDB1B2-C3D4-E5F6-A7B8-C9D0E1F2A3B4/event-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.ics';
    const calendarUrl =
      'https://caldav.icloud.com/18070852993/calendars/A7FDB1B2-C3D4-E5F6-A7B8-C9D0E1F2A3B4/';
    const eventId = Buffer.from(objectUrl, 'utf8').toString('base64url');
    expect(eventId.length).toBeGreaterThan(100);

    const deleteCalendarObject = jest.fn().mockResolvedValue(undefined);
    createDAVClient.mockResolvedValue({
      fetchCalendars: jest
        .fn()
        .mockResolvedValue([{ url: calendarUrl, displayName: 'Home' }]),
      fetchCalendarObjects: jest.fn().mockResolvedValue([
        { url: objectUrl, data: 'BEGIN:VEVENT\nEND:VEVENT', etag: '"9"' },
      ]),
      deleteCalendarObject,
    });
    const p = provider();
    await p.deleteEvent(userId, eventId, calendarUrl);
    expect(deleteCalendarObject).toHaveBeenCalledWith({
      calendarObject: { url: objectUrl, etag: '"9"' },
    });
  });

  it('retries without multiget on incomplete response', async () => {
    identities.listForUser.mockResolvedValue([
      {
        provider: 'apple',
        email: 'me@icloud.com',
        accessToken: 'abcdefghijklmnop',
      },
    ]);
    const ics = `BEGIN:VEVENT
UID:u3
SUMMARY:Retried
DTSTART:20260401T100000Z
DTEND:20260401T110000Z
END:VEVENT`;
    createDAVClient.mockResolvedValue({
      fetchCalendars: jest
        .fn()
        .mockResolvedValue([{ url: 'https://caldav.icloud.com/cal1/', displayName: 'Work' }]),
      fetchCalendarObjects: jest.fn().mockImplementation(async (opts) => {
        if (opts.useMultiGet) {
          throw new Error('Calendar object fetch failed: incomplete response');
        }
        return [
          {
            url: 'https://caldav.icloud.com/cal1/ok',
            data: ics,
            etag: '"3"',
          },
        ];
      }),
    });
    const p = provider();
    const events = await p.listEvents(
      userId,
      '2026-04-01T00:00:00.000Z',
      '2026-04-02T00:00:00.000Z',
    );
    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe('Retried');
  });
});
