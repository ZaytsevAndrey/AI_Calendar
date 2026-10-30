import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AUD-011: one Google queue row per task (upsert) and per event (delete),
 * guaranteed by partial unique indexes; concurrent writers update the row.
 * Existing duplicates are removed first, keeping the most recently changed
 * row of each group (a queue row means "make Google match the task now",
 * so a duplicate carries no extra intent). Idempotent.
 */
export class GoogleWriteQueueUniqueness1761790000000 implements MigrationInterface {
  name = 'GoogleWriteQueueUniqueness1761790000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "pending_google_writes" a USING "pending_google_writes" b
        WHERE a."operation" = 'upsert' AND b."operation" = 'upsert'
          AND a."userId" = b."userId" AND a."taskId" = b."taskId"
          AND (a."enqueuedAt", a."id") < (b."enqueuedAt", b."id")`,
    );
    await queryRunner.query(
      `DELETE FROM "pending_google_writes" a USING "pending_google_writes" b
        WHERE a."operation" = 'delete' AND b."operation" = 'delete'
          AND a."userId" = b."userId" AND a."googleEventId" = b."googleEventId"
          AND (a."enqueuedAt", a."id") < (b."enqueuedAt", b."id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_pending_google_writes_user_task_upsert" ON "pending_google_writes" ("userId", "taskId") WHERE "operation" = 'upsert'`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_pending_google_writes_user_event_delete" ON "pending_google_writes" ("userId", "googleEventId") WHERE "operation" = 'delete'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_pending_google_writes_user_event_delete"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_pending_google_writes_user_task_upsert"`);
  }
}
