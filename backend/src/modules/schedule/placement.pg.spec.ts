/**
 * Placement path on a real Postgres (not mocked repositories): the task+job
 * transaction rolls back as a whole, durable placement recovers after a crash,
 * and concurrent creates never overlap. Needs PG_TEST_URL and DATABASE_URL
 * set to the same URL; each test gets its own throwaway database.
 */
import { ScheduleJob } from './entities/schedule-job.entity';
import { createPlacementKit, type PlacementKit } from '../../../test/helpers/placement-sqlite.kit';

const url = process.env.PG_TEST_URL;
const describePg = url ? describe : describe.skip;

describePg('placement on Postgres', () => {
  jest.setTimeout(60_000);
  let kit: PlacementKit;

  beforeEach(async () => {
    kit = await createPlacementKit({ now: '2026-11-05T08:00:00.000Z', postgresUrl: url });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await kit?.destroy();
  });

  const body = (name: string) =>
    ({ name, estimatedTimeInMinutes: 60, timeZone: 'UTC', priority: 'medium', allowSplit: false }) as never;
  const jobRows = () => kit.ds.getRepository(ScheduleJob).find();

  it('rolls back the task when its job cannot be written (one transaction)', async () => {
    kit.jobs.beginMutationJob.mockRejectedValueOnce(new Error('disk full'));

    await expect(kit.tasksService.create(kit.user.id, body('Lost'))).rejects.toThrow('disk full');

    expect(await kit.taskRepo.count()).toBe(0);
    expect(await jobRows()).toEqual([]);
  });

  it('a task saved just before a crash is placed by the recovery sweep', async () => {
    // The process dies right after the commit: the in-request run never happens.
    jest.spyOn(kit.jobs, 'runNow').mockResolvedValueOnce(undefined as never);
    const task = await kit.tasksService.create(kit.user.id, body('Survivor'));
    expect(await kit.slotsOf(task.id)).toEqual([]);
    expect((await jobRows())[0]).toMatchObject({ status: 'pending', attempts: 0 });

    expect(await kit.jobs.processDue()).toBe(1);

    expect(await kit.slotsOf(task.id)).toHaveLength(1);
    expect((await jobRows())[0]).toMatchObject({ status: 'done', attempts: 1 });
  });

  it('a job left running by a dead worker is taken over after its lease', async () => {
    jest.spyOn(kit.jobs, 'runNow').mockResolvedValueOnce(undefined as never);
    const task = await kit.tasksService.create(kit.user.id, body('Orphan'));
    await kit.ds
      .getRepository(ScheduleJob)
      .update({ id: task.jobId! }, { status: 'running', attempts: 1, leaseUntil: new Date(Date.now() - 1_000) });

    expect(await kit.jobs.processDue()).toBe(1);

    expect(await kit.slotsOf(task.id)).toHaveLength(1);
    expect((await jobRows())[0]).toMatchObject({ status: 'done', attempts: 2 });
  });

  it('concurrent creates for one user are all placed without overlap', async () => {
    const created = await Promise.all(
      ['A', 'B', 'C', 'D', 'E', 'F'].map((name) => kit.tasksService.create(kit.user.id, body(name))),
    );
    await kit.jobs.settle();

    const slots = (await kit.slotRepo.find())
      .map((row) => [new Date(row.scheduledStartTime).getTime(), new Date(row.scheduledEndTime).getTime()])
      .sort((a, b) => a[0] - b[0]);
    expect(slots).toHaveLength(created.length);
    for (let i = 1; i < slots.length; i += 1) {
      expect(slots[i][0]).toBeGreaterThanOrEqual(slots[i - 1][1]);
    }
    expect((await jobRows()).every((job) => job.status === 'done')).toBe(true);
  });
});
