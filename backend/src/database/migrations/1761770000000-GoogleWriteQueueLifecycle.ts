import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Google write queue lifecycle (stabilization, Oct 2026). Idempotent, like
 * the previous migration.
 *
 * - pending_google_writes.status / nextRunAt / leaseUntil / revision + index:
 *   claimed with a lease, bounded retries with backoff, terminal `failed`.
 *   Existing rows become `pending` and due now.
 * - tasks.googleInsertEventId: the event id a Google insert is sent with, so
 *   a retry after an unknown outcome cannot create a second event.
 */
export class GoogleWriteQueueLifecycle1761770000000 implements MigrationInterface {
  name = 'GoogleWriteQueueLifecycle1761770000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "googleInsertEventId" character varying(64)`,
    );
    await queryRunner.query(
      `ALTER TABLE "pending_google_writes" ADD COLUMN IF NOT EXISTS "status" character varying(16) NOT NULL DEFAULT 'pending'`,
    );
    await queryRunner.query(
      `ALTER TABLE "pending_google_writes" ADD COLUMN IF NOT EXISTS "nextRunAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "pending_google_writes" ADD COLUMN IF NOT EXISTS "leaseUntil" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "pending_google_writes" ADD COLUMN IF NOT EXISTS "revision" integer NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_pending_google_writes_status_next_run" ON "pending_google_writes" ("status", "nextRunAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_pending_google_writes_status_next_run"`);
    await queryRunner.query(`ALTER TABLE "pending_google_writes" DROP COLUMN IF EXISTS "revision"`);
    await queryRunner.query(`ALTER TABLE "pending_google_writes" DROP COLUMN IF EXISTS "leaseUntil"`);
    await queryRunner.query(`ALTER TABLE "pending_google_writes" DROP COLUMN IF EXISTS "nextRunAt"`);
    await queryRunner.query(`ALTER TABLE "pending_google_writes" DROP COLUMN IF EXISTS "status"`);
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "googleInsertEventId"`);
  }
}
