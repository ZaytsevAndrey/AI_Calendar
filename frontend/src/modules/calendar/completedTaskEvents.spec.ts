import {
  overlayCompletedTaskEvents,
  resolveTaskForCalendarEvent,
} from './completedTaskEvents';
import type { TaskDTO } from '../../api/tasks.api';
import type { GoogleCalendarEvent } from '../../api/google-calendar.api';

function task(partial: Partial<TaskDTO> & Pick<TaskDTO, 'id' | 'name'>): TaskDTO {
  return {
    estimatedTimeInMinutes: 30,
    isRecurring: false,
    allowSplit: false,
    priority: 'medium',
    status: 'todo',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

describe('overlayCompletedTaskEvents', () => {
  it('adds a local chip for a completed seated task without a Google event', () => {
    const completed = task({
      id: 'c1',
      name: 'Done work',
      status: 'completed',
      scheduledStartTime: '2026-10-10T09:00:00.000Z',
      scheduledEndTime: '2026-10-10T09:30:00.000Z',
    });
    const extras = overlayCompletedTaskEvents([], [completed]);
    expect(extras).toHaveLength(1);
    expect(extras[0]?.id).toBe('local-completed:c1');
    expect(resolveTaskForCalendarEvent([completed], extras[0]!)).toEqual(completed);
  });

  it('does not overlay completed Unscheduled inbox tasks', () => {
    const inboxDone = task({
      id: 'u1',
      name: 'Old idea',
      status: 'completed',
      isUnscheduled: true,
      scheduledStartTime: '2026-10-10T09:00:00.000Z',
      scheduledEndTime: '2026-10-10T09:30:00.000Z',
    });
    expect(overlayCompletedTaskEvents([], [inboxDone])).toEqual([]);
  });

  it('does not duplicate when Google already shows the event', () => {
    const completed = task({
      id: 'c1',
      name: 'Done work',
      status: 'completed',
      googleEventId: 'g1',
      scheduledStartTime: '2026-10-10T09:00:00.000Z',
      scheduledEndTime: '2026-10-10T09:30:00.000Z',
    });
    const google: GoogleCalendarEvent = {
      id: 'g1',
      summary: 'Done work',
      start: { dateTime: '2026-10-10T09:00:00.000Z' },
      end: { dateTime: '2026-10-10T09:30:00.000Z' },
      status: 'confirmed',
      isAppGenerated: true,
    };
    expect(overlayCompletedTaskEvents([google], [completed])).toEqual([google]);
  });
});
