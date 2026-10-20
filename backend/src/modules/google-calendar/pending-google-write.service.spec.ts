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
    capRecurringSeriesUntil: jest.fn().mockResolvedValue(undefined),
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
    google.getEvent.mockReset();
    google.createEvent.mockResolvedValue({ id: 'g-new' });
    google.updateEvent.mockResolvedValue({});
    google.capRecurringSeriesUntil.mockResolvedValue(undefined);
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

  it('keeps a recurring series start on the first seated day, including the past', async () => {
    const day = (offset: number) => {
      const start = new Date(Date.now() + offset * 86_400_000);
      start.setUTCHours(9, 0, 0, 0);
      const end = new Date(start.getTime() + 30 * 60_000);
      return { start, end };
    };
    const past = day(-2);
    const next = day(1);
    const later = day(2);
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
      scheduledStartTime: next.start,
      scheduledEndTime: next.end,
      googleEventId: 'g-series',
      googleEventCalendarId: 'primary',
      status: 'todo',
      scheduleTimeZone: 'UTC',
    });
    scheduledRepo.find.mockResolvedValue([
      {
        taskId: 't1',
        scheduledStartTime: past.start,
        scheduledEndTime: past.end,
      },
      {
        taskId: 't1',
        scheduledStartTime: next.start,
        scheduledEndTime: next.end,
      },
      {
        taskId: 't1',
        scheduledStartTime: later.start,
        scheduledEndTime: later.end,
      },
    ]);
    google.getEvent.mockResolvedValue({
      start: { dateTime: past.start.toISOString() },
      end: { dateTime: past.end.toISOString() },
    });

    await service.syncTask('u1', 't1');

    expect(google.createEvent).not.toHaveBeenCalled();
    expect(google.capRecurringSeriesUntil).not.toHaveBeenCalled();
    expect(google.updateEvent).toHaveBeenCalledWith(
      'u1',
      'g-series',
      expect.objectContaining({
        start: expect.objectContaining({
          dateTime: past.start.toISOString(),
        }),
        recurrence: [expect.stringMatching(/^RRULE:FREQ=DAILY;UNTIL=/)],
      }),
      expect.any(Object),
    );
  });

  it('extends the existing series when the next day uses another clock', async () => {
    const day = (offset: number, hourUtc: number) => {
      const start = new Date(Date.now() + offset * 86_400_000);
      start.setUTCHours(hourUtc, 0, 0, 0);
      const end = new Date(start.getTime() + 30 * 60_000);
      return { start, end };
    };
    const past = day(-1, 9);
    const next = day(1, 11);
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
      scheduledStartTime: next.start,
      scheduledEndTime: next.end,
      googleEventId: 'g-old',
      googleEventCalendarId: 'primary',
      status: 'todo',
      scheduleTimeZone: 'UTC',
    });
    scheduledRepo.find.mockResolvedValue([
      {
        taskId: 't1',
        scheduledStartTime: past.start,
        scheduledEndTime: past.end,
        googleEventId: 'g-old',
      },
      {
        taskId: 't1',
        scheduledStartTime: next.start,
        scheduledEndTime: next.end,
        googleEventId: 'g-old',
      },
    ]);
    google.getEvent.mockResolvedValue({
      start: { dateTime: past.start.toISOString() },
      end: { dateTime: past.end.toISOString() },
    });
    google.createEvent.mockResolvedValue({ id: 'g-new' });

    await service.syncTask('u1', 't1');

    expect(google.capRecurringSeriesUntil).not.toHaveBeenCalled();
    expect(google.createEvent).not.toHaveBeenCalled();
    expect(google.updateEvent).toHaveBeenCalledWith(
      'u1',
      'g-old',
      expect.objectContaining({
        start: expect.objectContaining({
          dateTime: past.start.toISOString(),
        }),
      }),
      expect.any(Object),
    );
  });

  it('caps a finished segment instead of deleting its past instances', async () => {
    const start = new Date(Date.now() - 2 * 86_400_000);
    start.setUTCHours(9, 0, 0, 0);
    const end = new Date(start.getTime() + 30 * 60_000);
    taskRepo.findOne.mockResolvedValue({
      id: 't1',
      userId: 'u1',
      name: 'Standup',
      isUnscheduled: false,
      scheduleState: 'none',
      isRecurring: true,
      recurrencePattern: 'DAILY',
      scheduledStartTime: start,
      scheduledEndTime: end,
      deadline: new Date(Date.now() - 86_400_000),
      googleEventId: 'g-old',
      googleEventCalendarId: 'primary',
      status: 'todo',
      scheduleTimeZone: 'UTC',
    });
    scheduledRepo.find.mockResolvedValue([
      {
        taskId: 't1',
        scheduledStartTime: start,
        scheduledEndTime: end,
        googleEventId: 'g-old',
      },
    ]);

    await service.syncTask('u1', 't1');

    expect(google.deleteEvent).not.toHaveBeenCalled();
    expect(google.createEvent).not.toHaveBeenCalled();
    expect(google.capRecurringSeriesUntil).toHaveBeenCalledWith(
      'u1',
      'g-old',
      start,
      'primary',
    );
  });

  it('anchors Google RRULE on majority clock, not a skewed open[0]', async () => {
    // One shifted day must not rewrite the series DTSTART off the majority HM.
    // Keep every seat in the future so openSlots does not drop the majority days.
    const day = (offset: number, hourUtc: number, minuteUtc = 0) => {
      const start = new Date(Date.now() + offset * 86_400_000);
      start.setUTCHours(hourUtc, minuteUtc, 0, 0);
      const end = new Date(start.getTime() + 30 * 60_000);
      return { start, end };
    };
    const skewed = day(1, 6, 30);
    const a = day(2, 7, 0);
    const b = day(4, 7, 0);
    taskRepo.findOne.mockResolvedValue({
      id: 't1',
      userId: 'u1',
      name: 'Three',
      isUnscheduled: false,
      scheduleState: 'none',
      isRecurring: true,
      recurrencePattern: 'DAILY',
      recurrenceWeekDays: null,
      skippedOccurrenceYmds: null,
      scheduledStartTime: a.start,
      scheduledEndTime: a.end,
      googleEventId: null,
      status: 'todo',
      scheduleTimeZone: 'Asia/Nicosia',
    });
    scheduledRepo.find.mockResolvedValue([
      {
        taskId: 't1',
        scheduledStartTime: skewed.start,
        scheduledEndTime: skewed.end,
      },
      {
        taskId: 't1',
        scheduledStartTime: a.start,
        scheduledEndTime: a.end,
      },
      {
        taskId: 't1',
        scheduledStartTime: b.start,
        scheduledEndTime: b.end,
      },
    ]);
    await service.syncTask('u1', 't1');
    expect(google.createEvent).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({
        start: expect.objectContaining({
          dateTime: a.start.toISOString(),
        }),
        end: expect.objectContaining({
          dateTime: a.end.toISOString(),
        }),
      }),
      expect.any(Object),
    );
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

  it('deletes a just-created Google event when the local task was removed', async () => {
    let finds = 0;
    taskRepo.findOne.mockImplementation(async () => {
      finds += 1;
      // First load for sync; second is the post-create existence check.
      if (finds === 1) {
        return {
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
        };
      }
      return null;
    });
    google.createEvent.mockResolvedValueOnce({ id: 'g-orphan' });
    await service.syncTask('u1', 't1');
    expect(google.deleteEvent).toHaveBeenCalledWith('u1', 'g-orphan', 'primary');
    expect(taskRepo.save).not.toHaveBeenCalled();
  });

  it('drops a pending upsert for a deleted task and removes its Google event', async () => {
    pendingRepo.find.mockResolvedValue([
      {
        id: 'p1',
        userId: 'u1',
        taskId: 't1',
        operation: 'upsert',
        googleEventId: 'g-stale',
        googleCalendarId: 'primary',
        enqueuedAt: new Date('2026-10-08T08:00:00.000Z'),
        attempts: 0,
      },
    ]);
    taskRepo.findOne.mockResolvedValue(null);
    await service.processQueue();
    expect(google.createEvent).not.toHaveBeenCalled();
    expect(google.deleteEvent).toHaveBeenCalledWith('u1', 'g-stale', 'primary');
    expect(pendingRepo.remove).toHaveBeenCalled();
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
