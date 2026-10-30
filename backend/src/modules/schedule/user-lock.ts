import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DataSource, DataSourceOptions } from 'typeorm';

/**
 * Per-user serialization of scheduling writes (stabilization B).
 *
 * In one process a promise chain per user queues the work. On Postgres a
 * session advisory lock per user (`pg_advisory_lock(hashtext('luefy:user:'||id))`)
 * also serializes the same user across backend instances. The lock lives on a
 * dedicated small connection pool, so lock holders never starve the pool that
 * the locked work itself uses (no pool deadlock). A lock dies with its
 * connection: a crashed process releases it. SQLite (one process) uses the
 * chain only. Different users never wait for each other beyond the lock pool
 * size.
 */
export type DistributedUserLock = <T>(userId: string, run: () => Promise<T>) => Promise<T>;

let distributed: DistributedUserLock | null = null;
const chains = new Map<string, Promise<unknown>>();

/** Installed by `UserLockService` on Postgres; null = this process is the only writer. */
export function configureDistributedUserLock(lock: DistributedUserLock | null): void {
  distributed = lock;
}

export function withUserLock<T>(userId: string, run: () => Promise<T>): Promise<T> {
  const previous = chains.get(userId) ?? Promise.resolve();
  const locked = () => (distributed ? distributed(userId, run) : run());
  const next = previous.then(locked, locked);
  const tail = next.then(
    () => undefined,
    () => undefined,
  );
  chains.set(userId, tail);
  // Drop the entry once this user's queue is idle so the map does not grow.
  void tail.then(() => {
    if (chains.get(userId) === tail) chains.delete(userId);
  });
  return next;
}

/**
 * AUD-020: how long a request waits for another instance's lock on the same
 * user before failing (Postgres `lock_timeout`, error 55P03). Placement for
 * one user takes seconds; a longer wait means a stuck holder.
 */
export const USER_LOCK_TIMEOUT_MS = 60_000;

/**
 * Session advisory lock on its own connection; released (or dropped with the
 * connection) after `run`. `timeoutMs` null: wait without a bound and leave
 * the session's `lock_timeout` alone (connections of a shared pool).
 */
export async function withPgAdvisoryLock<T>(
  source: DataSource,
  key: string,
  run: () => Promise<T>,
  timeoutMs: number | null = USER_LOCK_TIMEOUT_MS,
): Promise<T> {
  const runner = source.createQueryRunner();
  await runner.connect();
  let broken: Error | undefined;
  try {
    if (timeoutMs !== null) {
      // Session-wide on a pool used only for these locks; set on every take.
      await runner.query(`SELECT set_config('lock_timeout', $1, false)`, [`${Math.max(1, Math.round(timeoutMs))}ms`]);
    }
    await runner.query(`SELECT pg_advisory_lock(hashtext($1))`, [key]);
    try {
      return await run();
    } finally {
      await runner.query(`SELECT pg_advisory_unlock(hashtext($1))`, [key]).catch((err: unknown) => {
        broken = err instanceof Error ? err : new Error(String(err));
      });
    }
  } finally {
    // AUD-020: a connection that may still hold the lock is closed (the lock
    // dies with its session), never handed back to the pool.
    if (broken) {
      await (runner as unknown as { releasePostgresConnection(err: Error): Promise<void> })
        .releasePostgresConnection(broken);
    } else {
      await runner.release();
    }
  }
}

export const USER_LOCK_POOL_SIZE = 4;

@Injectable()
export class UserLockService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UserLockService.name);
  private lockSource: DataSource | null = null;

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    if (this.dataSource.options.type !== 'postgres') return;
    const options = this.dataSource.options as DataSourceOptions & { extra?: Record<string, unknown> };
    this.lockSource = new DataSource({
      ...options,
      entities: [],
      migrations: [],
      subscribers: [],
      synchronize: false,
      migrationsRun: false,
      extra: { ...(options.extra ?? {}), max: USER_LOCK_POOL_SIZE },
    } as DataSourceOptions);
    await this.lockSource.initialize();
    const source = this.lockSource;
    configureDistributedUserLock((userId, run) =>
      withPgAdvisoryLock(source, `luefy:user:${userId}`, run),
    );
    this.logger.log(`Postgres advisory user lock on (pool ${USER_LOCK_POOL_SIZE})`);
  }

  async onModuleDestroy(): Promise<void> {
    configureDistributedUserLock(null);
    if (this.lockSource?.isInitialized) await this.lockSource.destroy();
  }
}
