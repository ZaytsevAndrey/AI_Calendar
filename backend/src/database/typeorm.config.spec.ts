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
    expect(options).toMatchObject({
      type: 'postgres',
      url: 'postgres://user:pass@host/db?sslmode=require',
      ssl: { rejectUnauthorized: false },
      synchronize: true,
    });
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
