import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Idempotent task creation (stabilization, Oct 2026): the Idempotency-Key of
 * the request that created a task, unique per user. Existing tasks stay null
 * (Postgres treats NULLs as distinct, so the index allows them all).
 */
export class TaskCreateRequestKey1761780000000 implements MigrationInterface {
  name = 'TaskCreateRequestKey1761780000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "createRequestKey" character varying(64)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_tasks_user_create_request_key" ON "tasks" ("userId", "createRequestKey")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tasks_user_create_request_key"`);
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "createRequestKey"`);
  }
}
