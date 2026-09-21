import type { GoogleCalendarEvent } from '../../api/google-calendar.api';
import type { TaskDTO } from '../../api/tasks.api';

export function findTaskForGoogleEvent(
  tasks: TaskDTO[],
  event: Pick<GoogleCalendarEvent, 'id' | 'recurringEventId'>,
): TaskDTO | undefined {
  const ids = [event.id, event.recurringEventId].filter(Boolean) as string[];
  if (!ids.length) return undefined;
  return tasks.find((task) => !!task.googleEventId && ids.includes(task.googleEventId));
}
