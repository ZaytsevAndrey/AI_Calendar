import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Admin console schema (master `907b9fc`, built before versioned migrations
 * reached master): tables `admin_users`, `api_error_logs`, `voice_turn_logs`
 * and `user.isBlocked / sessionsRevokedAt / lastActiveAt`. SQL as TypeORM
 * generates it from the entities. Idempotent: a database where TYPEORM_SYNC
 * already created them is left as it is.
 */
export class AdminConsoleSchema1761800000000 implements MigrationInterface {
  name = 'AdminConsoleSchema1761800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "api_error_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "method" character varying(10) NOT NULL, "path" character varying(200) NOT NULL, "status" integer NOT NULL, "code" character varying(80), "message" character varying(300) NOT NULL, "userId" uuid, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_fba47c85f9649de5fcf2f527739" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_34c88a2c987ac9d130d88bed35" ON "api_error_logs" ("status") `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_34ee1475db97321764a0171c0e" ON "api_error_logs" ("userId") `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_7e565c68ae97233fbb9a41108d" ON "api_error_logs" ("createdAt") `);
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "voice_turn_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid, "traceId" character varying(80) NOT NULL, "method" character varying(10) NOT NULL, "path" character varying(120) NOT NULL, "statusCode" integer NOT NULL, "totalMs" integer NOT NULL, "llmCalls" integer NOT NULL DEFAULT '0', "llmMs" integer NOT NULL DEFAULT '0', "tokens" integer NOT NULL DEFAULT '0', "failedSteps" integer NOT NULL DEFAULT '0', "errorCode" character varying(80), "stepsJson" text NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_749144d9ca0b9f54aae7b554956" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_2589072f485cf1bf1116797966" ON "voice_turn_logs" ("userId") `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_2fcabe3317ec1c714180d4f8c3" ON "voice_turn_logs" ("statusCode") `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_f17f88a9587967fd19ac5f3612" ON "voice_turn_logs" ("createdAt") `);
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "admin_users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "login" character varying(64) NOT NULL, "passwordHash" character varying(100) NOT NULL, "isActive" boolean NOT NULL DEFAULT true, "lastLoginAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_470b3e213a5110801aa3029684c" UNIQUE ("login"), CONSTRAINT "PK_06744d221bb6145dc61e5dc441d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "isBlocked" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "sessionsRevokedAt" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "lastActiveAt" TIMESTAMP WITH TIME ZONE`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN IF EXISTS "lastActiveAt"`);
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN IF EXISTS "sessionsRevokedAt"`);
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN IF EXISTS "isBlocked"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "admin_users"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "voice_turn_logs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "api_error_logs"`);
  }
}
