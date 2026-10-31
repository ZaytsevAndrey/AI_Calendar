/**
 * `PATCH /tasks/:id/occurrence` on the real services over in-memory SQLite:
 * one day of a series, this day and the following, and per-occurrence
 * completion (documentation/scheduling-ui-alignment.md, decisions C and D).
 */
import { TaskEventType } from '../scheduling/event-type.enum';
import { TaskStatus, type Task } from '../tasks/entities/task.entity';
import { createPlacementKit, type PlacementKit } from '../../../test/helpers/placement-sqlite.kit';

describe('occurrence edits', () => {
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
  const edit = async (id: string, body: Record<string, unknown>) => {
    const out = await kit.occurrenceEdit.edit(id, kit.user.id, body as never);
    await kit.jobs.settle();
    return out;
  };
  const days = async (taskId: string) => (await kit.slotsOf(taskId)).map((row) => row.slice(0, 10));
  const copyFor = async (ymd: string) =>
    (await kit.taskRepo.find()).find((row) => row.originalOccurrenceYmd === ymd && !row.isRecurring);

  // 2026-11-05 is a Thursday.
  const dailySeries = (extra: Record<string, unknown> = {}) =>
    create({
      name: 'Gym',
      description: 'Leg day',
      eventType: TaskEventType.ADMIN,
      isRecurring: true,
      recurrencePattern: 'DAILY',
      scheduledStartTime: kit.at('2026-11-05', '10:00').toISOString(),
      estimatedTimeInMinutes: 60,
      ...extra,
    });

  describe('one occurrence', () => {
    it('renames one day: the day becomes a copy with lineage, the series keeps its name', async () => {
      kit = await createPlacementKit({ now: '2026-11-05T06:00:00.000Z', horizonDays: 5 });
      const series = await dailySeries();
      const out = await edit(series.id, {
        occurrenceStart: kit.at('2026-11-07', '10:00').toISOString(),
        name: 'Gym with Max',
        description: 'Bring the band',
      });
      expect(out.id).not.toBe(series.id);
      expect(out.name).toBe('Gym with Max');
      expect(out.description).toBe('Bring the band');
      expect(out.isRecurring).toBe(false);
      expect(out.parentSeriesId).toBe(series.id);
      expect(out.seriesGroupId).toBe(series.id);
      expect(out.originalOccurrenceYmd).toBe('2026-11-07');
      expect(await kit.slotsOf(out.id)).toEqual(['2026-11-07 10:00-11:00']);

      const after = await kit.reload(series.id);
      expect(after.name).toBe('Gym');
      expect(after.skippedOccurrenceYmds).toEqual(['2026-11-07']);
      expect(await days(series.id)).toEqual(['2026-11-05', '2026-11-06', '2026-11-08', '2026-11-09']);
    });

    it('moves one day to another clock and changes its duration', async () => {
      kit = await createPlacementKit({ now: '2026-11-05T06:00:00.000Z', horizonDays: 5 });
      const series = await dailySeries();
      const out = await edit(series.id, {
        occurrenceStart: kit.at('2026-11-06', '10:00').toISOString(),
        start: kit.at('2026-11-06', '15:00').toISOString(),
        durationMinutes: 30,
      });
      expect(await kit.slotsOf(out.id)).toEqual(['2026-11-06 15:00-15:30']);
      expect(out.estimatedTimeInMinutes).toBe(30);
      expect(await days(series.id)).not.toContain('2026-11-06');
    });

    it('refuses to move an occurrence to another day', async () => {
      kit = await createPlacementKit({ now: '2026-11-05T06:00:00.000Z', horizonDays: 5 });
      const series = await dailySeries();
      await expect(
        edit(series.id, {
          occurrenceStart: kit.at('2026-11-06', '10:00').toISOString(),
          start: kit.at('2026-11-07', '10:00').toISOString(),
        }),
      ).rejects.toThrow(/own day/);
      expect(await days(series.id)).toHaveLength(5);
    });

    it('changes the phase of one day only', async () => {
      kit = await createPlacementKit({ now: '2026-11-05T06:00:00.000Z', horizonDays: 5 });
      const evening = await kit.addPhase({ name: 'Evening', startTime: '17:00', endTime: '22:00' });
      const series = await dailySeries();
      const out = await edit(series.id, {
        occurrenceStart: kit.at('2026-11-06', '10:00').toISOString(),
        phaseIds: [evening.id],
      });
      expect(out.phaseId).toBe(evening.id);
      expect((await kit.reload(series.id)).phaseId).toBeNull();
      // Same clock: the phase is a label here; the copy keeps the slot it had.
      expect(await kit.slotsOf(out.id)).toEqual(['2026-11-06 10:00-11:00']);
    });

    it('a second edit of the same day lands on the same copy (no duplicate)', async () => {
      kit = await createPlacementKit({ now: '2026-11-05T06:00:00.000Z', horizonDays: 5 });
      const series = await dailySeries();
      const first = await edit(series.id, {
        occurrenceStart: kit.at('2026-11-06', '10:00').toISOString(),
        name: 'Gym A',
      });
      const second = await edit(series.id, {
        occurrenceStart: kit.at('2026-11-06', '10:00').toISOString(),
        name: 'Gym B',
        start: kit.at('2026-11-06', '12:00').toISOString(),
      });
      expect(second.id).toBe(first.id);
      expect(second.name).toBe('Gym B');
      expect(second.seriesGroupId).toBe(series.id);
      expect(await kit.slotsOf(first.id)).toEqual(['2026-11-06 12:00-13:00']);
      expect((await kit.taskRepo.find()).filter((r) => r.originalOccurrenceYmd === '2026-11-06')).toHaveLength(1);
    });

    it('a rename of a day on a fixed series keeps the copy fixed at its clock', async () => {
      kit = await createPlacementKit({ now: '2026-11-05T06:00:00.000Z', horizonDays: 5 });
      const series = await dailySeries({
        eventType: TaskEventType.FIXED,
        scheduledEndTime: kit.at('2026-11-05', '11:00').toISOString(),
      });
      const out = await edit(series.id, {
        occurrenceStart: kit.at('2026-11-06', '10:00').toISOString(),
        name: 'Standup (guest)',
      });
      expect(out.eventType).toBe(TaskEventType.FIXED);
      expect(await kit.slotsOf(out.id)).toEqual(['2026-11-06 10:00-11:00']);
    });

    it('a move onto a fixed anchor is refused and nothing changes', async () => {
      kit = await createPlacementKit({ now: '2026-11-05T06:00:00.000Z', horizonDays: 5 });
      const series = await dailySeries();
      await create({
        name: 'Dentist',
        eventType: TaskEventType.FIXED,
        scheduledStartTime: kit.at('2026-11-06', '15:00').toISOString(),
        scheduledEndTime: kit.at('2026-11-06', '16:00').toISOString(),
        estimatedTimeInMinutes: 60,
      });
      const out = await edit(series.id, {
        occurrenceStart: kit.at('2026-11-06', '10:00').toISOString(),
        start: kit.at('2026-11-06', '15:00').toISOString(),
      });
      expect(out.conflicts?.length).toBe(1);
      expect(await copyFor('2026-11-06')).toBeUndefined();
      expect(await days(series.id)).toContain('2026-11-06');
      expect((await kit.reload(series.id)).skippedOccurrenceYmds ?? []).toEqual([]);
    });

    it('the series itself is not an occurrence: a one-off is refused', async () => {
      kit = await createPlacementKit({ now: '2026-11-05T06:00:00.000Z', horizonDays: 5 });
      const single = await create({
        name: 'Call',
        eventType: TaskEventType.ADMIN,
        estimatedTimeInMinutes: 30,
      });
      await expect(
        edit(single.id, { occurrenceStart: kit.at('2026-11-05', '10:00').toISOString(), name: 'X' }),
      ).rejects.toThrow(/Only a series/);
    });

    it('another user cannot edit the series', async () => {
      kit = await createPlacementKit({ now: '2026-11-05T06:00:00.000Z', horizonDays: 5 });
      const series = await dailySeries();
      await expect(
        kit.occurrenceEdit.edit('00000000-0000-4000-8000-000000000001', kit.user.id, {
          occurrenceStart: kit.at('2026-11-06', '10:00').toISOString(),
          name: 'X',
        } as never),
      ).rejects.toThrow(/not found/i);
      await expect(
        kit.occurrenceEdit.edit(series.id, 'someone-else', {
          occurrenceStart: kit.at('2026-11-06', '10:00').toISOString(),
          name: 'X',
        } as never),
      ).rejects.toThrow(/not found/i);
    });
  });

  describe('this and following', () => {
    it('splits the series: history keeps the old name, the tail carries the new one', async () => {
      kit = await createPlacementKit({ now: '2026-11-05T06:00:00.000Z', horizonDays: 5 });
      const series = await dailySeries();
      const tail = await edit(series.id, {
        occurrenceStart: kit.at('2026-11-07', '10:00').toISOString(),
        scope: 'following',
        name: 'Gym (new coach)',
      });
      expect(tail.id).not.toBe(series.id);
      expect(tail.isRecurring).toBe(true);
      expect(tail.name).toBe('Gym (new coach)');
      expect(tail.seriesGroupId).toBe(series.id);
      expect(await kit.slotsOf(tail.id)).toEqual([
        '2026-11-07 10:00-11:00',
        '2026-11-08 10:00-11:00',
        '2026-11-09 10:00-11:00',
      ]);
      const old = await kit.reload(series.id);
      expect(old.name).toBe('Gym');
      expect(await days(series.id)).toEqual(['2026-11-05', '2026-11-06']);
    });

    it('a new clock and duration for this day and following', async () => {
      kit = await createPlacementKit({ now: '2026-11-05T06:00:00.000Z', horizonDays: 5 });
      const series = await dailySeries();
      const tail = await edit(series.id, {
        occurrenceStart: kit.at('2026-11-07', '10:00').toISOString(),
        scope: 'following',
        start: kit.at('2026-11-07', '18:00').toISOString(),
        durationMinutes: 45,
      });
      expect(await kit.slotsOf(tail.id)).toEqual([
        '2026-11-07 18:00-18:45',
        '2026-11-08 18:00-18:45',
        '2026-11-09 18:00-18:45',
      ]);
      expect(await days(series.id)).toEqual(['2026-11-05', '2026-11-06']);
    });

    it('from the first day (no history) the whole series changes instead of leaving an empty one', async () => {
      kit = await createPlacementKit({ now: '2026-11-05T06:00:00.000Z', horizonDays: 5 });
      const series = await dailySeries();
      const out = await edit(series.id, {
        occurrenceStart: kit.at('2026-11-05', '10:00').toISOString(),
        scope: 'following',
        name: 'Gym 2',
      });
      expect(out.id).toBe(series.id);
      expect(out.name).toBe('Gym 2');
      expect(await days(series.id)).toHaveLength(5);
      expect((await kit.taskRepo.find()).length).toBe(1);
    });

    it('completion is not a "following" change', async () => {
      kit = await createPlacementKit({ now: '2026-11-05T06:00:00.000Z', horizonDays: 5 });
      const series = await dailySeries();
      await expect(
        edit(series.id, {
          occurrenceStart: kit.at('2026-11-06', '10:00').toISOString(),
          scope: 'following',
          status: 'completed',
        }),
      ).rejects.toThrow(/one occurrence/);
    });
  });

  describe('per-occurrence completion', () => {
    it('completes one day: that day only, with a timestamp; the series and other days stay to do', async () => {
      kit = await createPlacementKit({ now: '2026-11-05T06:00:00.000Z', horizonDays: 5 });
      const series = await dailySeries();
      jest.setSystemTime(new Date('2026-11-06T12:00:00.000Z'));
      const done = await edit(series.id, {
        occurrenceStart: kit.at('2026-11-06', '10:00').toISOString(),
        status: 'completed',
      });
      expect(done.status).toBe(TaskStatus.COMPLETED);
      expect(done.completedAt).not.toBeNull();
      expect(new Date(done.completedAt!).toISOString()).toBe('2026-11-06T12:00:00.000Z');
      expect(done.originalOccurrenceYmd).toBe('2026-11-06');
      expect(await kit.slotsOf(done.id)).toEqual(['2026-11-06 10:00-11:00']);
      const after = await kit.reload(series.id);
      expect(after.status).toBe(TaskStatus.TODO);
      expect(after.completedAt).toBeNull();
      expect(await days(series.id)).toEqual(['2026-11-05', '2026-11-07', '2026-11-08', '2026-11-09']);
    });

    it('completes a past day (yesterday) without moving anything', async () => {
      kit = await createPlacementKit({ now: '2026-11-05T06:00:00.000Z', horizonDays: 5 });
      const series = await dailySeries();
      jest.setSystemTime(kit.at('2026-11-07', '09:00'));
      const done = await edit(series.id, {
        occurrenceStart: kit.at('2026-11-06', '10:00').toISOString(),
        status: 'completed',
      });
      expect(done.status).toBe(TaskStatus.COMPLETED);
      expect(await kit.slotsOf(done.id)).toEqual(['2026-11-06 10:00-11:00']);
      expect(await days(series.id)).toEqual(['2026-11-05', '2026-11-07', '2026-11-08', '2026-11-09']);
    });

    it('undo: the day goes back to "to do" and keeps its slot', async () => {
      kit = await createPlacementKit({ now: '2026-11-05T06:00:00.000Z', horizonDays: 5 });
      const series = await dailySeries();
      const done = await edit(series.id, {
        occurrenceStart: kit.at('2026-11-06', '10:00').toISOString(),
        status: 'completed',
      });
      const undone = await edit(series.id, {
        occurrenceStart: kit.at('2026-11-06', '10:00').toISOString(),
        status: 'todo',
      });
      await kit.jobs.settle();
      expect(undone.id).toBe(done.id);
      const row = await kit.reload(done.id);
      expect(row.status).toBe(TaskStatus.TODO);
      expect(row.completedAt).toBeNull();
      expect(await kit.slotsOf(done.id)).toEqual(['2026-11-06 10:00-11:00']);
    });

    it('two separate days are two independent completions', async () => {
      kit = await createPlacementKit({ now: '2026-11-05T06:00:00.000Z', horizonDays: 5 });
      const series = await dailySeries();
      const a = await edit(series.id, {
        occurrenceStart: kit.at('2026-11-06', '10:00').toISOString(),
        status: 'completed',
      });
      const b = await edit(series.id, {
        occurrenceStart: kit.at('2026-11-08', '10:00').toISOString(),
        status: 'completed',
      });
      expect(a.id).not.toBe(b.id);
      await edit(series.id, {
        occurrenceStart: kit.at('2026-11-06', '10:00').toISOString(),
        status: 'todo',
      });
      expect((await kit.reload(a.id)).status).toBe(TaskStatus.TODO);
      expect((await kit.reload(b.id)).status).toBe(TaskStatus.COMPLETED);
      expect(await days(series.id)).toEqual(['2026-11-05', '2026-11-07', '2026-11-09']);
    });

    it('a completed day survives a horizon rewrite of the series', async () => {
      kit = await createPlacementKit({ now: '2026-11-05T06:00:00.000Z', horizonDays: 5 });
      const series = await dailySeries();
      const done = await edit(series.id, {
        occurrenceStart: kit.at('2026-11-06', '10:00').toISOString(),
        status: 'completed',
      });
      // New clock for the whole series: every open day is rewritten.
      await kit.tasksService.update(series.id, kit.user.id, {
        scheduledStartTime: kit.at('2026-11-05', '14:00').toISOString(),
        scheduledEndTime: kit.at('2026-11-05', '15:00').toISOString(),
      } as never);
      await kit.jobs.settle();
      expect(await kit.slotsOf(series.id)).toEqual([
        '2026-11-05 14:00-15:00',
        '2026-11-07 14:00-15:00',
        '2026-11-08 14:00-15:00',
        '2026-11-09 14:00-15:00',
      ]);
      const kept = await kit.reload(done.id);
      expect(kept.status).toBe(TaskStatus.COMPLETED);
      expect(await kit.slotsOf(done.id)).toEqual(['2026-11-06 10:00-11:00']);
      // Appending the horizon later does not bring the day back either.
      jest.setSystemTime(kit.at('2026-11-05', '20:00'));
      await kit.service.place(kit.user.id, series.id, { commit: 'keep', expandSeries: true });
      expect(await days(series.id)).not.toContain('2026-11-06');
    });

    it('a completed copy can be edited and moved like a one-off and keeps its completion', async () => {
      kit = await createPlacementKit({ now: '2026-11-05T06:00:00.000Z', horizonDays: 5 });
      const series = await dailySeries();
      const done = await edit(series.id, {
        occurrenceStart: kit.at('2026-11-06', '10:00').toISOString(),
        status: 'completed',
      });
      const moved = await kit.tasksService.update(done.id, kit.user.id, {
        name: 'Gym (done early)',
        scheduledStartTime: kit.at('2026-11-06', '08:00').toISOString(),
        scheduledEndTime: kit.at('2026-11-06', '09:00').toISOString(),
      } as never);
      await kit.jobs.settle();
      expect(moved.status).toBe(TaskStatus.COMPLETED);
      expect(moved.completedAt).not.toBeNull();
      expect(await kit.slotsOf(done.id)).toEqual(['2026-11-06 08:00-09:00']);
    });

    it('the completed copy stays when the series turns its repeat off', async () => {
      kit = await createPlacementKit({ now: '2026-11-05T06:00:00.000Z', horizonDays: 5 });
      const series = await dailySeries();
      const done = await edit(series.id, {
        occurrenceStart: kit.at('2026-11-06', '10:00').toISOString(),
        status: 'completed',
      });
      await kit.tasksService.update(series.id, kit.user.id, {
        isRecurring: false,
        recurrencePattern: null,
        recurrenceWeekDays: [],
      } as never);
      await kit.jobs.settle();
      expect((await kit.reload(done.id)).status).toBe(TaskStatus.COMPLETED);
      expect(await kit.slotsOf(series.id)).toEqual(['2026-11-05 10:00-11:00']);
    });

    it('a one-off task stamps completedAt on completion and clears it on undo', async () => {
      kit = await createPlacementKit({ now: '2026-11-05T06:00:00.000Z', horizonDays: 5 });
      const single = await create({
        name: 'Call',
        eventType: TaskEventType.ADMIN,
        estimatedTimeInMinutes: 30,
      });
      const done = await kit.tasksService.updateStatus(single.id, kit.user.id, TaskStatus.COMPLETED);
      expect(done.completedAt).not.toBeNull();
      const undone = await kit.tasksService.updateStatus(single.id, kit.user.id, TaskStatus.TODO);
      await kit.jobs.settle();
      expect(undone.completedAt).toBeNull();
    });
  });
});
