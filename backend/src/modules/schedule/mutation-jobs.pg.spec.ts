/**
 * Stabilization A on a real Postgres (claim SQL, quoted camelCase columns,
 * concurrent workers). Runs only with PG_TEST_URL and DATABASE_URL set to the same URL (entity column types follow DATABASE_URL) (see user-lock.pg.spec.ts).
 */
import { randomUUID } from 'crypto';
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

/**
 * AUD-007 on Postgres with two independent connections (two "instances"):
 * a slow live worker keeps its lease (heartbeat); a worker whose lease was
 * taken over cannot overwrite the newer outcome (fencing on the claim).
 */
describePg('mutation job leases on Postgres (AUD-007)', () => {
  jest.setTimeout(60_000);
  let admin: DataSource;
  let one: DataSource;
  let two: DataSource;
  let name: string;

  beforeAll(async () => {
    Logger.overrideLogger(['error']);
    admin = await new DataSource({ type: 'postgres', url }).initialize();
    name = `luefy_lease_${randomUUID().slice(0, 8)}`;
    await admin.query(`CREATE DATABASE "${name}"`);
    const target = new URL(url!);
    target.pathname = `/${name}`;
    const entities = [join(__dirname, '..', '**', '*.entity.{ts,js}').split('\\').join('/')];
    one = await new DataSource({ type: 'postgres', url: target.toString(), entities, synchronize: true }).initialize();
    two = await new DataSource({ type: 'postgres', url: target.toString(), entities }).initialize();
  });

  afterAll(async () => {
    await one?.destroy();
    await two?.destroy();
    await admin?.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin?.destroy();
  });

  const serviceOn = (ds: DataSource) => {
    const service = new ScheduleJobService(ds.getRepository(ScheduleJob), {} as never, {} as never, {} as never);
    (service as unknown as { leaseMs: number }).leaseMs = 400;
    return service;
  };
  const user = '00000000-0000-4000-8000-000000000002';

  it('a slow handler keeps its lease: the other instance never runs it twice', async () => {
    const runs: string[] = [];
    const a = serviceOn(one);
    const b = serviceOn(two);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    a.registerHandler('slow', async () => {
      runs.push('a');
      await gate;
    });
    b.registerHandler('slow', async () => {
      runs.push('b');
    });
    const job = await a.beginMutationJob(user, { op: 'slow' });
    const running = a.runNow(job.id);
    try {
      // Three lease lengths pass while A works; B sweeps all the time.
      for (let i = 0; i < 12; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        await b.processDue();
      }
    } finally {
      release();
      await running;
    }
    expect(runs).toEqual(['a']);
    expect(await one.getRepository(ScheduleJob).findOneByOrFail({ id: job.id })).toMatchObject({
      status: 'done',
      attempts: 1,
    });
  });

  it('a worker whose lease was taken over cannot undo the newer outcome', async () => {
    const a = serviceOn(one);
    // A stalls: its next heartbeat is seconds away when its lease is taken over.
    (a as unknown as { leaseMs: number }).leaseMs = 10_000;
    const b = serviceOn(two);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    a.registerHandler('flaky', async () => {
      await gate;
      throw new Error('Google 503'); // A finally fails, long after losing its claim.
    });
    b.registerHandler('flaky', async () => ({ ok: true }));
    const job = await a.beginMutationJob(user, { op: 'flaky' });
    const running = a.runNow(job.id);
    await new Promise((resolve) => setTimeout(resolve, 100));
    // A's process stalls (no heartbeat reaches the DB) and its lease runs out.
    await one.getRepository(ScheduleJob).update({ id: job.id }, { leaseUntil: new Date(Date.now() - 1000) });
    try {
      expect(await b.processDue()).toBe(1);
    } finally {
      release();
      await running;
    }
    expect(await one.getRepository(ScheduleJob).findOneByOrFail({ id: job.id })).toMatchObject({
      status: 'done',
      attempts: 2,
    });
  });
});
