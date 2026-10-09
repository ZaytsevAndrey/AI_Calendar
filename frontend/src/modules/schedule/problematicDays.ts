import type { TaskDTO } from 'api/tasks.api';
import { localYmd } from 'utils/ianaDateTime';
import type { ParkDayHint } from './parkDayHints';

/** API/json columns may arrive as a real array or a JSON string. */
export function normalizeYmdList(raw: unknown): string[] {
  let value = raw;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      value = JSON.parse(trimmed) as unknown;
    } catch {
      return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? [trimmed] : [];
    }
  }
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (ymd): ymd is string =>
          typeof ymd === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ymd),
      ),
    ),
  ].sort();
}

export function todayYmdInZone(timeZone: string): string {
  return localYmd(new Date().toISOString(), timeZone);
}

/** Civil days still relevant for the Problematic inbox (today and future). */
export function remainingProblematicDays(
  task: TaskDTO,
  hint: ParkDayHint | undefined,
  todayYmd: string,
): string[] {
  const fromTask = normalizeYmdList(task.problematicOccurrenceYmds);
  const fromHint = normalizeYmdList(hint?.occurrenceYmds);
  const day =
    typeof task.problematicDay === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(task.problematicDay)
      ? task.problematicDay
      : null;
  const known = fromTask.length ? fromTask : fromHint.length ? fromHint : day ? [day] : [];
  return known.filter((ymd) => ymd >= todayYmd);
}

/** True when the task still has a park day today/future, or has no day metadata yet. */
export function isActiveProblematicTask(
  task: TaskDTO,
  todayYmd: string,
  hint?: ParkDayHint,
): boolean {
  if (task.scheduleState !== 'problematic') return false;
  if (task.status === 'completed' || task.status === 'canceled') return false;
  const remaining = remainingProblematicDays(task, hint, todayYmd);
  if (remaining.length > 0) return true;
  const hadDays =
    normalizeYmdList(task.problematicOccurrenceYmds).length > 0 ||
    normalizeYmdList(hint?.occurrenceYmds).length > 0 ||
    (!!task.problematicDay && /^\d{4}-\d{2}-\d{2}$/.test(task.problematicDay));
  // Past-only parks drop out; unknown day keeps the row (Skip/Move can use today).
  return !hadDays;
}
