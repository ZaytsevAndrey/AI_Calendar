import { PendingGoogleWriteService } from './pending-google-write.service';

describe('PendingGoogleWriteService', () => {
  const pendingRepo = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
    save: jest.fn(async (row) => ({ id: 'p1', ...row })),
    create: jest.fn((row) => row),
    remove: jest.fn(),
  };
  const taskRepo = {
    findOne: jest.fn(),
    save: jest.fn(async (row) => row),
    remove: jest.fn(),
  };
  const scheduledRepo = {
    find: jest.fn().mockResolvedValue([]),
    save: jest.fn(async (row) => row),
    delete: jest.fn(),
  };
  const settingsRepo = {
    findOne: jest.fn().mockResolvedValue({ syncGoogleDeletions: false }),
  };
  const google = {
    checkConnection: jest.fn().mockResolvedValue({ connected: true }),
    createEvent: jest.fn().mockResolvedValue({ id: 'g-new' }),
    updateEvent: jest.fn().mockResolvedValue({}),
    deleteEvent: jest.fn().mockResolvedValue(undefined),
    getEvent: jest.fn(),
  };

  const service = new PendingGoogleWriteService(
    pendingRepo as never,
    taskRepo as never,
    scheduledRepo as never,
    settingsRepo as never,
    google as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    pendingRepo.find.mockResolvedValue([]);
    scheduledRepo.find.mockResolvedValue([]);
    settingsRepo.findOne.mockResolvedValue({ syncGoogleDeletions: false });
    google.checkConnection.mockResolvedValue({ connected: true });
  });

  it('does not create a Google event when the task has no seat', async () => {
    taskRepo.findOne.mockResolvedValue({
      id: 't1',
      userId: 'u1',
      name: 'Parked',
      isUnscheduled: false,
      scheduleState: 'problematic',
      scheduledStartTime: null,
      scheduledEndTime: null,
      googleEventId: 'g-1',
      status: 'todo',
    });
    await service.syncTask('u1', 't1');
    expect(google.createEvent).not.toHaveBeenCalled();
    expect(google.deleteEvent).toHaveBeenCalledWith('u1', 'g-1', 'primary');
  });

  it('creates a Google series with RRULE from open slots', async () => {
    const day = (offset: number) => {
      const start = new Date(Date.now() + offset * 86_400_000);
      start.setUTCHours(9, 0, 0, 0);
      const end = new Date(start.getTime() + 15 * 60_000);
      return { start, end };
    };
    const d0 = day(1);
    const d1 = day(2);
    const d2 = day(3);
    taskRepo.findOne.mockResolvedValue({
      id: 't1',
      userId: 'u1',
      name: 'Standup',
      isUnscheduled: false,
      scheduleState: 'none',
      isRecurring: true,
      recurrencePattern: 'DAILY',
      recurrenceWeekDays: null,
      skippedOccurrenceYmds: null,
      scheduledStartTime: d0.start,
      scheduledEndTime: d0.end,
      googleEventId: null,
      status: 'todo',
      scheduleTimeZone: 'UTC',
    });
    scheduledRepo.find.mockResolvedValue([
      {
        taskId: 't1',
        scheduledStartTime: d0.start,
        scheduledEndTime: d0.end,
      },
      {
        taskId: 't1',
        scheduledStartTime: d1.start,
        scheduledEndTime: d1.end,
      },
      {
        taskId: 't1',
        scheduledStartTime: d2.start,
        scheduledEndTime: d2.end,
      },
    ]);
    await service.syncTask('u1', 't1');
    expect(google.createEvent).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({
        summary: 'Standup',
        recurrence: [
          expect.stringMatching(/^RRULE:FREQ=DAILY;UNTIL=/),
        ],
      }),
      expect.objectContaining({ skipSleepWindowCheck: true }),
    );
    expect(scheduledRepo.save).toHaveBeenCalledTimes(3);
  });

  it('serializes concurrent syncs so only one Google create runs', async () => {
    let releaseCreate: (() => void) | undefined;
    const createGate = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    let creates = 0;
    google.createEvent.mockImplementation(async () => {
      creates += 1;
      await createGate;
      return { id: `g-${creates}`, appCalendarId: 'app-cal' };
    });
    taskRepo.findOne.mockImplementation(async () => ({
      id: 't1',
      userId: 'u1',
      name: 'Standup',
      isUnscheduled: false,
      scheduleState: 'none',
      isRecurring: true,
      recurrencePattern: 'DAILY',
      recurrenceWeekDays: null,
      skippedOccurrenceYmds: null,
      scheduledStartTime: new Date(Date.now() + 86_400_000),
      scheduledEndTime: new Date(Date.now() + 86_400_000 + 15 * 60_000),
      googleEventId: creates === 0 ? null : 'g-1',
      status: 'todo',
      scheduleTimeZone: 'UTC',
    }));
    const start = new Date(Date.now() + 86_400_000);
    const end = new Date(start.getTime() + 15 * 60_000);
    scheduledRepo.find.mockResolvedValue([
      { taskId: 't1', scheduledStartTime: start, scheduledEndTime: end },
    ]);

    const first = service.syncTask('u1', 't1');
    const second = service.syncTask('u1', 't1');
    await Promise.resolve();
    releaseCreate?.();
    await Promise.all([first, second]);

    expect(google.createEvent).toHaveBeenCalledTimes(1);
    expect(google.updateEvent).toHaveBeenCalledTimes(1);
  });

  it('deletes Google when an ended recurring task has no open seats left', async () => {
    taskRepo.findOne.mockResolvedValue({
      id: 't1',
      userId: 'u1',
      name: 'Standup',
      isUnscheduled: false,
      scheduleState: 'none',
      isRecurring: true,
      scheduledStartTime: new Date('2026-10-08T09:00:00.000Z'),
      scheduledEndTime: new Date('2026-10-08T09:15:00.000Z'),
      deadline: new Date('2026-10-08T00:00:00.000Z'),
      googleEventId: 'g-series',
      googleEventCalendarId: 'primary',
      status: 'todo',
      scheduleTimeZone: 'UTC',
    });
    scheduledRepo.find.mockResolvedValue([]);
    await service.syncTask('u1', 't1');
    expect(google.createEvent).not.toHaveBeenCalled();
    expect(google.updateEvent).not.toHaveBeenCalled();
    expect(google.deleteEvent).toHaveBeenCalledWith('u1', 'g-series', 'primary');
  });

  it('keeps Google when an active recurring task briefly has no open seats', async () => {
    taskRepo.findOne.mockResolvedValue({
      id: 't1',
      userId: 'u1',
      name: 'Standup',
      isUnscheduled: false,
      scheduleState: 'none',
      isRecurring: true,
      scheduledStartTime: new Date('2026-10-08T09:00:00.000Z'),
      scheduledEndTime: new Date('2026-10-08T09:15:00.000Z'),
      deadline: null,
      googleEventId: 'g-series',
      googleEventCalendarId: 'primary',
      status: 'todo',
      scheduleTimeZone: 'UTC',
    });
    scheduledRepo.find.mockResolvedValue([]);
    await service.syncTask('u1', 't1');
    expect(google.deleteEvent).not.toHaveBeenCalled();
    expect(google.createEvent).not.toHaveBeenCalled();
    expect(google.updateEvent).not.toHaveBeenCalled();
  });

  it('enqueues an upsert when create fails', async () => {
    taskRepo.findOne.mockResolvedValue({
      id: 't1',
      userId: 'u1',
      name: 'Deep work',
      isUnscheduled: false,
      scheduleState: 'none',
      scheduledStartTime: new Date('2026-10-08T09:00:00.000Z'),
      scheduledEndTime: new Date('2026-10-08T10:00:00.000Z'),
      googleEventId: null,
      status: 'todo',
      scheduleTimeZone: 'UTC',
    });
    google.createEvent.mockRejectedValueOnce(new Error('rate limit'));
    await service.syncTask('u1', 't1');
    expect(pendingRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        taskId: 't1',
        operation: 'upsert',
        lastError: 'rate limit',
      }),
    );
  });

  it('drops a pending upsert and pulls Google when the user edited after enqueue', async () => {
    const enqueuedAt = new Date('2026-10-08T08:00:00.000Z');
    pendingRepo.find.mockResolvedValue([
      {
        id: 'p1',
        userId: 'u1',
        taskId: 't1',
        operation: 'upsert',
        googleEventId: 'g-1',
        googleCalendarId: 'primary',
        enqueuedAt,
        attempts: 0,
      },
    ]);
    taskRepo.findOne.mockResolvedValue({
      id: 't1',
      userId: 'u1',
      name: 'Deep work',
      description: '',
      isUnscheduled: false,
      scheduleState: 'none',
      scheduledStartTime: new Date('2026-10-08T09:00:00.000Z'),
      scheduledEndTime: new Date('2026-10-08T10:00:00.000Z'),
      googleEventId: 'g-1',
      status: 'todo',
      scheduleTimeZone: 'UTC',
    });
    google.getEvent.mockResolvedValue({
      summary: 'Renamed in Google',
      description: '',
      start: { dateTime: '2026-10-08T11:00:00.000Z' },
      end: { dateTime: '2026-10-08T12:00:00.000Z' },
      updated: '2026-10-08T08:30:00.000Z',
    });

    await service.processQueue();

    expect(taskRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Renamed in Google',
        scheduledStartTime: new Date('2026-10-08T11:00:00.000Z'),
      }),
    );
    expect(google.updateEvent).not.toHaveBeenCalled();
    expect(pendingRepo.remove).toHaveBeenCalled();
  });
});
