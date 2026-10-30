import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-occurrence completion (Oct 2026): a completed task — a one-off or the
 * detached copy that stands for one day of a series — records when it was
 * completed, so the history of a series survives regeneration and an undo
 * can be told from "never done". Idempotent; existing completed rows keep a
 * null timestamp (the moment is unknown and is never guessed).
 */
export class TaskCompletedAt1761820000000 implements MigrationInterface {
  name = 'TaskCompletedAt1761820000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "completedAt"`);
  }
}
