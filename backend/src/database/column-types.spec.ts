import { timestampColumnType } from './column-types';

describe('timestampColumnType', () => {
  const original = process.env.DATABASE_URL;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = original;
    }
  });

  it('uses datetime for sqlite / missing URL', () => {
    delete process.env.DATABASE_URL;
    expect(timestampColumnType()).toBe('datetime');
    process.env.DATABASE_URL = 'file:./db.sqlite';
    expect(timestampColumnType()).toBe('datetime');
  });

  it('uses timestamptz for postgres URLs', () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@host/db';
    expect(timestampColumnType()).toBe('timestamptz');
  });
});
