/**
 * Transactional Google outbox and reconnect recovery on a real (SQLite)
 * database: the GoogleSyncOutboxSubscriber writes queue rows in the same
 * transaction as each task / slot change; the real queue sends them.
 * Google itself is a fake keyed by event id.
 */
import { TaskEventType } from '../scheduling/event-type.enum';
import { Task } from '../tasks/entities/task.entity';
import { ScheduledTask } from '../schedule/schedule.entity';
import { User } from '../users/user.entity';
import { UserSettings } from '../user-settings/entities/user-settings.entity';
import { PendingGoogleWrite } from './entities/pending-google-write.entity';
import {
  GOOGLE_WRITE_LEASE_MS,
  GOOGLE_WRITE_MAX_ATTEMPTS,
  PendingGoogleWriteService,
} from './pending-google-write.service';
import { setGoogleOutboxKick } from './google-sync-outbox';
import { createPlacementKit, type PlacementKit } from '../../../test/helpers/placement-sqlite.kit';

describe('Google outbox (transactional) and reconnect recovery', () => {
  let kit: PlacementKit;
  let remote: Map<string, Record<string, unknown>>;
  let reconnect: ((userId: string) => void) | null;
  /** Whether the user's Google grant works right now. */
  const grant = { connected: true };
  let google: ReturnType<typeof fakeGoogle>;

  function fakeGoogle() {
    return {
      checkConnection: jest.fn(async () => ({ connected: grant.connected })),
      createEvent: jest.fn(async (_u: string, body: Record<string, unknown>) => {
        remote.set(String(body.id), { ...body });
        return { id: body.id, appCalendarId: 'app-cal' };
      }),
      updateEvent: jest.fn(async (_u: string, id: string, body: Record<string, unknown>) => {
        remote.set(id, { ...body, id });
      }),
      deleteEvent: jest.fn(async (_u: string, id: string) => {
        remote.delete(id);
      }),
      getEvent: jest.fn(async (_u: string, id: string) => remote.get(id)),
      capRecurringSeriesUntil: jest.fn(),
      onReconnected: jest.fn((listener: (userId: string) => void) => {
        reconnect = listener;
      }),
    };
  }

  const queue = () => kit.ds.getRepository(PendingGoogleWrite);
  const makeService = () =>
    new PendingGoogleWriteService(
      queue(),
      kit.taskRepo,
      kit.slotRepo,
      kit.ds.getRepository(UserSettings),
      google as never,
    );
  const linkGoogle = (userId: string) =>
    kit.ds.getRepository(User).update(userId, { googleAccessToken: 'token', googleRefreshToken: 'refresh' });
  const seated = async (name: string, from: string, to: string) => {
    const task = await kit.addTask({
      name,
      scheduledStartTime: kit.at('2026-11-05', from),
      scheduledEndTime: kit.at('2026-11-05', to),
    });
    await kit.addSlot(task.id, kit.at('2026-11-05', from), kit.at('2026-11-05', to));
    return task;
  };
  const afterGrace = () => jest.setSystemTime(Date.now() + GOOGLE_WRITE_LEASE_MS + 1_000);

  beforeEach(async () => {
    kit = await createPlacementKit({ now: '2026-11-05T07:00:00.000Z', outbox: true });
    remote = new Map();
    reconnect = null;
    grant.connected = true;
    google = fakeGoogle();
    await linkGoogle(kit.user.id);
  });

  afterEach(async () => {
    setGoogleOutboxKick(null);
    jest.restoreAllMocks();
    await kit.destroy();
  });

  describe('atomic with the change', () => {
    it('a placement that displaces a neighbour queues both tasks in its own transaction', async () => {
      const flexible = await kit.tasksService.create(kit.user.id, {
        name: 'Flexible',
        estimatedTimeInMinutes: 60,
        scheduledStartTime: kit.at('2026-11-05', '10:00').toISOString(),
        timeZone: 'UTC',
      } as never);
      await kit.jobs.settle();
      await queue().clear();

      const meeting = await kit.tasksService.create(kit.user.id, {
        name: 'Meeting',
        eventType: TaskEventType.FIXED,
        scheduledStartTime: kit.at('2026-11-05', '10:00').toISOString(),
        scheduledEndTime: kit.at('2026-11-05', '11:00').toISOString(),
        timeZone: 'UTC',
      } as never);
      await kit.jobs.settle();

      expect(await kit.slotsOf(flexible.id)).not.toContain('2026-11-05 10:00-11:00');
      const rows = await queue().find();
      expect(rows.map((row) => [row.operation, row.taskId]).sort()).toEqual(
        [
          ['upsert', flexible.id],
          ['upsert', meeting.id],
        ].sort(),
      );
    });

    it('a rolled-back transaction leaves neither the change nor its queue rows', async () => {
      const task = await seated('Report', '10:00', '11:00');
      await queue().clear();

      await expect(
        kit.ds.transaction(async (manager) => {
          await manager.getRepository(Task).update({ id: task.id }, { name: 'Renamed' });
          await manager.getRepository(Task).save({ ...task, name: 'Renamed' });
          await manager.getRepository(ScheduledTask).delete({ taskId: task.id });
          await manager.getRepository(ScheduledTask).save({
            taskId: task.id,
            scheduledStartTime: kit.at('2026-11-05', '12:00'),
            scheduledEndTime: kit.at('2026-11-05', '13:00'),
          } as ScheduledTask);
          throw new Error('placement rejected');
        }),
      ).rejects.toThrow('placement rejected');

      expect((await kit.reload(task.id)).name).toBe('Report');
      expect(await kit.slotsOf(task.id)).toEqual(['2026-11-05 10:00-11:00']);
      expect(await queue().count()).toBe(0);
    });

    it('a crash right after the commit (nothing sent) is recovered from the queue alone', async () => {
      // No kick registered: the process "dies" after the commit.
      const task = await seated('Report', '10:00', '11:00');
      expect(await queue().count()).toBe(1);
      expect(google.createEvent).not.toHaveBeenCalled();

      afterGrace();
      const restarted = makeService();
      expect(await restarted.processQueue()).toBe(1);
      expect(google.createEvent).toHaveBeenCalledTimes(1);
      expect((await kit.reload(task.id)).googleEventId).toBeTruthy();
      expect(await queue().count()).toBe(0);
    });

    it('linking the created event (bookkeeping columns) queues nothing — no loop', async () => {
      const task = await seated('Report', '10:00', '11:00');
      afterGrace();
      await makeService().processQueue();
      expect((await kit.reload(task.id)).googleEventId).toBeTruthy();
      expect(await queue().count()).toBe(0);
    });

    it('users without a Google grant get no queue rows', async () => {
      await kit.ds.getRepository(User).update(kit.user.id, { googleAccessToken: null, googleRefreshToken: null });
      await seated('Report', '10:00', '11:00');
      expect(await queue().count()).toBe(0);
    });
  });

  describe('every mutation kind', () => {
    it('deleting a task queues the delete of its event with the removal; Google is called after', async () => {
      const task = await seated('Report', '10:00', '11:00');
      afterGrace();
      const service = makeService();
      await service.processQueue();
      const eventId = (await kit.reload(task.id)).googleEventId!;
      expect(remote.has(eventId)).toBe(true);

      google.deleteEvent.mockRejectedValueOnce(new Error('Google 503'));
      await kit.tasksService.remove(task.id, kit.user.id);
      expect(await kit.taskRepo.findOneBy({ id: task.id })).toBeNull();
      const row = await queue().findOneByOrFail({ operation: 'delete', googleEventId: eventId });
      expect(row.status).toBe('pending');

      // First try fails (Google 503): the delete stays queued with its error.
      afterGrace();
      await service.processQueue();
      expect(remote.has(eventId)).toBe(true);
      expect(await queue().findOneByOrFail({ id: row.id })).toMatchObject({ status: 'pending', lastError: 'Google 503' });

      afterGrace();
      await service.processQueue();
      expect(remote.has(eventId)).toBe(false);
      expect(await queue().count()).toBe(0);
    });

    it('a delete whose event is in use again is skipped, never deleting live data', async () => {
      const task = await seated('Report', '10:00', '11:00');
      await kit.taskRepo.update({ id: task.id }, { googleEventId: 'live-1' });
      remote.set('live-1', { id: 'live-1' });
      await queue().clear();
      await makeService().enqueue(kit.user.id, 'delete', { googleEventId: 'live-1' });
      afterGrace();
      await makeService().processQueue();
      expect(remote.has('live-1')).toBe(true);
      expect(await queue().count()).toBe(0);
    });

    it('skipping a series day and detaching a day both queue the series (and the copy)', async () => {
      const series = await kit.tasksService.create(kit.user.id, {
        name: 'Gym',
        isRecurring: true,
        recurrencePattern: 'DAILY',
        scheduledStartTime: kit.at('2026-11-05', '09:00').toISOString(),
        estimatedTimeInMinutes: 60,
        timeZone: 'UTC',
      } as never);
      await kit.jobs.settle();
      await queue().clear();

      await kit.tasksService.skipOccurrence(series.id, kit.user.id, {
        occurrenceStart: kit.at('2026-11-06', '09:00').toISOString(),
      } as never);
      expect((await queue().find()).map((row) => row.taskId)).toEqual([series.id]);

      await queue().clear();
      await (kit.moveService as unknown as { moveSeriesDay: (...args: unknown[]) => Promise<unknown> }).moveSeriesDay(
        kit.user.id,
        await kit.reload(series.id),
        {
          googleEventId: 'evt',
          originalStart: kit.at('2026-11-07', '09:00').toISOString(),
          originalEnd: kit.at('2026-11-07', '10:00').toISOString(),
          start: kit.at('2026-11-07', '15:00').toISOString(),
          end: kit.at('2026-11-07', '16:00').toISOString(),
        },
        60,
        [],
        '2026-11-07',
      );
      const copy = (await kit.taskRepo.find()).find((row) => row.originalOccurrenceYmd === '2026-11-07')!;
      expect((await queue().find()).map((row) => row.taskId).sort()).toEqual([copy.id, series.id].sort());
    });
  });

  describe('replays and ordering', () => {
    it('two changes to one task are one row; the send reads the latest state and creates one event', async () => {
      const task = await seated('Report', '10:00', '11:00');
      const before = (await queue().find())[0].revision;
      await kit.taskRepo.save({ ...(await kit.reload(task.id)), name: 'Report v2' });
      const rows = await queue().find();
      expect(rows).toHaveLength(1);
      expect(rows[0].revision).toBe(before + 1);

      afterGrace();
      await makeService().processQueue();
      await makeService().processQueue();
      expect(google.createEvent).toHaveBeenCalledTimes(1);
      expect([...remote.values()][0].summary).toBe('Report v2');
    });

    it('a change made while its row is being sent is sent again afterwards (convergence)', async () => {
      const task = await seated('Report', '10:00', '11:00');
      google.createEvent.mockImplementationOnce(async (_u: string, body: Record<string, unknown>) => {
        // The user renames the task while Google is answering.
        await kit.taskRepo.save({ ...(await kit.reload(task.id)), name: 'Renamed meanwhile' });
        remote.set(String(body.id), { ...body });
        return { id: body.id, appCalendarId: 'app-cal' };
      });
      afterGrace();
      const service = makeService();
      await service.processQueue();
      const row = await queue().findOneByOrFail({ taskId: task.id });
      expect(row.status).toBe('pending');

      await service.processQueue();
      const eventId = (await kit.reload(task.id)).googleEventId!;
      expect(remote.get(eventId)?.summary).toBe('Renamed meanwhile');
      expect(google.createEvent).toHaveBeenCalledTimes(1);
    });

    it('rows are sent right after the commit when the queue is running (kick)', async () => {
      makeService().onModuleInit();
      const task = await seated('Report', '10:00', '11:00');
      for (let i = 0; i < 50 && (await queue().count()); i += 1) await new Promise((r) => setTimeout(r, 5));
      expect(await queue().count()).toBe(0);
      expect((await kit.reload(task.id)).googleEventId).toBeTruthy();
    });
  });

  describe('reconnect recovery', () => {
    it('while access is revoked rows wait without spending attempts or calling Google', async () => {
      grant.connected = false;
      await seated('Report', '10:00', '11:00');
      for (let i = 0; i < 5; i += 1) {
        afterGrace();
        jest.setSystemTime(Date.now() + 11 * 60_000);
        await makeService().processQueue();
      }
      const [row] = await queue().find();
      expect(row).toMatchObject({ status: 'pending', attempts: 0 });
      expect(google.createEvent).not.toHaveBeenCalled();
    });

    it('a reconnect sends waiting rows and revives failed ones, with the current state', async () => {
      const service = makeService();
      service.onModuleInit();
      grant.connected = false;
      const waiting = await seated('Waiting', '10:00', '11:00');
      const failed = await seated('Failed', '12:00', '13:00');
      await queue().update({ taskId: failed.id }, { status: 'failed', attempts: GOOGLE_WRITE_MAX_ATTEMPTS, lastError: '401' });
      // Changed again after the failure: the revived write must send this.
      await kit.taskRepo.update({ id: failed.id }, { name: 'Failed, renamed' });

      grant.connected = true;
      reconnect!(kit.user.id);
      for (let i = 0; i < 50 && (await queue().count()); i += 1) await new Promise((r) => setTimeout(r, 5));

      expect(await queue().count()).toBe(0);
      expect((await kit.reload(waiting.id)).googleEventId).toBeTruthy();
      const failedEvent = (await kit.reload(failed.id)).googleEventId!;
      expect(remote.get(failedEvent)?.summary).toBe('Failed, renamed');
    });

    it('a reconnect keeps deletion intent and never deletes an event something uses again', async () => {
      const service = makeService();
      grant.connected = false;
      await service.enqueue(kit.user.id, 'delete', { googleEventId: 'gone-1' });
      await service.enqueue(kit.user.id, 'delete', { googleEventId: 'reused-1' });
      await queue().update({ userId: kit.user.id }, { status: 'failed', attempts: GOOGLE_WRITE_MAX_ATTEMPTS });
      const task = await seated('Reused', '10:00', '11:00');
      await kit.taskRepo.update({ id: task.id }, { googleEventId: 'reused-1' });
      remote.set('gone-1', { id: 'gone-1' });
      remote.set('reused-1', { id: 'reused-1' });

      grant.connected = true;
      await service.reviveForUser(kit.user.id);
      await service.reviveForUser(kit.user.id); // repeated reconnect: harmless

      expect(remote.has('gone-1')).toBe(false);
      expect(remote.has('reused-1')).toBe(true);
      expect(google.deleteEvent).toHaveBeenCalledTimes(1);
    });

    it('a grant that still fails after reconnect ends failed again (bounded), visible with its error', async () => {
      const service = makeService();
      await seated('Report', '10:00', '11:00');
      google.createEvent.mockRejectedValue(new Error('401 invalid_credentials'));
      await service.reviveForUser(kit.user.id);
      for (let i = 0; i < GOOGLE_WRITE_MAX_ATTEMPTS + 2; i += 1) {
        jest.setSystemTime(Date.now() + 61 * 60_000);
        await service.processQueue();
      }
      const [row] = await queue().find();
      expect(row).toMatchObject({ status: 'failed', attempts: GOOGLE_WRITE_MAX_ATTEMPTS });
      expect(row.lastError).toContain('401');
      expect(google.createEvent).toHaveBeenCalledTimes(GOOGLE_WRITE_MAX_ATTEMPTS);
    });

    it('two instances reviving at once send each row once', async () => {
      await seated('Report', '10:00', '11:00');
      await queue().update({ userId: kit.user.id }, { status: 'failed', attempts: GOOGLE_WRITE_MAX_ATTEMPTS });
      await Promise.all([makeService().reviveForUser(kit.user.id), makeService().reviveForUser(kit.user.id)]);
      expect(google.createEvent).toHaveBeenCalledTimes(1);
      expect(await queue().count()).toBe(0);
    });
  });
});
