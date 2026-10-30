import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { join } from 'path';

const entityGlob = join(__dirname, '..', 'modules', '**', '*.entity.{ts,js}').replace(
  /\\/g,
  '/',
);

/**
 * Entity subscribers (the Google outbox). By glob, like entities: importing the
 * class here would load the entities before this module finishes.
 */
const subscriberGlob = join(__dirname, '..', 'modules', '**', '*.subscriber.{ts,js}').replace(
  /\\/g,
  '/',
);

/** Versioned migrations (Postgres). SQLite dev and tests keep `synchronize`. */
export const migrationGlob = join(__dirname, 'migrations', '*.{ts,js}').replace(
  /\\/g,
  '/',
);

export function isPostgresUrl(databaseUrl: string | undefined): boolean {
  return /^postgres(ql)?:\/\//i.test(databaseUrl || '');
}

export function createTypeOrmOptions(
  env: NodeJS.ProcessEnv = process.env,
): TypeOrmModuleOptions {
  const databaseUrl = env.DATABASE_URL || '';

  if (isPostgresUrl(databaseUrl)) {
    console.log('[TypeORM] Using postgres');
    // Schema comes from versioned migrations, run on boot. synchronize is an
    // explicit opt-in (TYPEORM_SYNC=true) for throwaway databases only.
    return {
      type: 'postgres',
      url: databaseUrl,
      ssl: env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
      entities: [entityGlob],
      // Google outbox: queue rows written in the same transaction as the change.
      subscribers: [subscriberGlob],
      migrations: [migrationGlob],
      migrationsRun: env.TYPEORM_MIGRATIONS !== 'false',
      migrationsTransactionMode: 'each',
      synchronize: env.TYPEORM_SYNC === 'true',
    };
  }

  console.log('[TypeORM] Using sqlite');
  return {
    type: 'sqlite',
    database: env.SQLITE_PATH || 'db.sqlite',
    entities: [entityGlob],
    subscribers: [subscriberGlob],
    synchronize: true,
  };
}
