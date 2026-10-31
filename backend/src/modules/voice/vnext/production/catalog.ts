/**
 * Authorized entity catalog for the structured voice turn, built from the database.
 * The same functions produce the per-turn catalog and the confirm-time re-read, so a revision
 * compares like with like. Nothing here comes from the request body.
 */
import type { DayReminder } from '../../../day-reminders/entities/day-reminder.entity';
import type { ScheduledTask } from '../../../schedule/schedule.entity';
import { googleRecurringInstanceId } from '../../../tasks/skipped-occurrence.util';
import { TaskEventType } from '../../../scheduling/event-type.enum';
import { TaskStatus, type Task } from '../../../tasks/entities/task.entity';
import type { EntityRecord, StoredReminderFields } from '../reference/reference-resolver';
import type { EntityReadResult } from '../state/revalidate-preview';

/** FNV-1a 32-bit. A content fingerprint, not a security boundary. Never 0. */
export function fingerprint(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) || 1;
}

function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Revision of a task and its placed slots. A task save bumps `updatedAt`; a slot moved, added,
 * or removed changes the slot list. Either one changes the revision.
 */
export function taskRevision(task: Task, slots: readonly ScheduledTask[]): number {
  const slotPart = slots
    .map((slot) => [
      slot.id,
      iso(slot.updatedAt),
      iso(slot.scheduledStartTime),
      iso(slot.scheduledEndTime),
      slot.googleEventId ?? '',
      slot.googleEventCalendarId ?? '',
    ].join(':'))
    .sort()
    .join(',');
  return fingerprint([iso(task.updatedAt), task.status, task.googleEventId ?? '', task.googleEventCalendarId ?? '', slotPart].join('|'));
}

/** Same rule as the legacy resolver: a slot's own event id, else the series instance id. */
function occurrenceEventId(task: Task, slot: ScheduledTask): string | null {
  const master = task.googleEventId;
  const own = slot.googleEventId;
  if (master) return own && own !== master ? own : googleRecurringInstanceId(master, new Date(slot.scheduledStartTime));
  return own || null;
}

function occurrencesOf(task: Task, slots: readonly ScheduledTask[]): Array<{ start: string; end: string; googleEventId: string | null; slotId: string }> {
  return slots
    .map((slot) => ({ start: iso(slot.scheduledStartTime), end: iso(slot.scheduledEndTime), googleEventId: occurrenceEventId(task, slot), slotId: slot.id }))
    .filter((row): row is { start: string; end: string; googleEventId: string | null; slotId: string } => row.start != null && row.end != null)
    .sort((left, right) => left.start.localeCompare(right.start));
}

function taskStatus(status: TaskStatus): EntityRecord['status'] {
  if (status === TaskStatus.COMPLETED) return 'completed';
  if (status === TaskStatus.CANCELED) return 'canceled';
  return 'open';
}

/**
 * One owned task. Placement and calendar-event identity are given only when exactly one slot
 * exists and the task is not a series, the same rule the client move command needs.
 */
export function taskRecord(task: Task, allSlots: readonly ScheduledTask[], allTasks: readonly Task[] = []): EntityRecord {
  const slots = allSlots.filter((slot) => slot.taskId === task.id);
  // D-03 / VB-02: a series whose group holds a detached copy (an edited or moved day) or a parked day is not
  // one row; a series-wide rename / end / delete would miss those days, so the projection refuses it.
  const seriesCopies = task.isRecurring && (
    (task.problematicOccurrenceYmds?.length ?? 0) > 0
    || allTasks.some((other) => other.id !== task.id && other.userId === task.userId
      && (other.parentSeriesId === task.id || (task.seriesGroupId != null && other.seriesGroupId === task.seriesGroupId))));
  const single = slots.length === 1 ? slots[0] : null;
  const calendarId = single?.googleEventCalendarId || task.googleEventCalendarId || undefined;
  const googleEventId = single && !task.isRecurring ? (single.googleEventId || task.googleEventId || null) : null;
  return {
    id: task.id,
    userId: task.userId,
    type: 'task',
    name: task.name,
    status: taskStatus(task.status),
    revision: taskRevision(task, slots),
    ...(calendarId ? { calendarId } : {}),
    ...(task.isRecurring ? { recurring: true, occurrences: occurrencesOf(task, slots), seriesEventId: task.googleEventId ?? null } : {}),
    ...(seriesCopies ? { seriesCopies: true } : {}),
    scheduledStart: single ? iso(single.scheduledStartTime) : null,
    scheduledEnd: single ? iso(single.scheduledEndTime) : null,
    // The app slot moves through the same path as a drag of that block; no calendar id needed (VC-03).
    ...(single && !task.isRecurring ? { slotId: single.id } : {}),
    ...(task.isUnscheduled && !task.isRecurring ? { unscheduled: true } : {}),
    googleEventId,
    ...(task.eventType === TaskEventType.FIXED ? { fixed: true } : {}),
    writable: true,
  };
}

export function reminderRecord(row: DayReminder): EntityRecord {
  return {
    id: row.id,
    userId: row.userId,
    type: 'reminder',
    name: row.name,
    status: row.status === 'open' ? 'open' : 'completed',
    revision: fingerprint([iso(row.updatedAt), row.status, row.dueYmd, row.notificationTime ?? '', row.recurrencePattern ?? ''].join('|')),
    ...(row.googleEventCalendarId ? { calendarId: row.googleEventCalendarId } : {}),
    writable: true,
    reminder: {
      dueYmd: row.dueYmd,
      notificationTime: row.notificationTime ?? null,
      description: row.description ?? null,
      recurrencePattern: (row.recurrencePattern ?? null) as StoredReminderFields['recurrencePattern'],
      recurrenceWeekDays: row.recurrenceWeekDays ?? null,
    },
  };
}

/** Rows owned by the caller only. A row of another user is dropped, not passed on. */
export function buildCatalog(
  userId: string,
  tasks: readonly Task[],
  slots: readonly ScheduledTask[],
  reminders: readonly DayReminder[],
): EntityRecord[] {
  return [
    ...tasks.filter((task) => task.userId === userId).map((task) => taskRecord(task, slots, tasks)),
    ...reminders.filter((row) => row.userId === userId).map(reminderRecord),
  ];
}

/** Shape a fresh authorized row for confirm-time revalidation. */
export function readResult(record: EntityRecord): EntityReadResult {
  return {
    exists: true,
    revision: record.revision,
    calendarId: record.calendarId ?? null,
    writable: record.writable !== false,
    googleEventId: record.googleEventId ?? null,
    status: record.status,
    userId: record.userId,
  };
}
