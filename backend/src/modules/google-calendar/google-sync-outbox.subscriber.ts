import {
  EntitySubscriberInterface,
  EventSubscriber,
  InsertEvent,
  QueryRunner,
  RemoveEvent,
  TransactionCommitEvent,
  TransactionRollbackEvent,
  TransactionStartEvent,
  UpdateEvent,
} from 'typeorm';
import { Task } from '../tasks/entities/task.entity';
import { ScheduledTask } from '../schedule/schedule.entity';
import {
  collectedOn,
  flush,
  flushNow,
  outboxKick,
  OUTBOX_KEY,
  type Collected,
} from './google-sync-outbox';

/** Task columns that never need a Google write (sync bookkeeping). */
const TASK_COLUMNS_WITHOUT_GOOGLE_EFFECT = new Set([
  'googleEventId',
  'googleEventCalendarId',
  'googleInsertEventId',
  'updatedAt',
  'createdAt',
]);
const SLOT_COLUMNS_WITHOUT_GOOGLE_EFFECT = new Set([
  'googleEventId',
  'googleEventCalendarId',
  'updatedAt',
  'createdAt',
]);

/** Per runner: what was collected when each open savepoint began (H-1). */
const SAVEPOINTS_KEY = 'googleOutboxSavepoints';

function copyCollected(collected: Collected): Collected {
  return {
    upserts: new Map(collected.upserts),
    removed: new Set(collected.removed),
    deletes: new Map(collected.deletes),
    written: [...collected.written],
  };
}

function savepointsOn(runner: QueryRunner): Collected[] {
  const data = runner.data as Record<string, unknown>;
  if (!data[SAVEPOINTS_KEY]) data[SAVEPOINTS_KEY] = [];
  return data[SAVEPOINTS_KEY] as Collected[];
}

/**
 * Google outbox subscriber (see google-sync-outbox.ts). Loaded by file glob
 * from the TypeORM options; sees every Task / ScheduledTask write — except a
 * change of only the `phases` link (many-to-many): TypeORM writes the junction
 * rows without an update event of the task (H-5). Code that changes phases
 * without a task column must call `noteGoogleSync`; today every such path
 * also writes `phaseId` or syncs the task explicitly.
 */
// TypeORM registers only decorated subscriber classes.
@EventSubscriber()
export class GoogleSyncOutboxSubscriber implements EntitySubscriberInterface {
  async afterInsert(event: InsertEvent<unknown>): Promise<void> {
    if (event.metadata.target === Task) {
      const task = event.entity as Task;
      if (task?.id) this.noteUpsert(event.queryRunner, task.id, task.userId ?? null);
    } else if (event.metadata.target === ScheduledTask) {
      const slot = event.entity as ScheduledTask;
      if (slot?.taskId) this.noteUpsert(event.queryRunner, slot.taskId, null);
    } else {
      return;
    }
    if (!event.queryRunner.isTransactionActive) await flushNow(event.queryRunner);
  }

  async afterUpdate(event: UpdateEvent<unknown>): Promise<void> {
    const isTask = event.metadata.target === Task;
    if (!isTask && event.metadata.target !== ScheduledTask) return;
    const changed = event.updatedColumns.map((column) => column.propertyName);
    const ignored = isTask ? TASK_COLUMNS_WITHOUT_GOOGLE_EFFECT : SLOT_COLUMNS_WITHOUT_GOOGLE_EFFECT;
    // Bookkeeping only (e.g. the queue linking the event it created): no write.
    if (changed.length && changed.every((name) => ignored.has(name))) return;
    const entity = (event.entity ?? {}) as Partial<Task & ScheduledTask>;
    const before = (event.databaseEntity ?? {}) as Partial<Task & ScheduledTask>;
    if (isTask) {
      const id = entity.id ?? before.id;
      // A criteria update carries no id: those call sites use noteGoogleSync.
      if (!id) return;
      this.noteUpsert(event.queryRunner, id, entity.userId ?? before.userId ?? null);
    } else {
      const taskId = entity.taskId ?? before.taskId;
      if (!taskId) return;
      this.noteUpsert(event.queryRunner, taskId, null);
    }
    if (!event.queryRunner.isTransactionActive) await flushNow(event.queryRunner);
  }

  async afterRemove(event: RemoveEvent<unknown>): Promise<void> {
    const runner = event.queryRunner;
    if (event.metadata.target === Task) {
      const task = { ...(event.databaseEntity ?? {}), ...(event.entity ?? {}) } as Partial<Task>;
      const id = (event.entityId as string | undefined) ?? task.id;
      if (!id) return;
      const collected = collectedOn(runner);
      collected.removed.add(id);
      // AUD-012: an insert whose answer was lost may have created its event
      // under googleInsertEventId; delete that one too (404 if it never landed).
      for (const eventId of [task.googleEventId, task.googleInsertEventId]) {
        if (!eventId || !task.userId) continue;
        collected.deletes.set(eventId, {
          userId: task.userId,
          operation: 'delete',
          taskId: null,
          googleEventId: eventId,
          googleCalendarId: task.googleEventCalendarId ?? null,
        });
      }
    } else if (event.metadata.target === ScheduledTask) {
      const slot = { ...(event.databaseEntity ?? {}), ...(event.entity ?? {}) } as Partial<ScheduledTask>;
      if (slot.taskId) this.noteUpsert(runner, slot.taskId, null);
    } else {
      return;
    }
    if (!runner.isTransactionActive) await flushNow(runner);
  }

  /**
   * H-1: a nested transaction is a savepoint. Remember what was collected
   * before it, so a rollback to it also drops the writes it noted (a removal
   * rolled back must not delete the event of a task that still exists).
   */
  afterTransactionStart(event: TransactionStartEvent): void {
    const runner = event.queryRunner;
    if ((runner as QueryRunner & { transactionDepth?: number }).transactionDepth! <= 1) return;
    savepointsOn(runner).push(copyCollected(collectedOn(runner)));
  }

  async beforeTransactionCommit(event: TransactionCommitEvent): Promise<void> {
    const runner = event.queryRunner;
    // Savepoint release of a nested transaction: wait for the outermost commit.
    if ((runner as QueryRunner & { transactionDepth?: number }).transactionDepth !== 1) return;
    const collected = (runner.data as Record<string, Collected | undefined>)[OUTBOX_KEY];
    if (!collected) return;
    collected.written = await flush(runner.manager, collected);
  }

  afterTransactionCommit(event: TransactionCommitEvent): void {
    const runner = event.queryRunner;
    if (runner.isTransactionActive) {
      // Savepoint released: its notes now belong to the enclosing transaction.
      savepointsOn(runner).pop();
      return;
    }
    delete (runner.data as Record<string, unknown>)[SAVEPOINTS_KEY];
    const collected = (runner.data as Record<string, Collected | undefined>)[OUTBOX_KEY];
    if (!collected?.written.length) return;
    const rows = collected.written;
    collected.written = [];
    outboxKick()?.(rows);
  }

  afterTransactionRollback(event: TransactionRollbackEvent): void {
    const runner = event.queryRunner;
    if (runner.isTransactionActive) {
      // Rolled back to a savepoint: back to what was collected before it.
      const before = savepointsOn(runner).pop();
      if (before) (runner.data as Record<string, unknown>)[OUTBOX_KEY] = before;
      return;
    }
    delete (runner.data as Record<string, unknown>)[OUTBOX_KEY];
    delete (runner.data as Record<string, unknown>)[SAVEPOINTS_KEY];
  }

  private noteUpsert(runner: QueryRunner, taskId: string, userId: string | null): void {
    const collected = collectedOn(runner);
    collected.upserts.set(taskId, userId ?? collected.upserts.get(taskId) ?? null);
  }
}
