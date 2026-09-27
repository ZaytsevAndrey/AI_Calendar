/** Minimum time between automatic recurring-horizon extend jobs for one user. */
export const RECURRING_EXTEND_MIN_INTERVAL_MS = 20 * 60 * 60 * 1000;

export function shouldEnqueueRecurringExtend(input: {
  hasActiveRecurring: boolean;
  hasPendingOrRunningJob: boolean;
  lastExtendAt: Date | null;
  now: Date;
  minIntervalMs?: number;
}): boolean {
  if (!input.hasActiveRecurring) return false;
  if (input.hasPendingOrRunningJob) return false;
  const minInterval = input.minIntervalMs ?? RECURRING_EXTEND_MIN_INTERVAL_MS;
  if (!input.lastExtendAt) return true;
  return input.now.getTime() - input.lastExtendAt.getTime() >= minInterval;
}
