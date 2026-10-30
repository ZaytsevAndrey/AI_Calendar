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
  const existing = await repo.findOne({ where });
  if (existing) {
    const patch: Partial<PendingGoogleWrite> = {
      revision: (existing.revision ?? 0) + 1,
      enqueuedAt: now,
      lastError: intent.error ?? existing.lastError,
      googleEventId: intent.googleEventId ?? existing.googleEventId,
      googleCalendarId: intent.googleCalendarId ?? existing.googleCalendarId,
    };
    if (existing.status !== 'running') {
      Object.assign(patch, { status: 'pending', nextRunAt: dueAt, leaseUntil: null });
      if (existing.status === 'failed') patch.attempts = 0;
    }
    await repo.update({ id: existing.id }, patch);
    return { id: existing.id, revision: patch.revision! };
  }
  const id = randomUUID();
  // insert, not save: no nested transaction of its own.
  await repo.insert({
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
  });
  return { id, revision: 0 };
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
