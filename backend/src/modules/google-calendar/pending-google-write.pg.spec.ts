/**
 * Google write queue on a real Postgres: two backend instances (separate
 * pools) sweeping at once send each due row exactly once, and a crashed
 * worker's row is taken over after its lease. Own throwaway database, so it
 * can run next to the other .pg specs. Needs PG_TEST_URL and DATABASE_URL
 * set to the same URL (entity column types follow DATABASE_URL).
 */
import { randomUUID } from 'crypto';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { Logger } from '@nestjs/common';
import { PendingGoogleWrite } from './entities/pending-google-write.entity';
import { PendingGoogleWriteService } from './pending-google-write.service';
import { recordGoogleWrite } from './google-sync-outbox';
import { Task } from '../tasks/entities/task.entity';
import { ScheduledTask } from '../schedule/schedule.entity';
import { UserSettings } from '../user-settings/entities/user-settings.entity';

const url = process.env.PG_TEST_URL;
const describePg = url ? describe : describe.skip;
const entities = [join(__dirname, '..', '**', '*.entity.{ts,js}').split('\\').join('/')];

describePg('Google write queue on Postgres', () => {
  jest.setTimeout(60_000);
  let admin: DataSource;
  let one: DataSource;
  let two: DataSource;
  let name: string;
  const sent: string[] = [];
  const google = {
    checkConnection: jest.fn(async (_userId: string) => ({ connected: true })),
    deleteEvent: jest.fn(async (_userId: string, eventId: string) => {
      sent.push(eventId);
      await new Promise((resolve) => setTimeout(resolve, 30));
    }),
  };
  const serviceOn = (ds: DataSource) =>
    new PendingGoogleWriteService(
      ds.getRepository(PendingGoogleWrite),
      ds.getRepository(Task),
      ds.getRepository(ScheduledTask),
      ds.getRepository(UserSettings),
      google as never,
    );

  beforeAll(async () => {
    Logger.overrideLogger(['error']);
    admin = await new DataSource({ type: 'postgres', url }).initialize();
    name = `luefy_gq_${randomUUID().slice(0, 8)}`;
    await admin.query(`CREATE DATABASE "${name}"`);
    const target = new URL(url!);
    target.pathname = `/${name}`;
    one = await new DataSource({ type: 'postgres', url: target.toString(), entities, synchronize: true }).initialize();
    two = await new DataSource({ type: 'postgres', url: target.toString(), entities }).initialize();
  });

  afterAll(async () => {
    await one?.destroy();
    await two?.destroy();
    await admin?.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin?.destroy();
  });

  beforeEach(async () => {
    sent.length = 0;
    await one.getRepository(PendingGoogleWrite).clear();
  });

  it('sends each due row exactly once across concurrent sweeps on two instances', async () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      // tasks.userId is a uuid: the obsolete-delete check filters on it.
      userId: `00000000-0000-4000-8000-00000000000${i % 3}`,
      taskId: null,
      googleEventId: `g-${i}`,
      operation: 'delete' as const,
    }));
    await one.getRepository(PendingGoogleWrite).save(rows as never);
    const a = serviceOn(one);
    const b = serviceOn(two);

    await Promise.all([a.processQueue(), b.processQueue(), a.processQueue(), b.processQueue()]);
    // Anything a sweep skipped while another held it goes on the next pass.
    await Promise.all([a.processQueue(), b.processQueue()]);

    expect([...sent].sort()).toEqual(rows.map((row) => row.googleEventId).sort());
    expect(await one.getRepository(PendingGoogleWrite).count()).toBe(0);
  });

  it('H-4: enqueuedAt round-trips exactly, whatever the Node and database time zones', async () => {
    const before = Date.now();
    const { id } = await recordGoogleWrite(one.manager, {
      userId: '00000000-0000-4000-8000-0000000000cc',
      operation: 'upsert',
      taskId: '00000000-0000-4000-8000-0000000000dd',
    });
    const row = await one.getRepository(PendingGoogleWrite).findOneByOrFail({ id });
    // Node runs in the developer's zone (e.g. +02:00), the database session in UTC.
    expect(Math.abs(new Date(row.enqueuedAt).getTime() - before)).toBeLessThan(5_000);
  });

  it('AUD-005: 120 rows of a disconnected user do not starve a connected user', async () => {
    const gone = '00000000-0000-4000-8000-0000000000aa';
    const live = '00000000-0000-4000-8000-0000000000bb';
    google.checkConnection.mockImplementation(async (userId: string) => ({ connected: userId !== gone }));
    const repo = one.getRepository(PendingGoogleWrite);
    await repo.save(
      Array.from({ length: 120 }, (_, i) => ({
        userId: gone,
        taskId: null,
        googleEventId: `stuck-${i}`,
        operation: 'delete' as const,
      })) as never,
    );
    await repo.save({ userId: live, taskId: null, googleEventId: 'live-retry', operation: 'delete', attempts: 2 } as never);

    expect(await serviceOn(one).processQueue(20)).toBe(1);

    expect(sent).toEqual(['live-retry']);
    const waiting = await repo.findBy({ userId: gone });
    expect(waiting).toHaveLength(120);
    expect(waiting.every((row) => row.attempts === 0 && row.status === 'pending' && row.nextRunAt)).toBe(true);
    google.checkConnection.mockImplementation(async (_userId: string) => ({ connected: true }));
  });

  it('takes over a row left running by a crashed instance once its lease expires', async () => {
    const repo = one.getRepository(PendingGoogleWrite);
    await repo.save({
      userId: '00000000-0000-4000-8000-000000000001',
      taskId: null,
      googleEventId: 'g-crashed',
      operation: 'delete',
      status: 'running',
      attempts: 1,
      leaseUntil: new Date(Date.now() - 1_000),
    } as never);
    await repo.save({
      userId: '00000000-0000-4000-8000-000000000001',
      taskId: null,
      googleEventId: 'g-held',
      operation: 'delete',
      status: 'running',
      attempts: 1,
      leaseUntil: new Date(Date.now() + 60_000),
    } as never);

    await Promise.all([serviceOn(one).processQueue(), serviceOn(two).processQueue()]);

    expect(sent).toEqual(['g-crashed']);
    expect((await repo.findOneByOrFail({ googleEventId: 'g-held' })).status).toBe('running');
  });
});
