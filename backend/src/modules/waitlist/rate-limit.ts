/**
 * Fixed-window counter per key (client IP), in memory. Enough for one public form on one instance;
 * a restart resets it, which only makes it more lenient.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** True when this call is allowed (and counts it). */
  take(key: string): boolean {
    const t = this.now();
    const slot = this.hits.get(key);
    if (!slot || slot.resetAt <= t) {
      if (this.hits.size > 10_000) this.sweep(t);
      this.hits.set(key, { count: 1, resetAt: t + this.windowMs });
      return true;
    }
    if (slot.count >= this.limit) return false;
    slot.count += 1;
    return true;
  }

  private sweep(t: number) {
    for (const [key, slot] of this.hits) {
      if (slot.resetAt <= t) this.hits.delete(key);
    }
  }
}
