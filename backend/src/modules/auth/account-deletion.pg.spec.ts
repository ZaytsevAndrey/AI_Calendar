/**
 * AUD-004: account deletion on a real Postgres (the production database).
 * Own throwaway database; needs PG_TEST_URL and DATABASE_URL set to the same URL.
 */
import { randomUUID } from 'crypto';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { Logger } from '@nestjs/common';
import { AccountDeletionService } from './account-deletion.service';
import { User } from '../users/user.entity';
import { Task } from '../tasks/entities/task.entity';
import { ScheduledTask } from '../schedule/schedule.entity';
import { Habit } from '../habits/entities/habit.entity';

const url = process.env.PG_TEST_URL;
const describePg = url ? describe : describe.skip;
const entities = [join(__dirname, '..', '**', '*.entity.{ts,js}').split('\\').join('/')];

describePg('account deletion on Postgres', () => {
  jest.setTimeout(60_000);
  let admin: DataSource;
  let ds: DataSource;
  let name: string;

  beforeAll(async () => {
    Logger.overrideLogger(['error']);
    admin = await new DataSource({ type: 'postgres', url }).initialize();
    name = `luefy_del_${randomUUID().slice(0, 8)}`;
    await admin.query(`CREATE DATABASE "${name}"`);
    const target = new URL(url!);
    target.pathname = `/${name}`;
    ds = await new DataSource({ type: 'postgres', url: target.toString(), entities, synchronize: true }).initialize();
  });

  afterAll(async () => {
    await ds?.destroy();
    await admin?.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin?.destroy();
  });

  /** A user with a row in every table that holds user data. */
  async function seedUser(label: string, google: { deleteEvent: jest.Mock }) {
    void google;
    const [user] = await ds.query(
      `INSERT INTO "user" ("email", "password", "googleAccessToken", "googleRefreshToken")
       VALUES ($1, 'x', 'access', 'refresh') RETURNING id`,
      [`${label}-${randomUUID().slice(0, 6)}@example.com`],
    );
    const userId: string = user.id;
    await ds.query(`INSERT INTO "user_settings" ("userId") VALUES ($1)`, [userId]);
    const [phase] = await ds.query(
      `INSERT INTO "phases" ("name", "color", "startTime", "endTime", "userId") VALUES ('Work', '#000', '09:00', '17:00', $1) RETURNING id`,
      [userId],
    );
    const [task] = await ds.query(
      `INSERT INTO "tasks" ("name", "userId", "eventType", "estimatedTimeInMinutes", "phaseId", "googleEventId")
       VALUES ('Task', $1, 'admin', 30, $2, $3) RETURNING id`,
      [userId, phase.id, `evt-${label}`],
    );
    await ds.query(`INSERT INTO "task_phases" ("taskId", "phaseId") VALUES ($1, $2)`, [task.id, phase.id]);
    await ds.query(
      `INSERT INTO "scheduled_tasks" ("taskId", "scheduledStartTime", "scheduledEndTime", "googleEventId")
       VALUES ($1, now(), now() + interval '30 minutes', $2)`,
      [task.id, `evt-${label}`],
    );
    await ds.query(
      `INSERT INTO "day_reminders" ("userId", "name", "dueYmd", "googleEventId") VALUES ($1, 'Call', '2026-11-05', $2)`,
      [userId, `rem-${label}`],
    );
    await ds.query(`INSERT INTO "schedule_jobs" ("userId", "status") VALUES ($1, 'done')`, [userId]);
    await ds.query(
      `INSERT INTO "pending_google_writes" ("userId", "operation", "googleEventId") VALUES ($1, 'delete', 'g-x')`,
      [userId],
    );
    await ds.query(
      `INSERT INTO "request_idempotency" ("userId", "operation", "key", "requestHash") VALUES ($1, 'task.create', 'k', 'h')`,
      [userId],
    );
    return { userId, taskId: task.id as string };
  }

  const userRowCounts = async (userId: string) => {
    const counts: Record<string, number> = {};
    for (const table of [
      'user_settings',
      'phases',
      'tasks',
      'day_reminders',
      'schedule_jobs',
      'pending_google_writes',
      'request_idempotency',
    ]) {
      const [row] = await ds.query(`SELECT count(*)::int AS n FROM "${table}" WHERE "userId" = $1`, [userId]);
      counts[table] = row.n;
    }
    const [user] = await ds.query(`SELECT count(*)::int AS n FROM "user" WHERE id = $1`, [userId]);
    counts.user = user.n;
    return counts;
  };

  function serviceWith(google: Record<string, jest.Mock>) {
    return new AccountDeletionService(
      ds.getRepository(User),
      ds.getRepository(Task),
      ds.getRepository(ScheduledTask),
      ds.getRepository(Habit),
      google as never,
      ds,
    );
  }

  it('removes every row of the user (and only theirs), and their Google events including reminders', async () => {
    const google = {
      deleteEvent: jest.fn().mockResolvedValue(undefined),
      deleteAppCalendar: jest.fn().mockResolvedValue(undefined),
    };
    const victim = await seedUser('victim', google);
    const other = await seedUser('other', google);

    await serviceWith(google).deleteAccount(victim.userId, 'DELETE');

    const left = await userRowCounts(victim.userId);
    expect(Object.values(left).every((n) => n === 0)).toBe(true);
    const [{ n: slots }] = await ds.query(`SELECT count(*)::int AS n FROM "scheduled_tasks" WHERE "taskId" = $1`, [
      victim.taskId,
    ]);
    expect(slots).toBe(0);
    const [{ n: links }] = await ds.query(`SELECT count(*)::int AS n FROM "task_phases" WHERE "taskId" = $1`, [
      victim.taskId,
    ]);
    expect(links).toBe(0);
    expect(Object.values(await userRowCounts(other.userId)).every((n) => n >= 1)).toBe(true);
    const deleted = google.deleteEvent.mock.calls.map(([, eventId]) => eventId);
    expect(deleted).toEqual(expect.arrayContaining(['evt-victim', 'rem-victim']));
  });

  it('a Google failure stops before anything local is deleted, and a retry completes', async () => {
    const google = {
      deleteEvent: jest.fn().mockRejectedValueOnce(new Error('Google 503')).mockResolvedValue(undefined),
      deleteAppCalendar: jest.fn().mockResolvedValue(undefined),
    };
    const user = await seedUser('retry', google);
    const service = serviceWith(google);

    await expect(service.deleteAccount(user.userId, 'DELETE')).rejects.toBeTruthy();
    expect((await userRowCounts(user.userId)).user).toBe(1);
    expect((await userRowCounts(user.userId)).tasks).toBe(1);

    await service.deleteAccount(user.userId, 'DELETE');
    expect(Object.values(await userRowCounts(user.userId)).every((n) => n === 0)).toBe(true);
  });
});
