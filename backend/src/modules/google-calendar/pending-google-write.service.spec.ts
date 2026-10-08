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
