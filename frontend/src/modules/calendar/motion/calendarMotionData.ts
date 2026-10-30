import type { GoogleCalendarEvent } from '../../../api/google-calendar.api';
import type { TaskDTO } from '../../../api/tasks.api';
import { resolveTaskForCalendarEvent } from '../completedTaskEvents';
import type { MotionDestination } from './cardMotion';

const PENDING_PREFIX = 'local-task:';

/**
 * Ids an action on this card is known by. A series day is known only by its
 * own event id and the series id, not the task id: a drag of one day must not
 * mark every day of the series.
 */
export function motionKeysForEvent(tasks: TaskDTO[], event: GoogleCalendarEvent): string[] {
  const keys = [event.id];
  if (event.recurringEventId) keys.push(event.recurringEventId);
  if (event.id.startsWith(PENDING_PREFIX)) {
    keys.push(event.id.slice(PENDING_PREFIX.length));
    return keys;
  }
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
 * A fixed task being created stands on the grid right away as a placeholder
 * that fills up while the server places it; the real event replaces it.
 */
export function overlayPendingCreates(
  events: GoogleCalendarEvent[],
  tasks: TaskDTO[],
  isPending: (taskId: string) => boolean,
): GoogleCalendarEvent[] {
  const extras: GoogleCalendarEvent[] = [];
  for (const task of tasks) {
    if (!task.scheduledStartTime || !task.scheduledEndTime || task.isRecurring) continue;
    if (!isPending(task.id)) continue;
    const covered = events.some(
      (event) => resolveTaskForCalendarEvent([task], event)?.id === task.id,
    );
    if (covered) continue;
    extras.push({
      id: `${PENDING_PREFIX}${task.id}`,
      summary: task.name,
      start: { dateTime: task.scheduledStartTime },
      end: { dateTime: task.scheduledEndTime },
      status: 'confirmed',
      isAppGenerated: true,
    });
  }
  return extras.length ? [...events, ...extras] : events;
}
