import {
  SchedulingConflict,
  SchedulingWarning,
  SchedulingWarningCode,
  SkippedOccurrence,
} from './intelligent-scheduling.engine';

export type ProblematicParkInfo = {
  occurrenceYmds: string[];
  reason: string | null;
};

const OVERFLOW_SKIP_REASONS = new Set(['no_slot', 'preferred_unavailable']);

function isYmd(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function mergeUniqueYmds(into: string[], extra: string[]): string[] {
  const set = new Set(into);
  for (const ymd of extra) {
    if (isYmd(ymd)) set.add(ymd);
  }
  return [...set].sort();
}

function mergeParkInfo(
  parks: Map<string, ProblematicParkInfo>,
  taskId: string,
  ymds: string[],
  reason: string | null,
): void {
  const prev = parks.get(taskId);
  if (!prev) {
    parks.set(taskId, { occurrenceYmds: ymds, reason });
    return;
  }
  parks.set(taskId, {
    occurrenceYmds: mergeUniqueYmds(prev.occurrenceYmds, ymds),
    reason: prev.reason ?? reason,
  });
}

function skippedOverflowYmds(meta: Record<string, unknown>): string[] {
  const skipped = meta.skipped;
  if (!Array.isArray(skipped)) return [];
  const ymds: string[] = [];
  for (const row of skipped) {
    if (!row || typeof row !== 'object') continue;
    const item = row as SkippedOccurrence;
    if (!OVERFLOW_SKIP_REASONS.has(item.reason)) continue;
    if (isYmd(item.dateKey)) ymds.push(item.dateKey);
  }
  return ymds;
}

function reasonFromMeta(meta: Record<string, unknown>): string | null {
  if (typeof meta.reason === 'string' && meta.reason.trim()) {
    return meta.reason.trim().slice(0, 64);
  }
  const skipped = meta.skipped;
  if (!Array.isArray(skipped)) return null;
  for (const row of skipped) {
    if (!row || typeof row !== 'object') continue;
    const item = row as SkippedOccurrence;
    if (OVERFLOW_SKIP_REASONS.has(item.reason)) {
      return item.reason;
    }
  }
  return null;
}

function ymdsFromWarningMeta(
  meta: Record<string, unknown>,
  fallbackYmd?: string,
): string[] {
  const fromSkips = skippedOverflowYmds(meta);
  if (fromSkips.length) return fromSkips;

  if (isYmd(meta.occurrenceYmd)) return [meta.occurrenceYmd];

  if (typeof meta.preferredStart === 'string' && meta.preferredStart) {
    const day = meta.preferredStart.slice(0, 10);
    if (isYmd(day)) return [day];
  }

  if (fallbackYmd && isYmd(fallbackYmd)) return [fallbackYmd];
  return [];
}

function ymdsFromConflict(
  conflict: SchedulingConflict,
  fallbackYmd?: string,
): string[] {
  const meta = conflict.meta ?? {};
  return ymdsFromWarningMeta(meta, fallbackYmd);
}

/**
 * Day/reason hints for Problematic cards — includes conflict-choice warnings
 * (which do not auto-park) so the UI and leave_problematic can show the day.
 */
export function collectParkDayHints(
  warnings: SchedulingWarning[],
  conflicts: SchedulingConflict[] = [],
  fallbackYmd?: string,
): Map<string, ProblematicParkInfo> {
  const hints = new Map<string, ProblematicParkInfo>();

  for (const warning of warnings) {
    if (!warning.taskId || !warning.meta) continue;
    const ymds = ymdsFromWarningMeta(
      warning.meta,
      // Only use fallback when the warning is already a park signal without days.
      warning.meta.readyForProblematic === true ? fallbackYmd : undefined,
    );
    const reason =
      reasonFromMeta(warning.meta) ??
      (warning.code === SchedulingWarningCode.NEEDS_CONFLICT_CHOICE
        ? 'preferred_on_fixed'
        : null);
    if (!ymds.length && !reason) continue;
    mergeParkInfo(hints, warning.taskId, ymds, reason);
  }

  for (const conflict of conflicts) {
    if (!conflict.taskId) continue;
    const ymds = ymdsFromConflict(conflict, fallbackYmd);
    mergeParkInfo(hints, conflict.taskId, ymds, conflict.reason);
  }

  return hints;
}

/**
 * Task parks for the Problematic inbox after a schedule job, with overflow days
 * and a short reason when the engine provided them.
 * Conflict choices (`NEEDS_CONFLICT_CHOICE` / conflicts[]) wait for leave_problematic / dismiss.
 */
export function collectProblematicParks(
  warnings: SchedulingWarning[],
  conflicts: SchedulingConflict[] = [],
  fallbackYmd?: string,
): Map<string, ProblematicParkInfo> {
  const parks = new Map<string, ProblematicParkInfo>();
  const hints = collectParkDayHints(warnings, conflicts, fallbackYmd);

  for (const warning of warnings) {
    if (
      warning.code === SchedulingWarningCode.NEEDS_CONFLICT_CHOICE ||
      !warning.taskId ||
      !warning.meta ||
      warning.meta.readyForProblematic !== true
    ) {
      continue;
    }

    const hint = hints.get(warning.taskId);
    const ymds = hint?.occurrenceYmds?.length
      ? hint.occurrenceYmds
      : ymdsFromWarningMeta(warning.meta, fallbackYmd);
    const reason = hint?.reason ?? reasonFromMeta(warning.meta);
    mergeParkInfo(parks, warning.taskId, ymds, reason);
  }

  return parks;
}

/**
 * Task ids that should land in the Problematic inbox after a schedule job.
 */
export function collectProblematicTaskIds(
  warnings: SchedulingWarning[],
  conflicts: SchedulingConflict[] = [],
  fallbackYmd?: string,
): Set<string> {
  return new Set(collectProblematicParks(warnings, conflicts, fallbackYmd).keys());
}
