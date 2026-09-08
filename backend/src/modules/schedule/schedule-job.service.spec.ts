import { ScheduleJobService } from './schedule-job.service';

describe('ScheduleJobService.wipeAppCalendarEventsInRange', () => {
  const userId = 'user-1';
  const now = new Date('2026-04-20T12:00:00.000Z');
  const rangeEnd = new Date('2026-05-20T00:00:00.000Z');

  function makeService(googleCalendarService: Record<string, jest.Mock>) {
    const execute = jest.fn().mockResolvedValue({});
    const taskRepo = {
      createQueryBuilder: jest.fn(() => ({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute,
      })),
    };
    return {
      service: new ScheduleJobService(
        {} as never,
        taskRepo as never,
        {} as never,
        {} as never,
        googleCalendarService as never,
      ),
      execute,
    };
  }

  it('caps kept recurring series and deletes only still-open leftovers', async () => {
    const googleCalendarService = {
      checkConnection: jest.fn().mockResolvedValue({ connected: true }),
      getEvents: jest.fn().mockResolvedValue({
        events: [
          {
            id: 'hist-past',
            recurringEventId: 'hist',
            status: 'confirmed',
            end: { dateTime: '2026-04-20T10:00:00.000Z' },
          },
          {
            id: 'hist-future',
            recurringEventId: 'hist',
            status: 'confirmed',
            end: { dateTime: '2026-04-20T15:00:00.000Z' },
          },
          {
            id: 'single-future',
            status: 'confirmed',
            end: { dateTime: '2026-04-20T16:00:00.000Z' },
          },
          {
            id: 'orphan-future',
            recurringEventId: 'orphan',
            status: 'confirmed',
            end: { dateTime: '2026-04-20T17:00:00.000Z' },
          },
        ],
      }),
      capRecurringSeriesUntil: jest.fn().mockResolvedValue(undefined),
      deleteEvent: jest.fn().mockResolvedValue(undefined),
    };
    const { service } = makeService(googleCalendarService);

    const deleted = await service.wipeAppCalendarEventsInRange(
      userId,
      now,
      rangeEnd,
      {
        now,
        keepEventIds: new Set(['hist']),
        untilByEventId: new Map([
          ['hist', new Date('2026-04-20T09:00:00.000Z')],
        ]),
      },
    );

    expect(googleCalendarService.capRecurringSeriesUntil).toHaveBeenCalledWith(
      userId,
      'hist',
      new Date('2026-04-20T09:00:00.000Z'),
    );
    expect(googleCalendarService.deleteEvent).toHaveBeenCalledWith(
      userId,
      'orphan',
    );
    expect(googleCalendarService.deleteEvent).toHaveBeenCalledWith(
      userId,
      'single-future',
    );
    expect(googleCalendarService.deleteEvent).not.toHaveBeenCalledWith(
      userId,
      'hist',
    );
    expect(deleted).toBe(2);
  });

  it('skips Google work when Calendar is disconnected', async () => {
    const googleCalendarService = {
      checkConnection: jest.fn().mockResolvedValue({ connected: false }),
      getEvents: jest.fn(),
      deleteEvent: jest.fn(),
      capRecurringSeriesUntil: jest.fn(),
    };
    const { service } = makeService(googleCalendarService);

    await expect(
      service.wipeAppCalendarEventsInRange(userId, now, rangeEnd),
    ).resolves.toBe(0);
    expect(googleCalendarService.getEvents).not.toHaveBeenCalled();
  });
});
