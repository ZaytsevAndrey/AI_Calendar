import type { TaskDTO, UpdateTaskDTO } from '../../../api/tasks.api';

/**
 * Keys the form may send on an edit. Anything else in the payload (timeZone,
 * status when unchanged, …) is kept only when it differs too.
 */
type PatchKey = keyof UpdateTaskDTO;

const INSTANT_KEYS = new Set<PatchKey>([
  'scheduledStartTime',
  'scheduledEndTime',
  'deadline',
  'earliestStartTime',
]);
const DAY_LIST_KEYS = new Set<PatchKey>(['recurrenceWeekDays', 'eligibleWeekDays']);
const BOOLEAN_KEYS = new Set<PatchKey>(['isUnscheduled', 'isRecurring', 'allowSplit']);

function canonical(key: PatchKey, value: unknown): string {
  // Stored booleans may be missing on older rows: absent means false.
  if (BOOLEAN_KEYS.has(key) && (value === undefined || value === null)) return 'false';
  if (value === undefined || value === null) return 'null';
  if (typeof value === 'string' && value.trim() === '') return 'null';
  if (INSTANT_KEYS.has(key)) {
    const ms = new Date(String(value)).getTime();
    return Number.isFinite(ms) ? String(ms) : `raw:${String(value)}`;
  }
  if (DAY_LIST_KEYS.has(key) || key === 'phaseIds') {
    if (!Array.isArray(value) || value.length === 0) return 'null';
    return JSON.stringify([...value].sort());
  }
  if (key === 'googleReminders') {
    const row = value as { useDefault?: boolean; overrides?: unknown[] };
    if (row.useDefault !== false) return 'default';
    return `custom:${(row.overrides ?? []).map((o) => JSON.stringify(o)).sort().join('|')}`;
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** The stored value that `key` of the payload is compared against. */
function storedValue(task: TaskDTO, key: PatchKey): unknown {
  if (key === 'phaseIds') {
    const ids = new Set<string>();
    if (task.phaseId) ids.add(task.phaseId);
    for (const phase of task.phases ?? []) if (phase?.id) ids.add(phase.id);
    return [...ids];
  }
  if (key === 'phaseId') return task.phaseId ?? task.phases?.[0]?.id ?? null;
  if (key === 'timeZone') return task.scheduleTimeZone ?? null;
  return (task as unknown as Record<string, unknown>)[key as string];
}

/**
 * Only what the user changed. A form rebuilds the whole task on save; sending
 * it all back would let unchanged fields count as edits (a renamed-to-the-
 * same-name day copy, a series whose repeat rule was "changed" to itself).
 * Fields that are not stored on the task (`timeZone`) are kept when present.
 */
export function taskPatchDiff(task: TaskDTO, payload: UpdateTaskDTO): UpdateTaskDTO {
  const diff: Record<string, unknown> = {};
  for (const [rawKey, value] of Object.entries(payload)) {
    const key = rawKey as PatchKey;
    if (value === undefined) continue;
    if (key === 'timeZone') {
      diff[key] = value;
      continue;
    }
    if (canonical(key, value) !== canonical(key, storedValue(task, key))) {
      diff[key] = value;
    }
  }
  return diff as UpdateTaskDTO;
}
