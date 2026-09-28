/**
 * Extract civil overflow days from a schedule job warning/conflict meta blob.
 */
export function ymdsFromParkMeta(
  meta: Record<string, unknown> | null | undefined,
): string[] {
  if (!meta) return [];
  const ymds: string[] = [];
  const skipped = meta.skipped;
  if (Array.isArray(skipped)) {
    for (const row of skipped) {
      if (!row || typeof row !== 'object') continue;
      const dateKey = (row as { dateKey?: unknown; reason?: unknown }).dateKey;
      const reason = (row as { reason?: unknown }).reason;
      if (
        reason === 'already_passed' ||
        reason === 'deadline'
      ) {
        continue;
      }
      if (typeof dateKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
        ymds.push(dateKey);
      }
    }
  }
  if (
    typeof meta.occurrenceYmd === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(meta.occurrenceYmd)
  ) {
    ymds.push(meta.occurrenceYmd);
  }
  if (typeof meta.preferredStart === 'string' && meta.preferredStart) {
    const day = meta.preferredStart.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) ymds.push(day);
  }
  return [...new Set(ymds)].sort();
}

export type ParkDayHint = {
  occurrenceYmds: string[];
  reason: string | null;
};

export function parkDayHintsFromJobResult(result: {
  warnings?: Array<{
    taskId?: string;
    meta?: Record<string, unknown>;
    code?: string;
  }>;
  conflicts?: Array<{
    taskId: string;
    reason?: string;
    meta?: Record<string, unknown>;
  }>;
} | null | undefined): Record<string, ParkDayHint> {
  const out: Record<string, ParkDayHint> = {};
  const merge = (
    taskId: string,
    ymds: string[],
    reason: string | null,
  ) => {
    const prev = out[taskId];
    if (!prev) {
      out[taskId] = { occurrenceYmds: ymds, reason };
      return;
    }
    out[taskId] = {
      occurrenceYmds: [...new Set([...prev.occurrenceYmds, ...ymds])].sort(),
      reason: prev.reason ?? reason,
    };
  };

  for (const warning of result?.warnings ?? []) {
    if (!warning.taskId) continue;
    const ymds = ymdsFromParkMeta(warning.meta);
    const reason =
      typeof warning.meta?.reason === 'string'
        ? warning.meta.reason
        : warning.code === 'NEEDS_CONFLICT_CHOICE'
          ? 'preferred_on_fixed'
          : null;
    if (ymds.length || reason) merge(warning.taskId, ymds, reason);
  }
  for (const conflict of result?.conflicts ?? []) {
    if (!conflict.taskId) continue;
    merge(
      conflict.taskId,
      ymdsFromParkMeta(conflict.meta),
      conflict.reason ?? null,
    );
  }
  return out;
}
