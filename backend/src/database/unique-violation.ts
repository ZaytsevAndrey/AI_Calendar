/** True when a write failed on a unique index (Postgres 23505, SQLite UNIQUE). */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; driverError?: { code?: string; message?: string }; message?: string };
  const code = e?.driverError?.code ?? e?.code;
  if (code === '23505') return true;
  const message = `${e?.driverError?.message ?? ''} ${e?.message ?? ''}`;
  return /UNIQUE constraint failed/i.test(message);
}
