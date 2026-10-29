/**
 * Stabilization A on a real Postgres (claim SQL, quoted camelCase columns,
 * concurrent workers). Runs only with PG_TEST_URL and DATABASE_URL set to the same URL (entity column types follow DATABASE_URL) (see user-lock.pg.spec.ts).
 */
import { join } from 'path';
import { DataSource } from 'typeorm';
import { Logger } from '@nestjs/common';
import { ScheduleJob } from './entities/schedule-job.entity';
import { ScheduleJobService } from './schedule-job.service';

const url = process.env.PG_TEST_URL;
const describePg = url ? describe : describe.skip;

describePg('durable mutation jobs on Postgres', () => {
  let ds: DataSource;
  let a: ScheduleJobService;
  let b: ScheduleJobService;
  const runs: string[] = [];

  beforeAll(async () => {
    Logger.overrideLogger(['error']);
    ds = await new DataSource({
      type: 'postgres',
      url,
      synchronize: true,
      dropSchema: true,
      entities: [join(__dirname, '..', '**', '*.entity.{ts,js}').replace(/\\/g, '/')],
    }).initialize();
    // Two services on two pools stand for two backend instances.
    const make = () =>
      new ScheduleJobService(ds.getRepository(ScheduleJob), {} as never, {} as never, {} as never);
    a = make();
    b = make();
    for (const service of [a, b]) {
      service.registerHandler('probe', async (job) => {
        runs.push(job.id);
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { ok: true };
      });
    }
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  it('claims each due job exactly once across two concurrent sweeps', async () => {
    const jobs = await Promise.all(
      [1, 2, 3, 4].map(() =>
        a.beginMutationJob('00000000-0000-4000-8000-000000000001', { op: 'probe' }),
      ),
    );
    await Promise.all([a.processDue(), b.processDue(), a.processDue(), b.processDue()]);
    expect([...runs].sort()).toEqual(jobs.map((job) => job.id).sort());
    const rows = await ds.getRepository(ScheduleJob).find();
    expect(rows.every((row) => row.status === 'done' && row.attempts === 1)).toBe(true);
  });

  it('takes over a running job whose lease expired', async () => {
    const job = await a.beginMutationJob('00000000-0000-4000-8000-000000000001', { op: 'probe' });
    await ds.getRepository(ScheduleJob).update(
      { id: job.id },
      { status: 'running', attempts: 1, leaseUntil: new Date(Date.now() - 1000) },
    );
    expect(await b.processDue()).toBe(1);
    expect(await ds.getRepository(ScheduleJob).findOneByOrFail({ id: job.id })).toMatchObject({
      status: 'done',
      attempts: 2,
    });
  });
});
