import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Idempotent task creation (stabilization, Oct 2026): one row per client
 * operation (Idempotency-Key), unique per user + operation + key, with the
 * request hash and the resource it created. Separate from `tasks` so deleting
 * the task does not free the key. Idempotent.
 *
 * Replaces the unreleased `1761780000000-TaskCreateRequestKey` (a column on
 * `tasks`) from the same branch; it was never deployed anywhere.
 */
export class CreateRequestIdempotency1761780000000 implements MigrationInterface {
  name = 'CreateRequestIdempotency1761780000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "request_idempotency" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" character varying NOT NULL, "operation" character varying(32) NOT NULL, "key" character varying(64) NOT NULL, "requestHash" character varying(64) NOT NULL, "resourceId" character varying(64), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_f4cb7d2fdb016c45481fc30cc6f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_request_idempotency_user_op_key" ON "request_idempotency" ("userId", "operation", "key")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_request_idempotency_user_op_key"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "request_idempotency"`);
  }
}
