import 'dotenv/config';
import { isPostgresUrl } from './typeorm.config';

/** SQLite rejects `timestamptz`; Postgres needs it instead of `datetime`. */
export function timestampColumnType(): 'timestamptz' | 'datetime' {
  return isPostgresUrl(process.env.DATABASE_URL) ? 'timestamptz' : 'datetime';
}
