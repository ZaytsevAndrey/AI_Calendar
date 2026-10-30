import { DataSource, DataSourceOptions, Migration } from 'typeorm';
import { withPgAdvisoryLock } from '../modules/schedule/user-lock';

/**
 * AUD-026: instances booting at once on a database with pending migrations
 * ran them side by side (an empty database: all but one crashed on duplicate
 * tables). One session advisory lock serializes boots; the next instance
 * finds everything applied. A crashed holder's lock dies with its connection.
 * The wait is unbounded: a boot has nothing better to do.
 */
export const MIGRATION_LOCK_KEY = 'luefy:migrations';

export function withMigrationLock<T>(ds: DataSource, run: () => Promise<T>): Promise<T> {
  if (ds.options.type !== 'postgres') return run();
  return withPgAdvisoryLock(ds, MIGRATION_LOCK_KEY, run, null);
}

/** Pending migrations; the caller holds the migration lock (it is per session, not reentrant across connections). */
export function runPendingMigrations(ds: DataSource): Promise<Migration[]> {
  return ds.runMigrations({ transaction: ds.options.migrationsTransactionMode ?? 'all' });
}

/** Pending migrations, under the migration lock (Postgres) — the boot path. */
export function runMigrationsLocked(ds: DataSource): Promise<Migration[]> {
  return withMigrationLock(ds, () => runPendingMigrations(ds));
}

/**
 * The app's DataSource: TypeORM's own \`migrationsRun\` is replaced by
 * \`runMigrationsLocked\` after the connection is up.
 */
export async function initializeDataSource(options: DataSourceOptions): Promise<DataSource> {
  const ds = await new DataSource({ ...options, migrationsRun: false } as DataSourceOptions).initialize();
  if (options.migrationsRun) await runMigrationsLocked(ds);
  return ds;
}
