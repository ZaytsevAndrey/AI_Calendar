/**
 * PE-18: series exceptions are one transaction with their placement.
 * Real PlacementStepService / DisplayedEventMoveService / ProblematicPlaceService
 * on in-memory SQLite (test/helpers/placement-sqlite.kit.ts).
 */
import { TaskEventType } from '../scheduling/event-type.enum';
import { ScheduleState, Task } from '../tasks/entities/task.entity';
import { createPlacementKit, type PlacementKit } from '../../../test/helpers/placement-sqlite.kit';

type MoveInternals = {
  moveSeriesDay: (...args: unknown[]) => Promise<string | null>;
  moveSeriesTail: (...args: unknown[]) => Promise<void>;
};

describe('series exceptions are atomic (PE-18)', () => {
  let kit: PlacementKit;
  let series: Task;

  beforeEach(async () => {
    kit = await createPlacementKit({ now: '2026-11-05T08:00:00.000Z', horizonDays: 3 });
    series = await kit.addTask({
      name: 'Daily',
      isRecurring: true,
      recurrencePattern: 'DAILY',
      scheduleTimeZone: 'UTC',
      scheduledStartTime: kit.at('2026-11-05', '10:00'),
      scheduledEndTime: kit.at('2026-11-05', '11:00'),
    });
    for (const ymd of ['2026-11-05', '2026-11-06', '2026-11-07']) {
      await kit.addSlot(series.id, kit.at(ymd, '10:00'), kit.at(ymd, '11:00'));
    }
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await kit.destroy();
  });

  const move = () => kit.moveService as unknown as MoveInternals;
  const dragDay = () =>
    move().moveSeriesDay(
      kit.user.id,
      series,
      {
        googleEventId: 'evt-6',
        originalStart: kit.at('2026-11-06', '10:00').toISOString(),
        originalEnd: kit.at('2026-11-06', '11:00').toISOString(),
        start: kit.at('2026-11-06', '15:00').toISOString(),
        end: kit.at('2026-11-06', '16:00').toISOString(),
      },
      60,
      [],
      '2026-11-06',
    );
  const copiesFor = async (ymd: string) =>
    (await kit.taskRepo.find()).filter(
      (row) => !row.isRecurring && row.originalOccurrenceYmd === ymd,
    );
  const untouched = async () => {
    expect(await kit.slotsOf(series.id)).toEqual([
      '2026-11-05 10:00-11:00',
      '2026-11-06 10:00-11:00',
      '2026-11-07 10:00-11:00',
    ]);
    expect((await kit.reload(series.id)).skippedOccurrenceYmds ?? []).toEqual([]);
    expect(await copiesFor('2026-11-06')).toEqual([]);
  };

  it('moveSeriesDay: skip, copy and seat land together; a retry adds nothing', async () => {
    await dragDay();
    await dragDay();

    expect(await kit.slotsOf(series.id)).toEqual([
      '2026-11-05 10:00-11:00',
      '2026-11-07 10:00-11:00',
    ]);
    expect((await kit.reload(series.id)).skippedOccurrenceYmds).toEqual(['2026-11-06']);
    const copies = await copiesFor('2026-11-06');
    expect(copies).toHaveLength(1);
    expect(await kit.slotsOf(copies[0].id)).toEqual(['2026-11-06 15:00-16:00']);
  });

  it('moveSeriesDay onto an anchor rolls back and reports the conflict', async () => {
    const meeting = await kit.addTask({
      name: 'Meeting',
      eventType: TaskEventType.FIXED,
      scheduledStartTime: kit.at('2026-11-06', '15:00'),
      scheduledEndTime: kit.at('2026-11-06', '16:00'),
    });
    await kit.addSlot(meeting.id, kit.at('2026-11-06', '15:00'), kit.at('2026-11-06', '16:00'));

    await dragDay();

    await untouched();
    expect(kit.jobs.completeMutationJob).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ conflicts: [expect.objectContaining({ reason: 'preferred_on_fixed' })] }),
    );
  });

  it('moveSeriesDay failing mid-write leaves no skip and no copy', async () => {
    jest
      .spyOn(kit.service as never, 'placeUnlocked')
      .mockRejectedValueOnce(new Error('crash while seating') as never);

    await expect(dragDay()).rejects.toThrow('crash while seating');

    await untouched();
  });

  it('a Google failure after the commit keeps the committed state, and a retry is idempotent', async () => {
    kit.pendingGoogleWrites.syncTask.mockRejectedValueOnce(new Error('google down'));

    await expect(dragDay()).rejects.toThrow('google down');
    expect(await copiesFor('2026-11-06')).toHaveLength(1);

    await dragDay();
    expect(await copiesFor('2026-11-06')).toHaveLength(1);
    expect((await kit.reload(series.id)).skippedOccurrenceYmds).toEqual(['2026-11-06']);
  });

  const dragTail = () =>
    move().moveSeriesTail(
      kit.user.id,
      series,
      {
        googleEventId: 'evt-6',
        originalStart: kit.at('2026-11-06', '10:00').toISOString(),
        originalEnd: kit.at('2026-11-06', '11:00').toISOString(),
        start: kit.at('2026-11-06', '15:00').toISOString(),
        end: kit.at('2026-11-06', '16:00').toISOString(),
      },
      kit.at('2026-11-06', '15:00'),
      kit.at('2026-11-06', '16:00'),
      60,
      [],
    );

  it('moveSeriesTail: truncate + new series + seat in one write; a retry reuses the tail', async () => {
    await dragTail();
    await dragTail();

    const tails = (await kit.taskRepo.find()).filter(
      (row) => row.isRecurring && row.id !== series.id,
    );
    expect(tails).toHaveLength(1);
    expect(await kit.slotsOf(series.id)).toEqual(['2026-11-05 10:00-11:00']);
    expect(await kit.slotsOf(tails[0].id)).toEqual([
      '2026-11-06 15:00-16:00',
      '2026-11-07 15:00-16:00',
    ]);
    const perDay = new Map<string, number>();
    for (const row of await kit.slotRepo.find()) {
      const ymd = kit.ymdOf(row.scheduledStartTime);
      perDay.set(ymd, (perDay.get(ymd) ?? 0) + 1);
    }
    expect([...perDay.values()].every((count) => count === 1)).toBe(true);
  });

  it('moveSeriesTail failing mid-write keeps the old series whole', async () => {
    jest
      .spyOn(kit.service as never, 'placeUnlocked')
      .mockRejectedValueOnce(new Error('crash while seating') as never);

    await expect(dragTail()).rejects.toThrow('crash while seating');

    await untouched();
    expect((await kit.reload(series.id)).deadline).toBeNull();
    expect((await kit.taskRepo.find()).filter((row) => row.isRecurring)).toHaveLength(1);
  });

  it('Problematic Move of a parked series day: copy + skip + seat; taken slot leaves nothing', async () => {
    const day = '2026-11-06';
    await kit.slotRepo.delete({ taskId: series.id });
    await kit.taskRepo.update(
      { id: series.id },
      {
        scheduleState: ScheduleState.PROBLEMATIC,
        problematicDay: day,
        problematicOccurrenceYmds: [day],
      },
    );
    const blocker = await kit.addTask({
      name: 'Meeting',
      eventType: TaskEventType.FIXED,
      scheduledStartTime: kit.at(day, '12:00'),
      scheduledEndTime: kit.at(day, '13:00'),
    });
    await kit.addSlot(blocker.id, kit.at(day, '12:00'), kit.at(day, '13:00'));

    await expect(
      kit.problematicPlace.place(kit.user.id, series.id, {
        start: kit.at(day, '12:00').toISOString(),
        end: kit.at(day, '13:00').toISOString(),
        occurrenceYmd: day,
      }),
    ).rejects.toThrow();
    expect(await copiesFor(day)).toEqual([]);
    expect((await kit.reload(series.id)).problematicOccurrenceYmds).toEqual([day]);

    const out = await kit.problematicPlace.place(kit.user.id, series.id, {
      start: kit.at(day, '15:00').toISOString(),
      end: kit.at(day, '16:00').toISOString(),
      occurrenceYmd: day,
    });
    expect(await kit.slotsOf(out.taskId)).toEqual(['2026-11-06 15:00-16:00']);
    const after = await kit.reload(series.id);
    expect(after.scheduleState).toBe(ScheduleState.NONE);
    expect(after.skippedOccurrenceYmds).toEqual([day]);
  });

  it('a day of a fixed series can be skipped; a fixed one-off cannot', async () => {
    const standup = await kit.addTask({
      name: 'Standup',
      eventType: TaskEventType.FIXED,
      isRecurring: true,
      recurrencePattern: 'DAILY',
      scheduledStartTime: kit.at('2026-11-06', '09:00'),
      scheduledEndTime: kit.at('2026-11-06', '09:30'),
    });
    await kit.addSlot(standup.id, kit.at('2026-11-06', '09:00'), kit.at('2026-11-06', '09:30'));
    await kit.tasksService.skipOccurrence(standup.id, kit.user.id, {
      occurrenceStart: kit.at('2026-11-06', '09:00').toISOString(),
    });
    expect((await kit.reload(standup.id)).skippedOccurrenceYmds).toEqual(['2026-11-06']);
    expect(await kit.slotsOf(standup.id)).toEqual([]);

    const meeting = await kit.addTask({
      name: 'Meeting',
      eventType: TaskEventType.FIXED,
      scheduledStartTime: kit.at('2026-11-06', '17:00'),
      scheduledEndTime: kit.at('2026-11-06', '18:00'),
    });
    await kit.addSlot(meeting.id, kit.at('2026-11-06', '17:00'), kit.at('2026-11-06', '18:00'));
    await expect(
      kit.tasksService.skipOccurrence(meeting.id, kit.user.id, {
        occurrenceStart: kit.at('2026-11-06', '17:00').toISOString(),
      }),
    ).rejects.toThrow('Fixed events cannot be skipped');
  });
});
