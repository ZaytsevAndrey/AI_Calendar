export type SeriesSegmentRef = {
  id: string;
  seriesGroupId?: string | null;
  scheduledStartTime?: Date | string | null;
  scheduledEndTime?: Date | string | null;
};

/**
 * A logical series can be several segments (clock changed from a day onward).
 * Horizon growth extends only the segment whose last seat is latest.
 */
export function lastContinuingSeriesIds(
  tasks: SeriesSegmentRef[],
  lastSlotEndMsByTaskId: ReadonlyMap<string, number>,
): Set<string> {
  const groups = new Map<string, SeriesSegmentRef[]>();
  for (const task of tasks) {
    const key = task.seriesGroupId || task.id;
    const list = groups.get(key) ?? [];
    list.push(task);
    groups.set(key, list);
  }
  const ids = new Set<string>();
  for (const members of groups.values()) {
    let best: SeriesSegmentRef | null = null;
    let bestEnd = -Infinity;
    let bestStart = -Infinity;
    for (const task of members) {
      const slotEnd = lastSlotEndMsByTaskId.get(task.id);
      const end = Number.isFinite(slotEnd)
        ? (slotEnd as number)
        : task.scheduledEndTime
          ? new Date(task.scheduledEndTime).getTime()
          : -Infinity;
      const start = task.scheduledStartTime
        ? new Date(task.scheduledStartTime).getTime()
        : -Infinity;
      if (!best || end > bestEnd || (end === bestEnd && start >= bestStart)) {
        best = task;
        bestEnd = end;
        bestStart = Number.isFinite(start) ? start : -Infinity;
      }
    }
    if (best) ids.add(best.id);
  }
  return ids;
}

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
