/**
 * Series edits through `PATCH /tasks/:id` (TasksService.update) on the real
 * services over in-memory SQLite. Written as regression tests for the UI
 * alignment work (documentation/scheduling-ui-alignment.md, F3–F5).
 */
import { TaskEventType } from '../scheduling/event-type.enum';
import type { Task } from '../tasks/entities/task.entity';
import { createPlacementKit, type PlacementKit } from '../../../test/helpers/placement-sqlite.kit';

type MoveInternals = {
  moveSeriesDay: (...args: unknown[]) => Promise<string | null>;
};

describe('series edits via PATCH', () => {
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
  const patch = async (id: string, body: Record<string, unknown>) => {
    const saved = await kit.tasksService.update(id, kit.user.id, body as never);
    await kit.jobs.settle();
    return saved;
  };
  const days = async (taskId: string) => (await kit.slotsOf(taskId)).map((row) => row.slice(0, 10));

  // 2026-11-05 is a Thursday.
  const weekdaySeries = () =>
    create({
      name: 'Standup',
      eventType: TaskEventType.ADMIN,
      isRecurring: true,
      recurrencePattern: 'DAILY',
      recurrenceWeekDays: [1, 2, 3, 4, 5],
      scheduledStartTime: kit.at('2026-11-05', '10:00').toISOString(),
      estimatedTimeInMinutes: 30,
    });

  it('F4: narrowing the recurrence days removes the days that are no longer in the rule', async () => {
    kit = await createPlacementKit({ now: '2026-11-05T06:00:00.000Z', horizonDays: 10 });
    const series = await weekdaySeries();
    expect(await days(series.id)).toEqual([
      '2026-11-05', // Thu
      '2026-11-06', // Fri
      '2026-11-09', // Mon
      '2026-11-10', // Tue
      '2026-11-11', // Wed
      '2026-11-12', // Thu
      '2026-11-13', // Fri
    ]);

    // Mon + Wed only: Tue/Thu/Fri days must leave the calendar.
    await patch(series.id, { recurrenceWeekDays: [1, 3] });
    expect(await days(series.id)).toEqual(['2026-11-09', '2026-11-11']);
  });

  it('F4: widening the recurrence days adds the new days and keeps the existing ones', async () => {
    kit = await createPlacementKit({ now: '2026-11-05T06:00:00.000Z', horizonDays: 10 });
    const series = await create({
      name: 'Gym',
      eventType: TaskEventType.ADMIN,
      isRecurring: true,
      recurrencePattern: 'DAILY',
      recurrenceWeekDays: [1],
      scheduledStartTime: kit.at('2026-11-05', '10:00').toISOString(),
      estimatedTimeInMinutes: 30,
    });
    expect(await days(series.id)).toEqual(['2026-11-09']);
    await patch(series.id, { recurrenceWeekDays: [1, 3] });
    expect(await days(series.id)).toEqual(['2026-11-09', '2026-11-11']);
  });

  it('F4: a day already in the past is not touched when the rule changes', async () => {
    kit = await createPlacementKit({ now: '2026-11-05T06:00:00.000Z', horizonDays: 10 });
    const series = await weekdaySeries();
    // Two days later: Thu 5 and Fri 6 are history.
    jest.setSystemTime(new Date('2026-11-07T06:00:00.000Z'));
    await patch(series.id, { recurrenceWeekDays: [1, 3] });
    // History (Thu 5, Fri 6) stays; the open horizon (now 7–17 Nov) follows the new rule.
    expect(await days(series.id)).toEqual([
      '2026-11-05',
      '2026-11-06',
      '2026-11-09',
      '2026-11-11',
      '2026-11-16',
    ]);
  });

  it('F4: changing the pattern (weekly → monthly) rewrites the open horizon', async () => {
    kit = await createPlacementKit({ now: '2026-11-05T06:00:00.000Z', horizonDays: 40 });
    const series = await create({
      name: 'Report',
      eventType: TaskEventType.ADMIN,
      isRecurring: true,
      recurrencePattern: 'WEEKLY',
      scheduledStartTime: kit.at('2026-11-05', '10:00').toISOString(),
      estimatedTimeInMinutes: 30,
    });
    expect((await days(series.id)).length).toBeGreaterThan(3);
    await patch(series.id, { recurrencePattern: 'MONTHLY', recurrenceWeekDays: [] });
    expect(await days(series.id)).toEqual(['2026-11-05', '2026-12-05']);
  });

  it('F3: a PATCH that repeats the current name does not detach a day copy from its series', async () => {
    kit = await createPlacementKit({ now: '2026-11-05T06:00:00.000Z', horizonDays: 5 });
    const series = await weekdaySeries();
    const move = kit.moveService as unknown as MoveInternals;
    await move.moveSeriesDay(
      kit.user.id,
      await kit.reload(series.id),
      {
        googleEventId: 'evt-6',
        originalStart: kit.at('2026-11-06', '10:00').toISOString(),
        originalEnd: kit.at('2026-11-06', '10:30').toISOString(),
        start: kit.at('2026-11-06', '15:00').toISOString(),
        end: kit.at('2026-11-06', '15:30').toISOString(),
        seriesScope: 'occurrence',
      },
      30,
      [],
      '2026-11-06',
    );
    const copy = (await kit.taskRepo.find()).find((row) => row.originalOccurrenceYmd === '2026-11-06');
    expect(copy).toBeDefined();
    expect(copy!.seriesGroupId).toBe(series.id);

    // The form sends every field back; nothing changed except the clock.
    await patch(copy!.id, {
      name: 'Standup',
      description: copy!.description ?? undefined,
      priority: 'medium',
      scheduledStartTime: kit.at('2026-11-06', '16:00').toISOString(),
      scheduledEndTime: kit.at('2026-11-06', '16:30').toISOString(),
    });
    const after = await kit.reload(copy!.id);
    expect(after.seriesGroupId).toBe(series.id);
    expect(after.originalOccurrenceYmd).toBe('2026-11-06');
    expect(await kit.slotsOf(after.id)).toEqual(['2026-11-06 16:00-16:30']);
  });

  it('F3: a rename keeps the copy in its series (lineage), a repeat rule on the copy detaches it', async () => {
    kit = await createPlacementKit({ now: '2026-11-05T06:00:00.000Z', horizonDays: 5 });
    const series = await weekdaySeries();
    const move = kit.moveService as unknown as MoveInternals;
    await move.moveSeriesDay(
      kit.user.id,
      await kit.reload(series.id),
      {
        googleEventId: 'evt-6',
        originalStart: kit.at('2026-11-06', '10:00').toISOString(),
        originalEnd: kit.at('2026-11-06', '10:30').toISOString(),
        start: kit.at('2026-11-06', '15:00').toISOString(),
        end: kit.at('2026-11-06', '15:30').toISOString(),
        seriesScope: 'occurrence',
      },
      30,
      [],
      '2026-11-06',
    );
    const copy = (await kit.taskRepo.find()).find((row) => row.originalOccurrenceYmd === '2026-11-06')!;
    await patch(copy.id, { name: 'Standup (moved)' });
    const renamed = await kit.reload(copy.id);
    expect(renamed.seriesGroupId).toBe(series.id);
    expect(renamed.parentSeriesId).toBe(series.id);
    expect(renamed.originalOccurrenceYmd).toBe('2026-11-06');

    await patch(copy.id, { isRecurring: true, recurrencePattern: 'DAILY' });
    const detached = await kit.reload(copy.id);
    // A series of its own now: its group is its own, not the old series'.
    expect(detached.seriesGroupId).not.toBe(series.id);
    expect(detached.parentSeriesId).toBeNull();
    expect(detached.originalOccurrenceYmd).toBeNull();
  });

  it('F3: a renamed copy put back on the series clock is not swallowed by re-merge', async () => {
    kit = await createPlacementKit({ now: '2026-11-05T06:00:00.000Z', horizonDays: 5 });
    const series = await weekdaySeries();
    const move = kit.moveService as unknown as MoveInternals;
    await move.moveSeriesDay(
      kit.user.id,
      await kit.reload(series.id),
      {
        googleEventId: 'evt-6',
        originalStart: kit.at('2026-11-06', '10:00').toISOString(),
        originalEnd: kit.at('2026-11-06', '10:30').toISOString(),
        start: kit.at('2026-11-06', '15:00').toISOString(),
        end: kit.at('2026-11-06', '15:30').toISOString(),
        seriesScope: 'occurrence',
      },
      30,
      [],
      '2026-11-06',
    );
    const copy = (await kit.taskRepo.find()).find((row) => row.originalOccurrenceYmd === '2026-11-06')!;
    await patch(copy.id, { name: 'Standup (guest)' });
    // Back to 10:00 — the series clock. An identical copy would re-merge; this one must not.
    await patch(copy.id, {
      scheduledStartTime: kit.at('2026-11-06', '10:00').toISOString(),
      scheduledEndTime: kit.at('2026-11-06', '10:30').toISOString(),
    });
    const after = await kit.taskRepo.findOne({ where: { id: copy.id } });
    expect(after).not.toBeNull();
    expect(after!.name).toBe('Standup (guest)');
    expect(await kit.slotsOf(copy.id)).toEqual(['2026-11-06 10:00-10:30']);
    expect((await kit.reload(series.id)).skippedOccurrenceYmds).toEqual(['2026-11-06']);
  });

  describe('F5 / Decision E: turning recurrence off keeps the nearest upcoming occurrence', () => {
    const off = (id: string) =>
      patch(id, { isRecurring: false, recurrencePattern: null, recurrenceWeekDays: [] });

    it('keeps one slot — the nearest upcoming day — and drops the other future days', async () => {
      kit = await createPlacementKit({ now: '2026-11-05T06:00:00.000Z', horizonDays: 10 });
      const series = await weekdaySeries();
      expect((await days(series.id)).length).toBe(7);
      await off(series.id);
      const after = await kit.reload(series.id);
      expect(after.isRecurring).toBe(false);
      expect(after.recurrencePattern).toBeNull();
      expect(after.seriesGroupId).toBeNull();
      expect(await kit.slotsOf(series.id)).toEqual(['2026-11-05 10:00-10:30']);
      expect(new Date(after.scheduledStartTime!).toISOString()).toBe(
        kit.at('2026-11-05', '10:00').toISOString(),
      );
    });

    it('a running occurrence counts as the nearest one; past days stay as history', async () => {
      kit = await createPlacementKit({ now: '2026-11-05T06:00:00.000Z', horizonDays: 10 });
      const series = await weekdaySeries();
      // Fri 6 Nov 10:10 — Thu is history, Friday is in progress.
      jest.setSystemTime(kit.at('2026-11-06', '10:10'));
      await off(series.id);
      expect(await kit.slotsOf(series.id)).toEqual([
        '2026-11-05 10:00-10:30',
        '2026-11-06 10:00-10:30',
      ]);
      const after = await kit.reload(series.id);
      expect(new Date(after.scheduledStartTime!).toISOString()).toBe(
        kit.at('2026-11-06', '10:00').toISOString(),
      );
    });

    it('detached day copies are left alone', async () => {
      kit = await createPlacementKit({ now: '2026-11-05T06:00:00.000Z', horizonDays: 10 });
      const series = await weekdaySeries();
      const move = kit.moveService as unknown as MoveInternals;
      await move.moveSeriesDay(
        kit.user.id,
        await kit.reload(series.id),
        {
          googleEventId: 'evt-9',
          originalStart: kit.at('2026-11-09', '10:00').toISOString(),
          originalEnd: kit.at('2026-11-09', '10:30').toISOString(),
          start: kit.at('2026-11-09', '15:00').toISOString(),
          end: kit.at('2026-11-09', '15:30').toISOString(),
          seriesScope: 'occurrence',
        },
        30,
        [],
        '2026-11-09',
      );
      const copy = (await kit.taskRepo.find()).find((row) => row.originalOccurrenceYmd === '2026-11-09')!;
      await off(series.id);
      const copyAfter = await kit.reload(copy.id);
      expect(copyAfter).toBeDefined();
      expect(await kit.slotsOf(copy.id)).toEqual(['2026-11-09 15:00-15:30']);
      expect(await kit.slotsOf(series.id)).toEqual(['2026-11-05 10:00-10:30']);
      expect((await kit.taskRepo.find()).length).toBe(2);
    });

    it('is idempotent: the same request again changes nothing', async () => {
      kit = await createPlacementKit({ now: '2026-11-05T06:00:00.000Z', horizonDays: 10 });
      const series = await weekdaySeries();
      await off(series.id);
      await off(series.id);
      expect(await kit.slotsOf(series.id)).toEqual(['2026-11-05 10:00-10:30']);
      expect((await kit.reload(series.id)).isRecurring).toBe(false);
    });

    it('refuses when there is no upcoming occurrence instead of picking a past one', async () => {
      kit = await createPlacementKit({ now: '2026-11-05T06:00:00.000Z', horizonDays: 3 });
      const series = await weekdaySeries();
      const before = await kit.slotsOf(series.id);
      jest.setSystemTime(new Date('2026-11-20T06:00:00.000Z'));
      await expect(off(series.id)).rejects.toThrow(/no upcoming occurrence/);
      const after = await kit.reload(series.id);
      expect(after.isRecurring).toBe(true);
      expect(await kit.slotsOf(series.id)).toEqual(before);
    });
  });
});
