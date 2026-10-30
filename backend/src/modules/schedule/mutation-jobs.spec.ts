/**
 * Stabilization A: placement work is durable. Real TasksService +
 * ScheduleJobService + PlacementStepService on in-memory SQLite.
 */
import { BadRequestException } from '@nestjs/common';
import { ScheduleJob } from './entities/schedule-job.entity';
import { MUTATION_LEASE_MS, MUTATION_MAX_ATTEMPTS } from './schedule-job.service';
import { createPlacementKit, type PlacementKit } from '../../../test/helpers/placement-sqlite.kit';

describe('durable mutation jobs', () => {
  let kit: PlacementKit;
  const NOW = '2026-11-05T08:00:00.000Z';

  beforeEach(async () => {
    kit = await createPlacementKit({ now: NOW });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await kit.destroy();
  });

  const jobRepo = () => kit.ds.getRepository(ScheduleJob);
  const createFlexible = (name = 'Write report') =>
    kit.tasksService.create(kit.user.id, {
      name,
      estimatedTimeInMinutes: 60,
      timeZone: 'UTC',
      priority: 'medium',
      allowSplit: false,
    } as never);
  /** Simulate a process that dies right after the commit: the fast path never runs. */
  const dieAfterCommit = () =>
    jest.spyOn(kit.jobs, 'runNow').mockImplementation(async () => undefined);

  it('AUD-025: finished jobs past the retention window are purged; recent and open ones stay', async () => {
    const repo = kit.ds.getRepository(ScheduleJob);
    const job = (status: string) =>
      repo.save({
        userId: kit.user.id,
        status,
        payloadJson: JSON.stringify({ type: 'task_mutation', op: 'probe' }),
      } as never) as unknown as Promise<ScheduleJob>;
    const oldDone = await job('done');
    const oldFailed = await job('failed');
    const recentDone = await job('done');
    const oldPending = await job('pending');
    // updatedAt is maintained by TypeORM on save: set it as a stored value.
    for (const [row, daysAgo] of [[oldDone, 10], [oldFailed, 10], [recentDone, 1], [oldPending, 10]] as const) {
      await repo.query('UPDATE schedule_jobs SET "updatedAt" = ? WHERE id = ?', [
        new Date(Date.now() - daysAgo * 86_400_000).toISOString().replace('T', ' ').slice(0, 23),
        row.id,
      ]);
    }

    expect(await kit.jobs.purgeFinishedJobs()).toBe(2);

    const left = (await repo.find()).map((row) => row.id).sort();
    expect(left).toEqual([recentDone.id, oldPending.id].sort());
  });

  it('a task saved before a crash is still placed by the recovery sweep', async () => {
    dieAfterCommit();
    const created = await createFlexible();
    const job = await jobRepo().findOneByOrFail({ id: created.jobId! });
    expect(job.status).toBe('pending');
    expect(await kit.slotsOf(created.id)).toEqual([]);

    jest.restoreAllMocks();
    expect(await kit.jobs.processDue()).toBe(1);

    expect(await kit.slotsOf(created.id)).toEqual(['2026-11-05 08:00-09:00']);
    expect((await jobRepo().findOneByOrFail({ id: created.jobId! })).status).toBe('done');
  });

  it('a job held by a dead process is taken over after its lease expires, not before', async () => {
    dieAfterCommit();
    const created = await createFlexible();
    // A process claimed it and died mid-run.
    await jobRepo().update(
      { id: created.jobId! },
      { status: 'running', attempts: 1, leaseUntil: new Date(Date.parse(NOW) + MUTATION_LEASE_MS) },
    );
    jest.restoreAllMocks();

    expect(await kit.jobs.processDue()).toBe(0);
    jest.setSystemTime(new Date(Date.parse(NOW) + MUTATION_LEASE_MS + 1000));
    expect(await kit.jobs.processDue()).toBe(1);

    const job = await jobRepo().findOneByOrFail({ id: created.jobId! });
    expect(job.status).toBe('done');
    expect(job.attempts).toBe(2);
    expect(await kit.slotsOf(created.id)).toHaveLength(1);
  });

  it('an infrastructure failure is retried with backoff, then succeeds', async () => {
    jest
      .spyOn(kit.service, 'place')
      .mockRejectedValueOnce(new Error('connection reset'));
    const created = await createFlexible();
    await kit.jobs.settle();

    const retrying = await jobRepo().findOneByOrFail({ id: created.jobId! });
    expect(retrying).toMatchObject({ status: 'pending', attempts: 1, errorMessage: 'connection reset' });
    expect(retrying.nextRunAt!.getTime()).toBeGreaterThan(Date.parse(NOW));
    // Not due yet.
    expect(await kit.jobs.processDue()).toBe(0);

    jest.setSystemTime(retrying.nextRunAt!);
    expect(await kit.jobs.processDue()).toBe(1);
    expect((await jobRepo().findOneByOrFail({ id: created.jobId! })).status).toBe('done');
    expect(await kit.slotsOf(created.id)).toHaveLength(1);
  });

  it('retries are bounded: the job fails visibly after the last attempt', async () => {
    jest.spyOn(kit.service, 'place').mockRejectedValue(new Error('database is down'));
    const created = await createFlexible();
    await kit.jobs.settle();
    for (let attempt = 2; attempt <= MUTATION_MAX_ATTEMPTS; attempt += 1) {
      const job = await jobRepo().findOneByOrFail({ id: created.jobId! });
      jest.setSystemTime(job.nextRunAt!);
      await kit.jobs.processDue();
    }
    const job = await jobRepo().findOneByOrFail({ id: created.jobId! });
    expect(job).toMatchObject({ status: 'failed', attempts: MUTATION_MAX_ATTEMPTS, errorMessage: 'database is down' });
    expect(await kit.jobs.processDue()).toBe(0);
  });

  it('a refusal (4xx) is final, not retried', async () => {
    jest.spyOn(kit.service, 'place').mockRejectedValue(new BadRequestException('That time is already taken.'));
    const created = await createFlexible();
    await kit.jobs.settle();
    const job = await jobRepo().findOneByOrFail({ id: created.jobId! });
    expect(job).toMatchObject({ status: 'failed', attempts: 1 });
  });

  it('the same job is never run twice at once (fast path vs sweep)', async () => {
    dieAfterCommit();
    const created = await createFlexible();
    jest.restoreAllMocks();
    const place = jest.spyOn(kit.service, 'place');

    await Promise.all([kit.jobs.runNow(created.jobId!), kit.jobs.processDue(), kit.jobs.runNow(created.jobId!)]);

    expect(place).toHaveBeenCalledTimes(1);
    expect(await kit.slotsOf(created.id)).toHaveLength(1);
  });

  it('a task deleted before its job ran finishes the job without placing anything', async () => {
    dieAfterCommit();
    const created = await createFlexible();
    await kit.taskRepo.delete({ id: created.id });
    jest.restoreAllMocks();

    await kit.jobs.processDue();

    const job = await jobRepo().findOneByOrFail({ id: created.jobId! });
    expect(job.status).toBe('done');
    expect(JSON.parse(job.resultDiffJson!)).toEqual({ gone: true });
    expect(await kit.slotRepo.count()).toBe(0);
  });

  it('the task and its job commit together: a failed job write leaves no task', async () => {
    kit.jobs.beginMutationJob.mockRejectedValueOnce(new Error('insert failed'));

    await expect(createFlexible('Never saved')).rejects.toThrow('insert failed');

    expect(await kit.taskRepo.count()).toBe(0);
    expect(await jobRepo().count()).toBe(0);
  });

  it('an inline job left running by a dead request is failed, not re-run', async () => {
    const job = await kit.jobs.beginMutationJob(kit.user.id, { op: 'move_series_day', taskId: 'x' }, { inline: true });
    jest.setSystemTime(new Date(Date.parse(NOW) + MUTATION_LEASE_MS + 1000));

    await kit.jobs.processDue();

    const after = await jobRepo().findOneByOrFail({ id: job.id });
    expect(after.status).toBe('failed');
    expect(after.errorMessage).toMatch(/Interrupted/);
  });
});
