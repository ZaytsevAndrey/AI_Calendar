export const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` in UTC. */
export function utcYmd(date: Date | number): string {
  return new Date(date).toISOString().slice(0, 10);
}

/** The last `days` UTC days, oldest first, ending today. */
export function lastUtcDays(days: number, now = Date.now()): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) out.push(utcYmd(now - i * DAY_MS));
  return out;
}

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/** Nearest-rank percentile of an unsorted list. 0 for an empty list. */
export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}
