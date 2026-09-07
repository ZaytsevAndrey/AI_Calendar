import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { join } from 'path';

const entityGlob = join(__dirname, '..', 'modules', '**', '*.entity.{ts,js}').replace(
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
  const synchronize = env.TYPEORM_SYNC !== 'false';

  if (isPostgresUrl(databaseUrl)) {
    console.log('[TypeORM] Using postgres');
    return {
      type: 'postgres',
      url: databaseUrl,
      ssl: env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
      entities: [entityGlob],
      synchronize,
    };
  }

  console.log('[TypeORM] Using sqlite');
  return {
    type: 'sqlite',
    database: env.SQLITE_PATH || 'db.sqlite',
    entities: [entityGlob],
    synchronize: true,
  };
}
