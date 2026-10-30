import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Early-access waiting list from the public landing (`waitlist_entries`). SQL as TypeORM generates
 * it from the entity (same constraint and index names). Idempotent.
 */
export class WaitlistEntries1761820000000 implements MigrationInterface {
  name = 'WaitlistEntries1761820000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "waitlist_entries" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying(254) NOT NULL, "locale" character varying(8) NOT NULL, "source" character varying(32), "calendar" character varying(16), "pain" character varying(500), "tokenHash" character varying(64), "detailsAt" TIMESTAMP WITH TIME ZONE, "invitedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_90cae6cb55d051291054d7e8d12" UNIQUE ("email"), CONSTRAINT "PK_bd0ef66fff81d3be7b7a1568a4d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_24ff300f89262acac30b3457a5" ON "waitlist_entries" ("tokenHash") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "waitlist_entries"`);
  }
}
