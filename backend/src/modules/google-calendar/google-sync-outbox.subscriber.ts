import {
  EntitySubscriberInterface,
  EventSubscriber,
  InsertEvent,
  QueryRunner,
  RemoveEvent,
  TransactionCommitEvent,
  TransactionRollbackEvent,
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

/**
 * Google outbox subscriber (see google-sync-outbox.ts). Loaded by file glob
 * from the TypeORM options; sees every Task / ScheduledTask write.
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
      if (task.googleEventId && task.userId) {
        collected.deletes.set(task.googleEventId, {
          userId: task.userId,
          operation: 'delete',
          taskId: null,
          googleEventId: task.googleEventId,
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
    if (runner.isTransactionActive) return;
    const collected = (runner.data as Record<string, Collected | undefined>)[OUTBOX_KEY];
    if (!collected?.written.length) return;
    const rows = collected.written;
    collected.written = [];
    outboxKick()?.(rows);
  }

  afterTransactionRollback(event: TransactionRollbackEvent): void {
    const runner = event.queryRunner;
    if (runner.isTransactionActive) return;
    delete (runner.data as Record<string, unknown>)[OUTBOX_KEY];
  }

  private noteUpsert(runner: QueryRunner, taskId: string, userId: string | null): void {
    const collected = collectedOn(runner);
    collected.upserts.set(taskId, userId ?? collected.upserts.get(taskId) ?? null);
  }
}
