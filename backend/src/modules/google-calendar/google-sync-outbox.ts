import { randomUUID } from 'crypto';
import {
  EntityManager,
  In,
  IsNull,
  Not,
  QueryRunner,
} from 'typeorm';
import { Task } from '../tasks/entities/task.entity';
import { User } from '../users/user.entity';
import {
  PendingGoogleWrite,
  type PendingGoogleWriteOperation,
} from './entities/pending-google-write.entity';

/**
 * Transactional outbox for Google Calendar.
 *
 * Every change to a task or its slots is noted on the transaction that makes
 * it; just before that transaction commits, one `pending_google_writes` row
 * per affected task (upsert) or per removed task's event (delete) is written
 * in the same transaction. Commit and intent are atomic: a rollback drops
 * both, a crash after the commit leaves the intent for the queue. After the
 * commit the rows are handed to the queue to send at once (`kick`); the
 * queue's lease / retry / revision rules apply unchanged. No Google call
 * happens inside a transaction.
 */

/** A row the outbox (or a failed send) asks the queue to perform. */
export type GoogleWriteIntent = {
  userId: string;
  operation: PendingGoogleWriteOperation;
  taskId?: string | null;
  googleEventId?: string | null;
  googleCalendarId?: string | null;
  error?: string | null;
  /** When the queue's own sweep may send it (the kick does not wait). */
  dueAt?: Date;
};

/** Lease the post-commit kick has before the sweep may take the row. */
export const OUTBOX_KICK_GRACE_MS = 2 * 60_000;

export type Collected = {
  /** taskId → userId (null: look it up at flush). */
  upserts: Map<string, string | null>;
  /** Removed tasks: no upsert, their event is deleted instead. */
  removed: Set<string>;
  /** googleEventId → delete intent. */
  deletes: Map<string, GoogleWriteIntent>;
  /** Rows written at the last flush, kicked after the commit. */
  written: string[];
};

export const OUTBOX_KEY = '__googleOutbox';

export function collectedOn(runner: QueryRunner): Collected {
  const data = runner.data as Record<string, unknown>;
  if (!data[OUTBOX_KEY]) {
    data[OUTBOX_KEY] = { upserts: new Map(), removed: new Set(), deletes: new Map(), written: [] };
  }
  return data[OUTBOX_KEY] as Collected;
}

let kick: ((rowIds: string[]) => void) | null = null;

/** The registered post-commit sender, if any. */
export function outboxKick(): ((rowIds: string[]) => void) | null {
  return kick;
}

/** The queue registers how written rows are sent after a commit. */
export function setGoogleOutboxKick(fn: ((rowIds: string[]) => void) | null): void {
  kick = fn;
}

/**
 * Write (or refresh) one queue row inside `manager`'s transaction. Upserts
 * are one row per task, deletes one row per event. A refreshed row gets a new
 * revision, so a worker sending an older revision puts it back afterwards; a
 * failed row gets a fresh set of attempts; `enqueuedAt` becomes "last local
 * change" (a remote edit newer than that wins, older ones are overwritten).
 */
export async function recordGoogleWrite(
  manager: EntityManager,
  intent: GoogleWriteIntent,
): Promise<{ id: string; revision: number }> {
  const repo = manager.getRepository(PendingGoogleWrite);
  const now = new Date();
  const dueAt = intent.dueAt ?? new Date(now.getTime() + OUTBOX_KICK_GRACE_MS);
  const where =
    intent.operation === 'delete'
      ? { userId: intent.userId, operation: intent.operation, googleEventId: intent.googleEventId ?? IsNull() }
      : { userId: intent.userId, operation: intent.operation, taskId: intent.taskId ?? IsNull() };
  // Race-safe (AUD-011): one row per task / event is guaranteed by partial
  // unique indexes, and an existing row is changed by atomic statements that
  // cannot conflict: bump the revision (a worker holding the row sees it and
  // sends again), then reopen it unless a worker holds it, then reset the
  // attempts of a failed one. A row deleted meanwhile (sent) is inserted
  // anew; an insert that loses to another writer is ignored and re-read.
  for (let round = 0; round < 8; round += 1) {
    const existing = await repo.findOne({ where });
    if (existing) {
      const qb = repo.createQueryBuilder();
      const revision = qb.escape('revision');
      const bumped = await qb
        .update(PendingGoogleWrite)
        .set({
          revision: () => `${revision} + 1`,
          enqueuedAt: now,
          ...(intent.error ? { lastError: intent.error } : {}),
          ...(intent.googleEventId ? { googleEventId: intent.googleEventId } : {}),
          ...(intent.googleCalendarId ? { googleCalendarId: intent.googleCalendarId } : {}),
        })
        .where({ id: existing.id })
        .execute();
      if (!bumped.affected) continue; // deleted meanwhile: insert anew
      await repo.update(
        { id: existing.id, status: 'failed' },
        { status: 'pending', attempts: 0, nextRunAt: dueAt, leaseUntil: null },
      );
      await repo.update(
        { id: existing.id, status: 'pending' },
        { nextRunAt: dueAt, leaseUntil: null },
      );
      const after = await repo.findOne({ where: { id: existing.id }, select: { id: true, revision: true } });
      return { id: existing.id, revision: after?.revision ?? existing.revision + 1 };
    }
    const id = randomUUID();
    // ON CONFLICT DO NOTHING: a unique violation would abort the caller's
    // transaction on Postgres. No nested transaction of its own either.
    await repo
      .createQueryBuilder()
      .insert()
      .values({
        id,
        userId: intent.userId,
        operation: intent.operation,
        taskId: intent.taskId ?? null,
        googleEventId: intent.googleEventId ?? null,
        googleCalendarId: intent.googleCalendarId ?? null,
        attempts: 0,
        lastError: intent.error ?? null,
        // App clock, like every later refresh: not the DB default (other clock /
        // zone), which skewed the waited and edited-after checks (H-4).
        enqueuedAt: now,
        status: 'pending',
        nextRunAt: dueAt,
        leaseUntil: null,
        revision: 0,
      })
      .orIgnore()
      .execute();
    if (await repo.findOne({ where: { id }, select: { id: true } })) return { id, revision: 0 };
  }
  throw new Error(`Could not record the Google ${intent.operation} after repeated conflicts`);
}

/** Users with a stored Google grant: only they get queue rows. */
async function usersWithGoogle(manager: EntityManager, userIds: string[]): Promise<Set<string>> {
  if (!userIds.length) return new Set();
  const rows = await manager.getRepository(User).find({
    select: { id: true },
    where: [
      { id: In(userIds), googleAccessToken: Not(IsNull()) },
      { id: In(userIds), googleRefreshToken: Not(IsNull()) },
    ],
  });
  return new Set(rows.map((row) => row.id));
}

export async function flush(manager: EntityManager, collected: Collected): Promise<string[]> {
  const pendingUserLookup = [...collected.upserts.entries()]
    .filter(([taskId, userId]) => !userId && !collected.removed.has(taskId))
    .map(([taskId]) => taskId);
  if (pendingUserLookup.length) {
    const owners = await manager.getRepository(Task).find({
      select: { id: true, userId: true },
      where: { id: In(pendingUserLookup) },
    });
    for (const row of owners) collected.upserts.set(row.id, row.userId);
  }
  const upserts = [...collected.upserts.entries()].filter(
    (entry): entry is [string, string] => !!entry[1] && !collected.removed.has(entry[0]),
  );
  const deletes = [...collected.deletes.values()];
  const linked = await usersWithGoogle(manager, [
    ...new Set([...upserts.map(([, userId]) => userId), ...deletes.map((d) => d.userId)]),
  ]);
  const written: string[] = [];
  if (collected.removed.size) {
    // A removed task needs no upsert any more (its event has a delete row).
    await manager.getRepository(PendingGoogleWrite).delete({
      operation: 'upsert',
      taskId: In([...collected.removed]),
      status: Not('running'),
    });
  }
  for (const [taskId, userId] of upserts) {
    if (!linked.has(userId)) continue;
    written.push((await recordGoogleWrite(manager, { userId, operation: 'upsert', taskId })).id);
  }
  for (const intent of deletes) {
    if (!linked.has(intent.userId)) continue;
    written.push((await recordGoogleWrite(manager, intent)).id);
  }
  collected.upserts.clear();
  collected.removed.clear();
  collected.deletes.clear();
  return written;
}

/** After a write outside any transaction: record at once, then send. */
export async function flushNow(runner: QueryRunner): Promise<void> {
  const written = await flush(runner.manager, collectedOn(runner));
  if (written.length && kick) kick(written);
}

/**
 * Note a task whose Google event must follow a change made with `manager`
 * where the subscriber cannot see the task (criteria `update` / `delete`).
 */
export async function noteGoogleSync(
  manager: EntityManager,
  taskId: string,
  userId: string | null = null,
): Promise<void> {
  const runner = manager.queryRunner;
  if (!runner) {
    const intents = await flush(manager, {
      upserts: new Map([[taskId, userId]]),
      removed: new Set(),
      deletes: new Map(),
      written: [],
    });
    if (intents.length && kick) kick(intents);
    return;
  }
  collectedOn(runner).upserts.set(taskId, userId ?? collectedOn(runner).upserts.get(taskId) ?? null);
  if (!runner.isTransactionActive) await flushNow(runner);
}
