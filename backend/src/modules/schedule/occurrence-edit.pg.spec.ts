/**
 * Series integrity on a real Postgres: one-day edits and completions commit
 * as a unit, concurrent edits of two days of one series never collide, and
 * turning repeat off is one transaction. Needs PG_TEST_URL and DATABASE_URL
 * set to the same URL; each test gets its own throwaway database.
 */
import { TaskEventType } from '../scheduling/event-type.enum';
import { TaskStatus, type Task } from '../tasks/entities/task.entity';
import { createPlacementKit, type PlacementKit } from '../../../test/helpers/placement-sqlite.kit';

const url = process.env.PG_TEST_URL;
const describePg = url ? describe : describe.skip;

describePg('occurrence edits on Postgres', () => {
  jest.setTimeout(60_000);
  let kit: PlacementKit;

  beforeEach(async () => {
    kit = await createPlacementKit({ now: '2026-11-05T06:00:00.000Z', horizonDays: 5, postgresUrl: url });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await kit?.destroy();
  });

  const series = async () => {
    const created = await kit.tasksService.create(kit.user.id, {
      timeZone: 'UTC',
      priority: 'medium',
      allowSplit: false,
      name: 'Gym',
      eventType: TaskEventType.ADMIN,
      isRecurring: true,
      recurrencePattern: 'DAILY',
      scheduledStartTime: kit.at('2026-11-05', '10:00').toISOString(),
      estimatedTimeInMinutes: 60,
    } as never);
    await kit.jobs.settle();
    return created as Task;
  };
  const days = async (taskId: string) => (await kit.slotsOf(taskId)).map((row) => row.slice(0, 10));

  it('two days edited at once end up as two copies and the series keeps the rest', async () => {
    const s = await series();
    const [a, b] = await Promise.all([
      kit.occurrenceEdit.edit(s.id, kit.user.id, {
        occurrenceStart: kit.at('2026-11-06', '10:00').toISOString(),
        status: 'completed',
      } as never),
      kit.occurrenceEdit.edit(s.id, kit.user.id, {
        occurrenceStart: kit.at('2026-11-07', '10:00').toISOString(),
        name: 'Gym (coach)',
        start: kit.at('2026-11-07', '18:00').toISOString(),
      } as never),
    ]);
    await kit.jobs.settle();
    expect(a.id).not.toBe(b.id);
    expect(a.status).toBe(TaskStatus.COMPLETED);
    expect(b.name).toBe('Gym (coach)');
    expect(await kit.slotsOf(a.id)).toEqual(['2026-11-06 10:00-11:00']);
    expect(await kit.slotsOf(b.id)).toEqual(['2026-11-07 18:00-19:00']);
    const after = await kit.reload(s.id);
    expect([...(after.skippedOccurrenceYmds ?? [])].sort()).toEqual(['2026-11-06', '2026-11-07']);
    expect(await days(s.id)).toEqual(['2026-11-05', '2026-11-08', '2026-11-09']);
    // Exactly one task per civil day across the whole family.
    const all = await kit.taskRepo.find();
    expect(all.filter((row) => row.originalOccurrenceYmd === '2026-11-06')).toHaveLength(1);
    expect(all.filter((row) => row.originalOccurrenceYmd === '2026-11-07')).toHaveLength(1);
  });

  it('a failure while writing the copy rolls the skip back too', async () => {
    const s = await series();
    const real = kit.taskRepo.manager.transaction.bind(kit.taskRepo.manager);
    jest.spyOn(kit.taskRepo.manager, 'transaction').mockImplementationOnce(((run: never) =>
      real(async (manager: never) => {
        await (run as (m: never) => Promise<unknown>)(manager);
        throw new Error('disk full');
      })) as never);
    await expect(
      kit.occurrenceEdit.edit(s.id, kit.user.id, {
        occurrenceStart: kit.at('2026-11-06', '10:00').toISOString(),
        name: 'Lost',
      } as never),
    ).rejects.toThrow('disk full');
    const after = await kit.reload(s.id);
    expect(after.skippedOccurrenceYmds ?? []).toEqual([]);
    expect(await days(s.id)).toHaveLength(5);
    expect((await kit.taskRepo.find()).filter((row) => row.name === 'Lost')).toHaveLength(0);
  });

  it('repeat off is one transaction: the kept day and the removed days commit together', async () => {
    const s = await series();
    await kit.tasksService.update(s.id, kit.user.id, {
      isRecurring: false,
      recurrencePattern: null,
      recurrenceWeekDays: [],
    } as never);
    await kit.jobs.settle();
    expect(await kit.slotsOf(s.id)).toEqual(['2026-11-05 10:00-11:00']);
    expect((await kit.reload(s.id)).isRecurring).toBe(false);
  });
});
