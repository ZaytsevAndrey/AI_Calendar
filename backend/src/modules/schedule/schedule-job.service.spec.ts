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

describe('ScheduleJobService.undoLastGenerate', () => {
  const userId = 'user-1';
  const snapshot = {
    version: 1,
    tasks: [
      {
        id: 't1',
        scheduledStartTime: '2026-04-21T09:00:00.000Z',
        scheduledEndTime: '2026-04-21T10:00:00.000Z',
        googleEventId: 'old-ev',
        googleEventCalendarId: 'app',
      },
    ],
    segments: [
      {
        id: 'past-seg',
        taskId: 't1',
        scheduledStartTime: '2026-04-20T09:00:00.000Z',
        scheduledEndTime: '2026-04-20T10:00:00.000Z',
        googleEventId: 'past-ev',
        googleEventCalendarId: 'app',
      },
      {
        id: 'open-seg',
        taskId: 't1',
        scheduledStartTime: '2026-04-21T09:00:00.000Z',
        scheduledEndTime: '2026-04-21T10:00:00.000Z',
        googleEventId: 'old-ev',
        googleEventCalendarId: 'app',
      },
    ],
  };

  afterEach(() => {
    jest.useRealTimers();
  });

  it('restores still-open snapshot segments and leaves ended ones alone', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-20T15:00:00.000Z'));

    const job = {
      id: 'job-1',
      userId,
      status: 'done',
      payloadJson: JSON.stringify({ type: 'generate' }),
      undoSnapshotJson: JSON.stringify(snapshot),
      undoConsumedAt: null,
      updatedAt: new Date(),
    };
    const task = {
      id: 't1',
      scheduledStartTime: new Date('2026-04-21T11:00:00.000Z'),
      scheduledEndTime: new Date('2026-04-21T12:00:00.000Z'),
      googleEventId: 'new-ev',
      googleEventCalendarId: 'app',
    };
    const deleteQb = {
      delete: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({}),
    };
    const jobRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([job]),
      save: jest.fn(async (row: unknown) => row),
    };
    const scheduledRepo = {
      createQueryBuilder: jest.fn(() => deleteQb),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((value: unknown) => value),
      save: jest.fn(async (row: unknown) => row),
    };
    const taskRepo = {
      find: jest.fn().mockResolvedValue([task]),
      save: jest.fn(async (row: unknown) => row),
    };
    const service = new ScheduleJobService(
      jobRepo as never,
      taskRepo as never,
      scheduledRepo as never,
      {
        captureAutoSegmentsSnapshot: jest.fn().mockResolvedValue([]),
      } as never,
      { checkConnection: jest.fn().mockResolvedValue({ connected: false }) } as never,
    );

    const result = await service.undoLastGenerate(userId);

    expect(result).toEqual({ jobId: 'job-1', status: 'undone' });
    expect(deleteQb.andWhere).toHaveBeenCalledWith(
      'scheduledEndTime > :now',
      expect.objectContaining({ now: expect.any(Date) }),
    );
    expect(scheduledRepo.save).toHaveBeenCalledTimes(1);
    const restored = scheduledRepo.save.mock.calls[0][0] as { id: string };
    expect(restored.id).toBe('open-seg');
    expect(task.googleEventId).toBe('old-ev');
    expect(job.undoConsumedAt).toBeInstanceOf(Date);
  });

  it('rejects when there is no generate snapshot', async () => {
    const service = new ScheduleJobService(
      {
        findOne: jest.fn().mockResolvedValue(null),
        find: jest.fn().mockResolvedValue([]),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(service.undoLastGenerate(userId)).rejects.toThrow(
      'Nothing to undo',
    );
  });
});
