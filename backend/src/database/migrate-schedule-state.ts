import { DataSource, DataSourceOptions } from 'typeorm';
import { createTypeOrmOptions } from './typeorm.config';

/**
 * Copy legacy `isProblematic` into `scheduleState` before TypeORM synchronize
 * drops the boolean column. Fresh databases (no `tasks` table) are left alone.
 */
export async function migrateLegacyScheduleState(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const options = createTypeOrmOptions(env) as DataSourceOptions;
  const ds = new DataSource({
    ...options,
    synchronize: false,
    entities: [],
    logging: false,
  });
  await ds.initialize();
  try {
    await copyIsProblematicFlag(ds, options.type === 'postgres');
    await backfillOccurrenceIdentity(ds, options.type === 'postgres');
  } finally {
    await ds.destroy();
  }
}

async function copyIsProblematicFlag(
  ds: DataSource,
  postgres: boolean,
): Promise<void> {
  const columns = await taskColumnNames(ds, postgres);
  if (!columns.has('isProblematic')) return;

  if (!columns.has('scheduleState')) {
    if (postgres) {
      await ds.query(
        `ALTER TABLE tasks ADD COLUMN "scheduleState" character varying(32) NOT NULL DEFAULT 'none'`,
      );
    } else {
      await ds.query(
        `ALTER TABLE tasks ADD COLUMN scheduleState varchar(32) NOT NULL DEFAULT 'none'`,
      );
    }
  }

  const parked = postgres
    ? await ds.query(
        `SELECT COUNT(*) AS n FROM tasks WHERE "isProblematic" IS TRUE AND "scheduleState" = 'none'`,
      )
    : await ds.query(
        `SELECT COUNT(*) AS n FROM tasks WHERE isProblematic != 0 AND scheduleState = 'none'`,
      );
  const changed = Number(parked[0]?.n ?? 0);

  if (postgres) {
    await ds.query(
      `UPDATE tasks SET "scheduleState" = 'problematic' WHERE "isProblematic" IS TRUE AND "scheduleState" = 'none'`,
    );
  } else {
    await ds.query(
      `UPDATE tasks SET scheduleState = 'problematic' WHERE isProblematic != 0 AND scheduleState = 'none'`,
    );
  }

  if (changed > 0) {
    console.log(
      `[migrate] copied isProblematic into scheduleState for ${changed} task(s)`,
    );
  }
}

/**
 * A detached series day copy remembers which occurrence it stands for in
 * `originalOccurrenceYmd`. Copies made before that column existed still carry
 * the day in `problematicDay` while they are parked with `parentSeriesId`:
 * copy it over. Seated copies lost both fields when they were seated; their
 * day is ambiguous and stays null (they simply never re-merge). Idempotent.
 */
async function backfillOccurrenceIdentity(
  ds: DataSource,
  postgres: boolean,
): Promise<void> {
  const columns = await taskColumnNames(ds, postgres);
  if (!columns.size || !columns.has('problematicDay') || !columns.has('parentSeriesId')) {
    return;
  }
  if (!columns.has('originalOccurrenceYmd')) {
    await ds.query(
      postgres
        ? `ALTER TABLE tasks ADD COLUMN "originalOccurrenceYmd" character varying(10)`
        : `ALTER TABLE tasks ADD COLUMN originalOccurrenceYmd varchar(10)`,
    );
  }
  const where = postgres
    ? `"originalOccurrenceYmd" IS NULL AND "isRecurring" IS FALSE AND "parentSeriesId" IS NOT NULL AND "problematicDay" IS NOT NULL`
    : `originalOccurrenceYmd IS NULL AND isRecurring = 0 AND parentSeriesId IS NOT NULL AND problematicDay IS NOT NULL`;
  const due = await ds.query(`SELECT COUNT(*) AS n FROM tasks WHERE ${where}`);
  const changed = Number(due[0]?.n ?? 0);
  if (!changed) return;
  await ds.query(
    postgres
      ? `UPDATE tasks SET "originalOccurrenceYmd" = "problematicDay" WHERE ${where}`
      : `UPDATE tasks SET originalOccurrenceYmd = problematicDay WHERE ${where}`,
  );
  console.log(`[migrate] set originalOccurrenceYmd on ${changed} parked series copy(ies)`);
}

async function taskColumnNames(
  ds: DataSource,
  postgres: boolean,
): Promise<Set<string>> {
  if (postgres) {
    const rows: { name: string }[] = await ds.query(
      `SELECT column_name AS name FROM information_schema.columns WHERE table_name = 'tasks'`,
    );
    return new Set(rows.map((row) => row.name));
  }
  const rows: { name: string }[] = await ds.query(`PRAGMA table_info(tasks)`);
  return new Set(rows.map((row) => row.name));
}
