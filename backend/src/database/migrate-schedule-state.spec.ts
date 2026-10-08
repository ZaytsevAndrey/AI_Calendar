import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { migrateLegacyScheduleState } from './migrate-schedule-state';

async function sqlite(path: string): Promise<DataSource> {
  const ds = new DataSource({
    type: 'sqlite',
    database: path,
    synchronize: false,
    entities: [],
  });
  await ds.initialize();
  return ds;
}

describe('migrateLegacyScheduleState', () => {
  function env(sqlitePath: string): NodeJS.ProcessEnv {
    return {
      ...process.env,
      DATABASE_URL: '',
      SQLITE_PATH: sqlitePath,
    };
  }

  it('copies isProblematic into scheduleState and leaves resolved rows', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sched-state-'));
    const sqlitePath = join(dir, 'db.sqlite');
    const setup = await sqlite(sqlitePath);
    await setup.query(
      `CREATE TABLE tasks (
        id varchar PRIMARY KEY,
        isProblematic boolean NOT NULL DEFAULT 0,
        scheduleState varchar(32) NOT NULL DEFAULT 'none'
      )`,
    );
    await setup.query(
      `INSERT INTO tasks (id, isProblematic, scheduleState) VALUES
        ('parked', 1, 'none'),
        ('open', 0, 'none'),
        ('kept', 1, 'resolved')`,
    );
    await setup.destroy();

    await migrateLegacyScheduleState(env(sqlitePath));
    await migrateLegacyScheduleState(env(sqlitePath));

    const check = await sqlite(sqlitePath);
    const rows = await check.query(
      `SELECT id, scheduleState FROM tasks ORDER BY id`,
    );
    await check.destroy();
    expect(rows).toEqual([
      { id: 'kept', scheduleState: 'resolved' },
      { id: 'open', scheduleState: 'none' },
      { id: 'parked', scheduleState: 'problematic' },
    ]);
  });

  it('adds scheduleState when the legacy table does not have it yet', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sched-state-'));
    const sqlitePath = join(dir, 'db.sqlite');
    const setup = await sqlite(sqlitePath);
    await setup.query(
      `CREATE TABLE tasks (id varchar PRIMARY KEY, isProblematic boolean NOT NULL DEFAULT 0)`,
    );
    await setup.query(
      `INSERT INTO tasks (id, isProblematic) VALUES ('parked', 1)`,
    );
    await setup.destroy();

    await migrateLegacyScheduleState(env(sqlitePath));

    const check = await sqlite(sqlitePath);
    const rows = await check.query(`SELECT id, scheduleState FROM tasks`);
    await check.destroy();
    expect(rows).toEqual([{ id: 'parked', scheduleState: 'problematic' }]);
  });

  it('does nothing when there is no tasks table', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sched-state-'));
    const sqlitePath = join(dir, 'empty.sqlite');
    await expect(
      migrateLegacyScheduleState(env(sqlitePath)),
    ).resolves.toBeUndefined();
  });
});
