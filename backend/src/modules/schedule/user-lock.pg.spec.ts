/**
 * Stabilization B on a real Postgres. Runs only with PG_TEST_URL and DATABASE_URL set to the same URL (entity column types follow DATABASE_URL), e.g.
 *   docker run -d --name luefy-pg-test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=luefy -p 55432:5432 postgres:16-alpine
 *   PG_TEST_URL=postgres://postgres:test@localhost:55432/luefy DATABASE_URL=$PG_TEST_URL npx jest ".pg.spec"
 * Two DataSources stand for two backend instances.
 */
import { DataSource } from 'typeorm';
import { withPgAdvisoryLock } from './user-lock';

const url = process.env.PG_TEST_URL;
const describePg = url ? describe : describe.skip;

describePg('Postgres advisory user lock (two instances)', () => {
  let a: DataSource;
  let b: DataSource;

  beforeAll(async () => {
    a = await new DataSource({ type: 'postgres', url, extra: { max: 4 } }).initialize();
    b = await new DataSource({ type: 'postgres', url, extra: { max: 4 } }).initialize();
  });

  afterAll(async () => {
    await a?.destroy();
    await b?.destroy();
  });

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it('serializes the same user across instances', async () => {
    const order: string[] = [];
    const first = withPgAdvisoryLock(a, 'luefy:user:u1', async () => {
      order.push('a-start');
      await sleep(300);
      order.push('a-end');
    });
    await sleep(50);
    const second = withPgAdvisoryLock(b, 'luefy:user:u1', async () => {
      order.push('b-start');
      order.push('b-end');
    });
    await Promise.all([first, second]);
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });

  it('does not block different users', async () => {
    const order: string[] = [];
    const first = withPgAdvisoryLock(a, 'luefy:user:u1', async () => {
      order.push('u1-start');
      await sleep(300);
      order.push('u1-end');
    });
    await sleep(50);
    await withPgAdvisoryLock(b, 'luefy:user:u2', async () => {
      order.push('u2');
    });
    await first;
    expect(order).toEqual(['u1-start', 'u2', 'u1-end']);
  });

  it('a crashed holder releases the lock with its connection', async () => {
    const dying = await new DataSource({ type: 'postgres', url, extra: { max: 1 } }).initialize();
    const runner = dying.createQueryRunner();
    await runner.connect();
    await runner.query(`SELECT pg_advisory_lock(hashtext($1))`, ['luefy:user:u3']);
    // The process dies: its connection closes without unlocking.
    await dying.destroy();
    const started = Date.now();
    await withPgAdvisoryLock(b, 'luefy:user:u3', async () => undefined);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('releases the lock when the locked work throws', async () => {
    await expect(
      withPgAdvisoryLock(a, 'luefy:user:u4', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const started = Date.now();
    await withPgAdvisoryLock(b, 'luefy:user:u4', async () => undefined);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  const tryLock = async (source: DataSource, key: string) => {
    const [row] = await source.query(`SELECT pg_try_advisory_lock(hashtext($1)) AS ok`, [key]);
    if (row.ok) await source.query(`SELECT pg_advisory_unlock(hashtext($1))`, [key]);
    return row.ok as boolean;
  };

  it('AUD-020: a lock wait gives up after the timeout instead of waiting forever', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const holder = withPgAdvisoryLock(a, 'luefy:user:u5', () => held);
    await sleep(50);
    const started = Date.now();
    try {
      await expect(withPgAdvisoryLock(b, 'luefy:user:u5', async () => undefined, 300)).rejects.toThrow(/lock timeout/i);
      expect(Date.now() - started).toBeLessThan(2000);
    } finally {
      release();
      await holder;
    }
    // The pool's connections carry no leftover timeout: a later wait still works.
    await withPgAdvisoryLock(b, 'luefy:user:u5', async () => undefined);
  });

  it('AUD-020: a connection whose unlock failed is closed, not returned to the pool holding the lock', async () => {
    const single = await new DataSource({ type: 'postgres', url, extra: { max: 1 } }).initialize();
    const create = single.createQueryRunner.bind(single);
    jest.spyOn(single, 'createQueryRunner').mockImplementationOnce((...args) => {
      const runner = create(...args);
      const query = runner.query.bind(runner);
      jest.spyOn(runner, 'query').mockImplementation((sql: string, params?: unknown[]) =>
        sql.includes('pg_advisory_unlock') ? Promise.reject(new Error('connection reset')) : query(sql, params),
      );
      return runner;
    });
    try {
      await withPgAdvisoryLock(single, 'luefy:user:u6', async () => undefined);
      expect(await tryLock(b, 'luefy:user:u6')).toBe(true);
    } finally {
      await single.destroy();
    }
  });
});
