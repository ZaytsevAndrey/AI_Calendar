/**
 * Google write queue lifecycle on a real (SQLite) database: bounded retries
 * with backoff, terminal failure, lease takeover, fairness across users,
 * writes queued during a send, and a lost insert answer (no duplicate event).
 */
import { PendingGoogleWrite } from './entities/pending-google-write.entity';
import {
  GOOGLE_WRITE_BACKOFF_BASE_MS,
  GOOGLE_WRITE_BACKOFF_MAX_MS,
  GOOGLE_WRITE_MAX_ATTEMPTS,
  GOOGLE_WRITE_PER_USER,
  PendingGoogleWriteService,
} from './pending-google-write.service';
import { UserSettings } from '../user-settings/entities/user-settings.entity';
import { createPlacementKit, type PlacementKit } from '../../../test/helpers/placement-sqlite.kit';

describe('Google write queue', () => {
  let kit: PlacementKit;
  let google: {
    checkConnection: jest.Mock;
    createEvent: jest.Mock;
    updateEvent: jest.Mock;
    deleteEvent: jest.Mock;
    getEvent: jest.Mock;
    capRecurringSeriesUntil: jest.Mock;
  };
  let writes: PendingGoogleWriteService;

  beforeEach(async () => {
    kit = await createPlacementKit({ now: '2026-11-05T08:00:00.000Z' });
    google = {
      checkConnection: jest.fn().mockResolvedValue({ connected: true }),
      createEvent: jest.fn(),
      updateEvent: jest.fn().mockResolvedValue({}),
      deleteEvent: jest.fn().mockResolvedValue(undefined),
      getEvent: jest.fn(),
      capRecurringSeriesUntil: jest.fn(),
    };
    writes = new PendingGoogleWriteService(
      kit.ds.getRepository(PendingGoogleWrite),
      kit.taskRepo,
      kit.slotRepo,
      kit.ds.getRepository(UserSettings),
      google as never,
    );
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await kit.destroy();
  });

  const repo = () => kit.ds.getRepository(PendingGoogleWrite);
  const queueDelete = (userId: string, eventId: string, extra: Partial<PendingGoogleWrite> = {}) =>
    repo().save({ userId, taskId: null, googleEventId: eventId, operation: 'delete', ...extra } as never);

  it('retries with exponential backoff, then fails for good and stops', async () => {
    google.deleteEvent.mockRejectedValue(new Error('Google 503'));
    await queueDelete('u1', 'g-1');

    const delays: number[] = [];
    for (let attempt = 1; attempt <= GOOGLE_WRITE_MAX_ATTEMPTS; attempt += 1) {
      await writes.processQueue();
      const row = await repo().findOneByOrFail({ googleEventId: 'g-1' });
      expect(row.attempts).toBe(attempt);
      expect(row.leaseUntil).toBeNull();
      expect(row.lastError).toBe('Google 503');
      if (attempt < GOOGLE_WRITE_MAX_ATTEMPTS) {
        expect(row.status).toBe('pending');
        delays.push(row.nextRunAt!.getTime() - Date.now());
        // Not due before its time.
        await writes.processQueue();
        expect((await repo().findOneByOrFail({ id: row.id })).attempts).toBe(attempt);
        jest.setSystemTime(row.nextRunAt!);
      } else {
        expect(row.status).toBe('failed');
      }
    }
    expect(delays).toEqual(
      delays.map((_, i) => Math.min(GOOGLE_WRITE_BACKOFF_MAX_MS, GOOGLE_WRITE_BACKOFF_BASE_MS * 2 ** i)),
    );
    // Terminal: kept for inspection, never sent again.
    jest.setSystemTime(Date.now() + 24 * 3_600_000);
    await writes.processQueue();
    expect(google.deleteEvent).toHaveBeenCalledTimes(GOOGLE_WRITE_MAX_ATTEMPTS);
  });

  it('takes over a row whose worker died (lease expired), not one still leased', async () => {
    await queueDelete('u1', 'g-dead', { status: 'running', attempts: 1, leaseUntil: new Date(Date.now() - 1000) });
    await queueDelete('u1', 'g-busy', { status: 'running', attempts: 1, leaseUntil: new Date(Date.now() + 60_000) });

    expect(await writes.processQueue()).toBe(1);
    expect(google.deleteEvent).toHaveBeenCalledTimes(1);
    expect(google.deleteEvent).toHaveBeenCalledWith('u1', 'g-dead', undefined);
    expect(await repo().findOneBy({ googleEventId: 'g-dead' })).toBeNull();
    expect((await repo().findOneByOrFail({ googleEventId: 'g-busy' })).status).toBe('running');
  });

  it('serves every user each pass: one user’s backlog cannot starve another', async () => {
    google.deleteEvent.mockImplementation(async (userId: string) => {
      if (userId === 'busy') throw new Error('invalid_grant');
    });
    for (let i = 0; i < 40; i += 1) await queueDelete('busy', `b-${i}`);
    await queueDelete('calm', 'c-1');

    expect(await writes.processQueue(20)).toBe(1);
    expect(await repo().findOneBy({ googleEventId: 'c-1' })).toBeNull();
    const tried = (await repo().findBy({ userId: 'busy' })).filter((row) => row.attempts > 0);
    expect(tried).toHaveLength(GOOGLE_WRITE_PER_USER);
  });

  it('a failure queued while the row is being sent is not lost', async () => {
    await queueDelete('u1', 'g-1');
    google.deleteEvent.mockImplementationOnce(async () => {
      // The user acts again and its sync fails while this send is in flight.
      await writes.enqueue('u1', 'delete', { googleEventId: 'g-1', error: 'later failure' });
    });

    await writes.processQueue();

    const row = await repo().findOneByOrFail({ googleEventId: 'g-1' });
    expect(row).toMatchObject({ status: 'pending', nextRunAt: null, leaseUntil: null, revision: 1 });
    await writes.processQueue();
    expect(await repo().findOneBy({ googleEventId: 'g-1' })).toBeNull();
  });

  it('a new failure revives a terminally failed row with fresh attempts', async () => {
    await queueDelete('u1', 'g-1', { status: 'failed', attempts: GOOGLE_WRITE_MAX_ATTEMPTS });
    await writes.enqueue('u1', 'delete', { googleEventId: 'g-1', error: 'again' });
    const row = await repo().findOneByOrFail({ googleEventId: 'g-1' });
    expect(row).toMatchObject({ status: 'pending', attempts: 0, lastError: 'again' });
    expect(row.nextRunAt!.getTime()).toBe(Date.now() + GOOGLE_WRITE_BACKOFF_BASE_MS);
  });

  it('a lost insert answer does not create a second Google event', async () => {
    const task = await kit.addTask({
      name: 'Report',
      scheduledStartTime: kit.at('2026-11-05', '10:00'),
      scheduledEndTime: kit.at('2026-11-05', '11:00'),
    });
    await kit.addSlot(task.id, kit.at('2026-11-05', '10:00'), kit.at('2026-11-05', '11:00'));
    // Fake Google: events keyed by the id the client sends; an existing id is
    // what the real createEvent returns after its 409 lookup.
    const remote = new Map<string, number>();
    google.createEvent.mockImplementation(async (_userId: string, body: { id: string }) => {
      remote.set(body.id, (remote.get(body.id) ?? 0) + 1);
      if (remote.get(body.id) === 1) throw new Error('socket hang up'); // created, answer lost
      return { id: body.id, appCalendarId: 'app-cal' };
    });

    await writes.syncTask(kit.user.id, task.id);
    const queued = await repo().findOneByOrFail({ taskId: task.id });
    expect(queued.lastError).toBe('socket hang up');
    const firstId = (await kit.taskRepo.findOneByOrFail({ id: task.id })).googleInsertEventId;
    expect(firstId).toMatch(/^[0-9a-v]{32}$/);

    jest.setSystemTime(queued.nextRunAt!);
    await writes.processQueue();

    expect([...remote.keys()]).toEqual([firstId]);
    const after = await kit.taskRepo.findOneByOrFail({ id: task.id });
    expect(after).toMatchObject({ googleEventId: firstId, googleInsertEventId: null });
    expect(await repo().count()).toBe(0);
  });

  describe('sync after a placement (syncTaskSoon) survives a restart', () => {
    const seated = async () => {
      const task = await kit.addTask({
        name: 'Shifted',
        scheduledStartTime: kit.at('2026-11-05', '10:00'),
        scheduledEndTime: kit.at('2026-11-05', '11:00'),
      });
      await kit.addSlot(task.id, kit.at('2026-11-05', '10:00'), kit.at('2026-11-05', '11:00'));
      return task;
    };
    const durably = (service: PendingGoogleWriteService, taskId: string) =>
      (service as unknown as { syncTaskDurably: (u: string, t: string) => Promise<void> }).syncTaskDurably(
        kit.user.id,
        taskId,
      );

    it('leaves nothing queued when the sync succeeds', async () => {
      const task = await seated();
      google.createEvent.mockImplementation(async (_u: string, body: { id: string }) => ({ id: body.id }));
      await durably(writes, task.id);
      expect(await repo().count()).toBe(0);
      expect((await kit.taskRepo.findOneByOrFail({ id: task.id })).googleEventId).toMatch(/^[0-9a-v]{32}$/);
    });

    it('keeps the write queued when the sync fails', async () => {
      const task = await seated();
      google.createEvent.mockRejectedValue(new Error('Google 503'));
      await durably(writes, task.id);
      const row = await repo().findOneByOrFail({ taskId: task.id });
      expect(row).toMatchObject({ status: 'pending', operation: 'upsert', lastError: 'Google 503' });
    });

    it('a process that dies mid-call leaves a record the next instance sends', async () => {
      const task = await seated();
      // This instance's Google call never returns (the process is killed).
      google.createEvent.mockReturnValue(new Promise(() => undefined));
      void durably(writes, task.id);
      for (let i = 0; i < 50 && !(await repo().count()); i += 1) await new Promise((r) => setTimeout(r, 5));
      const row = await repo().findOneByOrFail({ taskId: task.id });
      // Not sent by the queue while the first attempt may still be running.
      expect(row.nextRunAt!.getTime()).toBeGreaterThan(Date.now());

      const restarted = {
        ...google,
        createEvent: jest.fn(async (_u: string, body: { id: string }) => ({ id: body.id })),
      };
      const next = new PendingGoogleWriteService(
        repo(),
        kit.taskRepo,
        kit.slotRepo,
        kit.ds.getRepository(UserSettings),
        restarted as never,
      );
      jest.setSystemTime(row.nextRunAt!);
      expect(await next.processQueue()).toBe(1);
      expect(restarted.createEvent).toHaveBeenCalledTimes(1);
      expect((await kit.taskRepo.findOneByOrFail({ id: task.id })).googleEventId).toBeTruthy();
      expect(await repo().count()).toBe(0);
    });
  });

  describe('Google-side failures never corrupt the local schedule', () => {
    const seatedTask = async (extra: Record<string, unknown> = {}) => {
      const task = await kit.addTask({
        name: 'Report',
        scheduledStartTime: kit.at('2026-11-05', '10:00'),
        scheduledEndTime: kit.at('2026-11-05', '11:00'),
        ...extra,
      });
      await kit.addSlot(task.id, kit.at('2026-11-05', '10:00'), kit.at('2026-11-05', '11:00'));
      return task;
    };

    it('a refresh token Google rejects (revoked access) changes nothing and queues nothing', async () => {
      const task = await seatedTask();
      // checkConnection turns a failed refresh (invalid_grant) into "not connected".
      google.checkConnection.mockResolvedValue({ connected: false });
      await writes.syncTask(kit.user.id, task.id);
      expect(google.createEvent).not.toHaveBeenCalled();
      expect(await repo().count()).toBe(0);
      expect(await kit.slotsOf(task.id)).toEqual(['2026-11-05 10:00-11:00']);
    });

    it('an event deleted in Google while its update was queued is unlinked, the task and slot stay', async () => {
      const task = await seatedTask({ googleEventId: 'gone-1', googleEventCalendarId: 'app-cal' });
      await writes.enqueue(kit.user.id, 'upsert', { taskId: task.id, googleEventId: 'gone-1', error: 'timeout' });
      google.getEvent.mockRejectedValue(new Error('Google 404 Not Found'));
      jest.setSystemTime(Date.now() + 2 * 60_000);

      await writes.processQueue();

      const after = await kit.taskRepo.findOneByOrFail({ id: task.id });
      expect(after.googleEventId).toBeNull();
      expect(await kit.slotsOf(task.id)).toEqual(['2026-11-05 10:00-11:00']);
      expect(await repo().count()).toBe(0);
    });

    it('two instances syncing one new task at once create one Google event', async () => {
      const task = await seatedTask();
      const remote = new Map<string, number>();
      google.createEvent.mockImplementation(async (_u: string, body: { id: string }) => {
        remote.set(body.id, (remote.get(body.id) ?? 0) + 1);
        await new Promise((r) => setTimeout(r, 10));
        // The second insert with the same id is Google's 409 → createEvent returns the event.
        return { id: body.id };
      });
      const other = new PendingGoogleWriteService(
        repo(),
        kit.taskRepo,
        kit.slotRepo,
        kit.ds.getRepository(UserSettings),
        google as never,
      );

      await Promise.all([writes.syncTask(kit.user.id, task.id), other.syncTask(kit.user.id, task.id)]);

      expect(remote.size).toBe(1);
      const [eventId] = [...remote.keys()];
      expect((await kit.taskRepo.findOneByOrFail({ id: task.id })).googleEventId).toBe(eventId);
    });

    it('a delete of several events that partly fails queues only the failed one', async () => {
      const task = await kit.addTask({
        name: 'Parked',
        scheduleState: 'problematic' as never,
        googleEventId: 'g-main',
        googleEventCalendarId: 'app-cal',
      });
      const slot = await kit.addSlot(task.id, kit.at('2026-11-05', '10:00'), kit.at('2026-11-05', '11:00'));
      await kit.slotRepo.update({ id: slot.id }, { googleEventId: 'g-slot' });
      google.deleteEvent.mockImplementation(async (_u: string, eventId: string) => {
        if (eventId === 'g-slot') throw new Error('Google 500');
      });

      await writes.syncTask(kit.user.id, task.id);

      expect(google.deleteEvent).toHaveBeenCalledTimes(2);
      const queued = await repo().find();
      expect(queued.map((row) => [row.operation, row.googleEventId])).toEqual([['delete', 'g-slot']]);
      expect((await kit.taskRepo.findOneByOrFail({ id: task.id })).googleEventId).toBeNull();
    });
  });

  it('a spent insert id (event deleted in Google before linking) is replaced', async () => {
    const task = await kit.addTask({
      name: 'Report',
      googleInsertEventId: 'spent0000000000000000000000000000',
      scheduledStartTime: kit.at('2026-11-05', '10:00'),
      scheduledEndTime: kit.at('2026-11-05', '11:00'),
    });
    await kit.addSlot(task.id, kit.at('2026-11-05', '10:00'), kit.at('2026-11-05', '11:00'));
    google.createEvent.mockImplementation(async (_userId: string, body: { id: string }) =>
      body.id.startsWith('spent') ? { id: body.id, status: 'cancelled' } : { id: body.id },
    );

    await writes.syncTask(kit.user.id, task.id);
    expect((await kit.taskRepo.findOneByOrFail({ id: task.id })).googleInsertEventId).toBeNull();
    const queued = await repo().findOneByOrFail({ taskId: task.id });
    jest.setSystemTime(queued.nextRunAt!);
    await writes.processQueue();

    const after = await kit.taskRepo.findOneByOrFail({ id: task.id });
    expect(after.googleEventId).toMatch(/^[0-9a-v]{32}$/);
    expect(after.googleEventId).not.toContain('spent');
  });
});
