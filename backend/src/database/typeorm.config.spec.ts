import { createTypeOrmOptions, isPostgresUrl } from './typeorm.config';

describe('isPostgresUrl', () => {
  it('accepts postgres and postgresql URLs', () => {
    expect(isPostgresUrl('postgres://user:pass@host/db')).toBe(true);
    expect(isPostgresUrl('postgresql://user:pass@host/db')).toBe(true);
  });

  it('rejects sqlite-style values', () => {
    expect(isPostgresUrl('file:./db.sqlite')).toBe(false);
    expect(isPostgresUrl('')).toBe(false);
    expect(isPostgresUrl(undefined)).toBe(false);
  });
});

describe('createTypeOrmOptions', () => {
  it('uses sqlite when DATABASE_URL is not postgres', () => {
    const options = createTypeOrmOptions({
      SQLITE_PATH: 'test.sqlite',
    });
    expect(options).toMatchObject({
      type: 'sqlite',
      database: 'test.sqlite',
      synchronize: true,
    });
  });

  it('uses postgres when DATABASE_URL is a postgres URL', () => {
    const options = createTypeOrmOptions({
      DATABASE_URL: 'postgres://user:pass@host/db?sslmode=require',
    });
    // Stabilization G: Postgres schema comes from versioned migrations run on
    // boot; synchronize is off unless TYPEORM_SYNC=true is set explicitly.
    expect(options).toMatchObject({
      type: 'postgres',
      url: 'postgres://user:pass@host/db?sslmode=require',
      ssl: { rejectUnauthorized: false },
      synchronize: false,
      migrationsRun: true,
    });
  });

  it('keeps synchronize as an explicit opt-in on Postgres', () => {
    expect(
      createTypeOrmOptions({ DATABASE_URL: 'postgres://localhost/db', TYPEORM_SYNC: 'true' }),
    ).toMatchObject({ synchronize: true });
    expect(
      createTypeOrmOptions({ DATABASE_URL: 'postgres://localhost/db', TYPEORM_MIGRATIONS: 'false' }),
    ).toMatchObject({ migrationsRun: false });
  });

  it('can disable SSL and synchronize via env', () => {
    const options = createTypeOrmOptions({
      DATABASE_URL: 'postgresql://localhost/db',
      DATABASE_SSL: 'false',
      TYPEORM_SYNC: 'false',
    });
    expect(options).toMatchObject({
      type: 'postgres',
      ssl: false,
      synchronize: false,
    });
  });
});
