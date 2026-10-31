import type { GoogleCalendarEvent } from '../../../api/google-calendar.api';
import type { TaskDTO } from '../../../api/tasks.api';
import { resolveTaskForCalendarEvent } from '../completedTaskEvents';
import { placeholderKeys, type MotionDestination, type PendingPlacement } from './cardMotion';

/**
 * Ids an action on this card is known by. A series day is known only by its
 * own event id and the series id, not the task id: a drag of one day must not
 * mark every day of the series.
 */
export function motionKeysForEvent(tasks: TaskDTO[], event: GoogleCalendarEvent): string[] {
  const placeholder = placeholderKeys(event.id);
  if (placeholder) return placeholder;
  const keys = [event.id];
  if (event.recurringEventId) keys.push(event.recurringEventId);
  const task = resolveTaskForCalendarEvent(tasks, event);
  if (task && !event.recurringEventId && !task.isRecurring) keys.push(task.id);
  return keys;
}

/** Where the task behind these keys is now, for a card that left the visible days. */
export function motionDestination(tasks: TaskDTO[], keys: string[]): MotionDestination {
  const task = tasks.find(
    (item) => keys.includes(item.id) || (!!item.googleEventId && keys.includes(item.googleEventId)),
  );
  if (!task) return { type: 'gone' };
  if (task.status === 'completed' || task.status === 'canceled') return { type: 'gone' };
  if (task.scheduleState === 'problematic') return { type: 'parked' };
  if (task.isUnscheduled) return { type: 'later' };
  // Placed by the scheduler, slot not known yet: wait for the refetch.
  if (!task.scheduledStartTime) return null;
  const startMs = new Date(task.scheduledStartTime).getTime();
  return Number.isFinite(startMs) ? { type: 'date', startMs } : null;
}

/**
 * A task being placed (created, scheduled from «На потім», a problem put on a
 * slot) stands on the grid right away as a placeholder that fills up; the real
 * event replaces it when Google returns it. Times come from the task once the
 * server seated it, else from the slot the user picked.
 */
export function overlayPendingPlacements(
  events: GoogleCalendarEvent[],
  tasks: TaskDTO[],
  placements: PendingPlacement[],
): GoogleCalendarEvent[] {
  const extras: GoogleCalendarEvent[] = [];
  for (const placement of placements) {
    const task = tasks.find((item) => placement.keys.includes(item.id));
    if (task?.scheduleState === 'problematic' && !placement.startMs) continue;
    const covered = events.some((event) => {
      if (placement.keys.includes(event.id)) return true;
      const linked = resolveTaskForCalendarEvent(tasks, event);
      return !!linked && placement.keys.includes(linked.id) && !event.recurringEventId;
    });
    if (covered) continue;
    const seated = task?.scheduledStartTime && task.scheduledEndTime && !task.isUnscheduled;
    const startMs = seated ? Date.parse(task.scheduledStartTime as string) : placement.startMs;
    const endMs = seated
      ? Date.parse(task.scheduledEndTime as string)
      : startMs != null
        ? startMs + (placement.durationMs ?? (task?.estimatedTimeInMinutes ?? 30) * 60_000)
        : undefined;
    if (startMs == null || endMs == null || !Number.isFinite(startMs) || !(endMs > startMs)) continue;
    extras.push({
      id: placement.id,
      summary: task?.name || placement.title,
      start: { dateTime: new Date(startMs).toISOString() },
      end: { dateTime: new Date(endMs).toISOString() },
      status: 'confirmed',
      isAppGenerated: true,
    });
  }
  return extras.length ? [...events, ...extras] : events;
}
