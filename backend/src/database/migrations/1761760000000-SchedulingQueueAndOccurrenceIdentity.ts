import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Columns added by the scheduling refactor and stabilization (Oct 2026), for
 * a database whose schema came from TYPEORM_SYNC before these branches.
 * Every statement is idempotent: on a fresh database the baseline already
 * created them and this is a no-op; a deploy interrupted half-way can rerun.
 *
 * - tasks.originalOccurrenceYmd — which series day a detached copy stands for.
 * - schedule_jobs.attempts / nextRunAt / leaseUntil + index — durable job queue.
 * - Backfill: a parked series copy carries its day in problematicDay; copy it.
 *   Seated copies lost that day earlier and stay null (ambiguous, never guessed).
 */
export class SchedulingQueueAndOccurrenceIdentity1761760000000 implements MigrationInterface {
  name = 'SchedulingQueueAndOccurrenceIdentity1761760000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "originalOccurrenceYmd" character varying(10)`,
    );
    await queryRunner.query(
      `ALTER TABLE "schedule_jobs" ADD COLUMN IF NOT EXISTS "attempts" integer NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "schedule_jobs" ADD COLUMN IF NOT EXISTS "nextRunAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "schedule_jobs" ADD COLUMN IF NOT EXISTS "leaseUntil" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_schedule_jobs_status_next_run" ON "schedule_jobs" ("status", "nextRunAt")`,
    );
    await queryRunner.query(
      `UPDATE "tasks" SET "originalOccurrenceYmd" = "problematicDay"
        WHERE "originalOccurrenceYmd" IS NULL AND "isRecurring" IS FALSE
          AND "parentSeriesId" IS NOT NULL AND "problematicDay" IS NOT NULL`,
    );
    // Jobs left "running" by the old in-process runner have no lease and would
    // never finish; mark them failed so they stop showing as in progress.
    await queryRunner.query(
      `UPDATE "schedule_jobs" SET "status" = 'failed', "progressStage" = 'error',
          "errorMessage" = 'Interrupted before the durable queue existed.'
        WHERE "status" = 'running' AND "leaseUntil" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_schedule_jobs_status_next_run"`);
    await queryRunner.query(`ALTER TABLE "schedule_jobs" DROP COLUMN IF EXISTS "leaseUntil"`);
    await queryRunner.query(`ALTER TABLE "schedule_jobs" DROP COLUMN IF EXISTS "nextRunAt"`);
    await queryRunner.query(`ALTER TABLE "schedule_jobs" DROP COLUMN IF EXISTS "attempts"`);
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "originalOccurrenceYmd"`);
  }
}
