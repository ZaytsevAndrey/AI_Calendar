/**
 * Stabilization G on a real Postgres: versioned migrations produce exactly the
 * entity schema, from an empty database and from a database made by the old
 * TYPEORM_SYNC (before the Oct 2026 columns), and they are idempotent.
 * Runs only with PG_TEST_URL and DATABASE_URL set to the same URL.
 */
import { randomUUID } from 'crypto';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { DataSourceOptions } from 'typeorm';
import { createTypeOrmOptions, migrationGlob } from './typeorm.config';
import { initializeDataSource } from './migration-lock';
import { migrateLegacyScheduleState } from './migrate-schedule-state';

const url = process.env.PG_TEST_URL;
const describePg = url ? describe : describe.skip;
const entities = [join(__dirname, '..', 'modules', '**', '*.entity.{ts,js}').replace(/\\/g, '/')];

describePg('versioned migrations (Postgres)', () => {
  // Building the whole schema takes several seconds on a cold database.
  jest.setTimeout(60_000);
  let admin: DataSource;
  const created: string[] = [];

  beforeAll(async () => {
    admin = await new DataSource({ type: 'postgres', url }).initialize();
  });

  afterAll(async () => {
    for (const name of created) {
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    }
    await admin?.destroy();
  });

  async function freshDatabase(): Promise<string> {
    const name = `luefy_mig_${randomUUID().slice(0, 8)}`;
    await admin.query(`CREATE DATABASE "${name}"`);
    created.push(name);
    const target = new URL(url!);
    target.pathname = `/${name}`;
    return target.toString();
  }

  const open = (dbUrl: string, extra: Record<string, unknown> = {}) =>
    new DataSource({ type: 'postgres', url: dbUrl, entities, migrations: [migrationGlob], ...extra }).initialize();

  /** Queries synchronize would still need: empty means the schema matches the entities. */
  async function drift(ds: DataSource): Promise<string[]> {
    const sql = await ds.driver.createSchemaBuilder().log();
    return sql.upQueries.map((query) => query.query);
  }

  it('builds the entity schema on an empty database, and a second run changes nothing', async () => {
    const ds = await open(await freshDatabase());
    const first = await ds.runMigrations();
    expect(first.map((m) => m.name)).toEqual([
      'Baseline1761750000000',
      'SchedulingQueueAndOccurrenceIdentity1761760000000',
      'GoogleWriteQueueLifecycle1761770000000',
      'CreateRequestIdempotency1761780000000',
      'GoogleWriteQueueUniqueness1761790000000',
      'AdminConsoleSchema1761800000000',
    ]);
    expect(await drift(ds)).toEqual([]);
    expect(await ds.runMigrations()).toEqual([]);
    await ds.destroy();
  });

  it('upgrades a database made by the old TYPEORM_SYNC and keeps its data', async () => {
    const dbUrl = await freshDatabase();
    // The production shape before these branches: synchronize, then without the new columns.
    const old = await open(dbUrl, { synchronize: true });
    await old.query(`DROP INDEX "IDX_schedule_jobs_status_next_run"`);
    await old.query(`ALTER TABLE "schedule_jobs" DROP COLUMN "attempts", DROP COLUMN "nextRunAt", DROP COLUMN "leaseUntil"`);
    await old.query(`ALTER TABLE "tasks" DROP COLUMN "originalOccurrenceYmd", DROP COLUMN "googleInsertEventId"`);
    await old.query(`DROP TABLE "request_idempotency"`);
    await old.query(`DROP INDEX "IDX_pending_google_writes_user_task_upsert"`);
    await old.query(`DROP INDEX "IDX_pending_google_writes_user_event_delete"`);
    await old.query(`DROP INDEX "IDX_pending_google_writes_status_next_run"`);
    await old.query(
      `ALTER TABLE "pending_google_writes" DROP COLUMN "status", DROP COLUMN "nextRunAt", DROP COLUMN "leaseUntil", DROP COLUMN "revision"`,
    );
    const [user] = await old.query(
      `INSERT INTO "user" ("email", "password") VALUES ('old@example.com', 'x') RETURNING id`,
    );
    const [series] = await old.query(
      `INSERT INTO "tasks" ("name", "userId", "eventType", "estimatedTimeInMinutes", "isRecurring")
       VALUES ('Series', $1, 'admin', 30, true) RETURNING id`,
      [user.id],
    );
    await old.query(
      `INSERT INTO "tasks" ("name", "userId", "eventType", "estimatedTimeInMinutes", "isRecurring", "parentSeriesId", "problematicDay", "scheduleState")
       VALUES ('Parked copy', $1, 'admin', 30, false, $2, '2026-11-06', 'problematic'),
              ('Seated copy', $1, 'admin', 30, false, NULL, NULL, 'none')`,
      [user.id, series.id],
    );
    await old.query(
      `INSERT INTO "schedule_jobs" ("userId", "status", "progressStage", "payloadJson")
       VALUES ($1, 'running', 'placing', '{"type":"task_mutation","op":"create"}')`,
      [user.id],
    );
    await old.query(
      // Two rows for the same event: the old code could insert duplicates (AUD-011).
      `INSERT INTO "pending_google_writes" ("userId", "operation", "googleEventId", "attempts", "enqueuedAt")
       VALUES ($1, 'delete', 'g-old', 1, now() - interval '1 hour'), ($1, 'delete', 'g-old', 4, now())`,
      [user.id],
    );
    await old.destroy();

    const ds = await open(dbUrl);
    const ran = await ds.runMigrations();
    // Baseline is recorded, not re-run; the admin tables made by synchronize are kept (IF NOT EXISTS).
    expect(ran).toHaveLength(6);
    expect(await drift(ds)).toEqual([]);
    const copies = await ds.query(
      `SELECT name, "originalOccurrenceYmd" FROM "tasks" WHERE "isRecurring" IS FALSE ORDER BY name`,
    );
    expect(copies).toEqual([
      { name: 'Parked copy', originalOccurrenceYmd: '2026-11-06' },
      { name: 'Seated copy', originalOccurrenceYmd: null },
    ]);
    const [job] = await ds.query(`SELECT status, attempts FROM "schedule_jobs"`);
    expect(job).toEqual({ status: 'failed', attempts: 0 });
    // Duplicates collapse to the latest row; it survives and is due at once.
    expect(await ds.query(`SELECT count(*)::int AS n FROM "pending_google_writes"`)).toEqual([{ n: 1 }]);
    // A queued Google write survives and is due at once.
    const [write] = await ds.query(
      `SELECT "googleEventId", attempts, status, "nextRunAt", revision FROM "pending_google_writes"`,
    );
    expect(write).toEqual({ googleEventId: 'g-old', attempts: 4, status: 'pending', nextRunAt: null, revision: 0 });
    expect(await ds.query(`SELECT count(*)::int AS n FROM "tasks"`)).toEqual([{ n: 3 }]);
    await ds.destroy();
  });

  it('a half-applied upgrade (interrupted deploy) can run again', async () => {
    const dbUrl = await freshDatabase();
    const old = await open(dbUrl, { synchronize: true });
    await old.query(`ALTER TABLE "schedule_jobs" DROP COLUMN "leaseUntil"`);
    await old.destroy();
    const ds = await open(dbUrl);
    await ds.runMigrations();
    expect(await drift(ds)).toEqual([]);
    await ds.destroy();
  });

  it('AUD-026: three instances booting at once on an empty database all come up; each migration runs once', async () => {
    const env = { DATABASE_URL: await freshDatabase(), DATABASE_SSL: 'false' };
    // The real boot path: the pre-step (migrations + legacy fixes), then the app DataSource.
    const boot = async () => {
      await migrateLegacyScheduleState(env);
      return initializeDataSource(createTypeOrmOptions(env) as DataSourceOptions);
    };
    const sources = await Promise.all([boot(), boot(), boot()]);
    try {
      const rows = await sources[0].query(`SELECT name FROM migrations ORDER BY id`);
      expect(rows).toHaveLength(6);
      expect(await drift(sources[0])).toEqual([]);
    } finally {
      for (const ds of sources) await ds.destroy();
    }
  });
});
