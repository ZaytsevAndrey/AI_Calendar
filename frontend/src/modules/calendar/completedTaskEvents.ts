import type { GoogleCalendarEvent } from '../../api/google-calendar.api';
import type { TaskDTO } from '../../api/tasks.api';
import { findTaskForGoogleEvent } from './findTaskForGoogleEvent';

const LOCAL_COMPLETED_PREFIX = 'local-completed:';

export function resolveTaskForCalendarEvent(
  tasks: TaskDTO[],
  event: Pick<GoogleCalendarEvent, 'id' | 'recurringEventId'>,
): TaskDTO | undefined {
  if (typeof event.id === 'string' && event.id.startsWith(LOCAL_COMPLETED_PREFIX)) {
    const taskId = event.id.slice(LOCAL_COMPLETED_PREFIX.length);
    return tasks.find((task) => task.id === taskId);
  }
  return findTaskForGoogleEvent(tasks, event);
}

/** Local chips for completed tasks whose Google event was already dropped. */
export function overlayCompletedTaskEvents(
  events: GoogleCalendarEvent[],
  tasks: TaskDTO[],
): GoogleCalendarEvent[] {
  const coveredTaskIds = new Set<string>();
  const coveredEventIds = new Set<string>();
  for (const event of events) {
    if (event.id) coveredEventIds.add(event.id);
    if (event.recurringEventId) coveredEventIds.add(event.recurringEventId);
    const linked = resolveTaskForCalendarEvent(tasks, event);
    if (linked) coveredTaskIds.add(linked.id);
  }

  const extras: GoogleCalendarEvent[] = [];
  for (const task of tasks) {
    if (task.status !== 'completed') continue;
    // Unscheduled inbox completions never get a calendar chip.
    if (task.isUnscheduled) continue;
    if (!task.scheduledStartTime || !task.scheduledEndTime) continue;
    if (coveredTaskIds.has(task.id)) continue;
    if (task.googleEventId && coveredEventIds.has(task.googleEventId)) continue;
    extras.push({
      id: `${LOCAL_COMPLETED_PREFIX}${task.id}`,
      summary: task.name,
      start: { dateTime: task.scheduledStartTime },
      end: { dateTime: task.scheduledEndTime },
      status: 'confirmed',
      isAppGenerated: true,
    });
  }
  return extras.length ? [...events, ...extras] : events;
}

export function isCompletedCalendarEvent(
  event: Pick<GoogleCalendarEvent, 'id' | 'recurringEventId'>,
  tasks: TaskDTO[],
): boolean {
  return resolveTaskForCalendarEvent(tasks, event)?.status === 'completed';
}
