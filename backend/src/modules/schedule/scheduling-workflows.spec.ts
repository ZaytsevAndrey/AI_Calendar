/**
 * Stabilization C/D/E/I: whole user workflows on the real services
 * (TasksService, ScheduleJobService queue, PlacementStepService,
 * DisplayedEventMoveService) over in-memory SQLite.
 */
import { TaskEventType } from '../scheduling/event-type.enum';
import { ScheduleState, Task } from '../tasks/entities/task.entity';
import { PendingGoogleWrite } from '../google-calendar/entities/pending-google-write.entity';
import { PendingGoogleWriteService } from '../google-calendar/pending-google-write.service';
import { UserSettings } from '../user-settings/entities/user-settings.entity';
import { ScheduleJob } from './entities/schedule-job.entity';
import { seriesHorizonYmds } from './placement-step.util';
import { createPlacementKit, type PlacementKit } from '../../../test/helpers/placement-sqlite.kit';

type MoveInternals = {
  moveSeriesDay: (...args: unknown[]) => Promise<string | null>;
  moveSeriesTail: (...args: unknown[]) => Promise<void>;
};

describe('scheduling workflows', () => {
  let kit: PlacementKit;

  afterEach(async () => {
    jest.restoreAllMocks();
    await kit?.destroy();
    kit = undefined as unknown as PlacementKit;
  });

  const create = async (body: Record<string, unknown>) => {
    const created = await kit.tasksService.create(kit.user.id, {
      timeZone: 'UTC',
      priority: 'medium',
      allowSplit: false,
      ...body,
    } as never);
    await kit.jobs.settle();
    return created as Task & { jobId: string };
  };
  const perDay = async (taskId: string) => {
    const days = (await kit.slotsOf(taskId)).map((row) => row.slice(0, 10));
    return { days, unique: new Set(days).size === days.length };
  };

  it('I1: flexible series → fixed conflict → detach a day → change the future → restart → identities hold', async () => {
    kit = await createPlacementKit({ now: '2026-11-05T06:00:00.000Z', horizonDays: 5 });

    // 1–3. Create a flexible daily series at 10:00; every horizon day is placed.
    const gym = await create({
      name: 'Gym',
      eventType: TaskEventType.ADMIN,
      isRecurring: true,
      recurrencePattern: 'DAILY',
      scheduledStartTime: kit.at('2026-11-05', '10:00').toISOString(),
      estimatedTimeInMinutes: 60,
    });
    expect(await kit.slotsOf(gym.id)).toEqual([
      '2026-11-05 10:00-11:00',
      '2026-11-06 10:00-11:00',
      '2026-11-07 10:00-11:00',
      '2026-11-08 10:00-11:00',
      '2026-11-09 10:00-11:00',
    ]);

    // 4–5. A fixed meeting on 6 Nov at 10:00 displaces that day into a copy.
    await create({
      name: 'Meeting',
      eventType: TaskEventType.FIXED,
      scheduledStartTime: kit.at('2026-11-06', '10:00').toISOString(),
      scheduledEndTime: kit.at('2026-11-06', '11:00').toISOString(),
      estimatedTimeInMinutes: 60,
    });
    const afterConflict = await kit.reload(gym.id);
    expect(afterConflict.skippedOccurrenceYmds).toEqual(['2026-11-06']);
    const copies = (await kit.taskRepo.find()).filter((row) => row.originalOccurrenceYmd === '2026-11-06');
    expect(copies).toHaveLength(1);
    expect(await kit.slotsOf(copies[0].id)).toHaveLength(1);
    expect((await kit.slotsOf(copies[0].id))[0]).not.toContain('10:00-11:00');

    // 6. Detach 7 Nov by dragging it to 15:00 (this day only).
    const move = kit.moveService as unknown as MoveInternals;
    await move.moveSeriesDay(
      kit.user.id,
      afterConflict,
      {
        googleEventId: 'evt-7',
        originalStart: kit.at('2026-11-07', '10:00').toISOString(),
        originalEnd: kit.at('2026-11-07', '11:00').toISOString(),
        start: kit.at('2026-11-07', '15:00').toISOString(),
        end: kit.at('2026-11-07', '16:00').toISOString(),
      },
      60,
      [],
      '2026-11-07',
    );

    // 7. Change the future from 8 Nov: 18:00 from then on.
    await move.moveSeriesTail(
      kit.user.id,
      await kit.reload(gym.id),
      {
        googleEventId: 'evt-8',
        originalStart: kit.at('2026-11-08', '10:00').toISOString(),
        originalEnd: kit.at('2026-11-08', '11:00').toISOString(),
        start: kit.at('2026-11-08', '18:00').toISOString(),
        end: kit.at('2026-11-08', '19:00').toISOString(),
      },
      kit.at('2026-11-08', '18:00'),
      kit.at('2026-11-08', '19:00'),
      60,
      [],
    );

    // 9. "Restart": a fresh sweep over the queue finds nothing left and nothing stuck.
    await kit.jobs.settle();
    expect(await kit.jobs.processDue()).toBe(0);
    const stuck = await kit.ds
      .getRepository(ScheduleJob)
      .find({ where: [{ status: 'pending' }, { status: 'running' }] });
    expect(stuck).toEqual([]);

    // 10. Identities and invariants: every civil day 5–9 Nov has exactly one Gym occurrence.
    const family = (await kit.taskRepo.find()).filter(
      (row) => row.name === 'Gym' && (row.seriesGroupId === gym.id || row.id === gym.id),
    );
    const days: string[] = [];
    for (const member of family) days.push(...(await perDay(member.id)).days);
    expect(days.sort()).toEqual(['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09']);
    const old = await kit.reload(gym.id);
    expect(await kit.slotsOf(gym.id)).toEqual(['2026-11-05 10:00-11:00']);
    expect(old.skippedOccurrenceYmds?.sort()).toEqual(['2026-11-06', '2026-11-07']);
    const tail = family.find((row) => row.isRecurring && row.id !== gym.id)!;
    expect(await kit.slotsOf(tail.id)).toEqual(['2026-11-08 18:00-19:00', '2026-11-09 18:00-19:00']);
    // The meeting never moved.
    const meeting = (await kit.taskRepo.find()).find((row) => row.name === 'Meeting')!;
    expect(await kit.slotsOf(meeting.id)).toEqual(['2026-11-06 10:00-11:00']);
  });

  it('E2: Google failures retry the job and never undo the local placement', async () => {
    kit = await createPlacementKit({ now: '2026-11-05T08:00:00.000Z' });
    kit.pendingGoogleWrites.syncTask.mockRejectedValueOnce(new Error('Google 503'));

    const task = await create({ name: 'Report', estimatedTimeInMinutes: 60 });

    // Placement is committed even though the sync failed; the job waits to retry.
    const placed = await kit.slotsOf(task.id);
    expect(placed).toHaveLength(1);
    const job = await kit.ds.getRepository(ScheduleJob).findOneByOrFail({ id: task.jobId });
    expect(job).toMatchObject({ status: 'pending', attempts: 1, errorMessage: 'Google 503' });

    jest.setSystemTime(job.nextRunAt!);
    await kit.jobs.processDue();
    // The retry re-runs placement idempotently: same single slot.
    expect(await kit.slotsOf(task.id)).toEqual(placed);
    expect((await kit.ds.getRepository(ScheduleJob).findOneByOrFail({ id: task.jobId })).status).toBe('done');
  });

  it('E3: Google rows that keep failing do not starve newer writes', async () => {
    kit = await createPlacementKit({ now: '2026-11-05T08:00:00.000Z' });
    const repo = kit.ds.getRepository(PendingGoogleWrite);
    // A user who revoked access: 20 deletes that fail on every pass.
    for (let i = 0; i < 20; i += 1) {
      await repo.save({
        userId: 'revoked',
        taskId: null,
        googleEventId: `dead-${i}`,
        operation: 'delete',
        attempts: 3,
      } as never);
    }
    jest.advanceTimersByTime(1000);
    await repo.save({
      userId: kit.user.id,
      taskId: null,
      googleEventId: 'live-1',
      operation: 'delete',
      attempts: 0,
    } as never);
    const google = {
      deleteEvent: jest.fn(async (userId: string) => {
        if (userId === 'revoked') throw new Error('invalid_grant');
      }),
    };
    const writes = new PendingGoogleWriteService(
      repo,
      kit.taskRepo,
      kit.slotRepo,
      kit.ds.getRepository(UserSettings),
      google as never,
    );

    expect(await writes.processQueue(20)).toBe(1);
    expect(await repo.findOneBy({ googleEventId: 'live-1' })).toBeNull();
    // The failing rows are kept (not silently dropped) with their error.
    const dead = await repo.findBy({ userId: 'revoked' });
    expect(dead).toHaveLength(20);
    expect(dead.filter((row) => row.lastError === 'invalid_grant').length).toBe(19);
  });

  it('C1: a historical copy without originalOccurrenceYmd never re-merges and series edits leave it alone', async () => {
    kit = await createPlacementKit({ now: '2026-11-05T08:00:00.000Z', horizonDays: 3 });
    const series = await kit.addTask({
      name: 'Daily',
      isRecurring: true,
      recurrencePattern: 'DAILY',
      seriesGroupId: undefined,
      skippedOccurrenceYmds: ['2026-11-06'],
      scheduledStartTime: kit.at('2026-11-05', '10:00'),
      scheduledEndTime: kit.at('2026-11-05', '11:00'),
    });
    await kit.taskRepo.update({ id: series.id }, { seriesGroupId: series.id });
    await kit.addSlot(series.id, kit.at('2026-11-05', '10:00'), kit.at('2026-11-05', '11:00'));
    await kit.addSlot(series.id, kit.at('2026-11-07', '10:00'), kit.at('2026-11-07', '11:00'));
    // A copy made before the column existed and already seated: its day is unknown.
    const legacy = await kit.addTask({
      name: 'Daily',
      seriesGroupId: series.id,
      originalOccurrenceYmd: null,
      scheduledStartTime: kit.at('2026-11-06', '14:00'),
      scheduledEndTime: kit.at('2026-11-06', '15:00'),
    });
    await kit.addSlot(legacy.id, kit.at('2026-11-06', '14:00'), kit.at('2026-11-06', '15:00'));

    // Dragged onto the series clock on its likely day: still not merged (identity unproven).
    await kit.service.place(kit.user.id, legacy.id, {
      preferredStart: kit.at('2026-11-06', '10:00'),
      drag: true,
    });
    expect(await kit.taskRepo.findOneBy({ id: legacy.id })).not.toBeNull();
    expect(await kit.slotsOf(legacy.id)).toEqual(['2026-11-06 10:00-11:00']);

    // A series clock edit rewrites the series' own days only; the copy stays.
    await kit.tasksService.update(series.id, kit.user.id, {
      scheduledStartTime: kit.at('2026-11-05', '11:00').toISOString(),
      scheduledEndTime: kit.at('2026-11-05', '12:00').toISOString(),
    } as never);
    await kit.jobs.settle();
    expect(await kit.slotsOf(legacy.id)).toEqual(['2026-11-06 10:00-11:00']);
    const days = (await kit.slotsOf(series.id)).map((row) => row.slice(0, 10));
    expect(days).not.toContain('2026-11-06');
    expect(new Set(days).size).toBe(days.length);
  });

  it('C3: recurrence boundaries — leap day, year end, DST weeks keep the civil day', () => {
    // Monthly from 31 Jan in a leap year clamps to 29 Feb.
    expect(
      seriesHorizonYmds({ anchorYmd: '2028-01-31', horizonEndYmd: '2028-04-01', pattern: 'MONTHLY' }),
    ).toEqual(['2028-01-31', '2028-02-29', '2028-03-31']);
    // Weekly across the year boundary.
    expect(
      seriesHorizonYmds({ anchorYmd: '2026-12-24', horizonEndYmd: '2027-01-15', pattern: 'WEEKLY' }),
    ).toEqual(['2026-12-24', '2026-12-31', '2027-01-07', '2027-01-14']);
    // Biweekly Monday across the October DST switch: civil days, not 7×24 h.
    expect(
      seriesHorizonYmds({
        anchorYmd: '2026-10-19',
        horizonEndYmd: '2026-11-17',
        pattern: 'BIWEEKLY',
        weekDays: [1],
      }),
    ).toEqual(['2026-10-19', '2026-11-02', '2026-11-16']);
  });

  it('C3: a daily series in Europe/Kyiv keeps its wall clock across the DST switch', async () => {
    kit = await createPlacementKit({
      now: '2026-10-24T05:00:00.000Z',
      timeZone: 'Europe/Kyiv',
      horizonDays: 3,
    });
    const series = await create({
      name: 'Run',
      eventType: TaskEventType.ADMIN,
      isRecurring: true,
      recurrencePattern: 'DAILY',
      scheduledStartTime: kit.at('2026-10-24', '18:00').toISOString(),
      estimatedTimeInMinutes: 60,
      timeZone: 'Europe/Kyiv',
    });
    // 24 Oct is +03:00, 25 and 26 Oct are +02:00: same 18:00 local, different UTC.
    expect(await kit.slotsOf(series.id)).toEqual([
      '2026-10-24 18:00-19:00',
      '2026-10-25 18:00-19:00',
      '2026-10-26 18:00-19:00',
    ]);
    const rows = (await kit.slotRepo.find({ where: { taskId: series.id } }))
      .map((row) => new Date(row.scheduledStartTime).toISOString())
      .sort();
    expect(rows).toEqual([
      '2026-10-24T15:00:00.000Z',
      '2026-10-25T16:00:00.000Z',
      '2026-10-26T16:00:00.000Z',
    ]);
  });

  it('D2: a fully booked day parks a new flexible task instead of overlapping', async () => {
    kit = await createPlacementKit({
      now: '2026-11-05T07:00:00.000Z',
      wakeTime: '08:00',
      sleepTime: '10:00',
      horizonDays: 1,
    });
    await create({
      name: 'Wall',
      eventType: TaskEventType.FIXED,
      scheduledStartTime: kit.at('2026-11-05', '08:00').toISOString(),
      scheduledEndTime: kit.at('2026-11-05', '10:00').toISOString(),
      estimatedTimeInMinutes: 120,
    });
    const flexible = await create({ name: 'Extra', estimatedTimeInMinutes: 60 });
    const row = await kit.reload(flexible.id);
    expect(await kit.slotsOf(flexible.id)).toEqual([]);
    expect([ScheduleState.PROBLEMATIC]).toContain(row.scheduleState);
  });
});
