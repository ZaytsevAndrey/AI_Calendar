import type { TaskDTO } from '../../../api/tasks.api';
import { taskPatchDiff } from './patchDiff';

const task: TaskDTO = {
  id: 't1',
  name: 'Standup',
  description: undefined,
  eventType: 'admin',
  estimatedTimeInMinutes: 30,
  isRecurring: false,
  recurrencePattern: undefined,
  recurrenceWeekDays: null,
  allowSplit: false,
  priority: 'medium',
  status: 'todo',
  deadline: '2026-11-06T21:59:00.000Z',
  earliestStartTime: undefined,
  eligibleWeekDays: null,
  scheduleTimeZone: 'Europe/Kyiv',
  scheduledStartTime: '2026-11-06T13:00:00.000Z',
  scheduledEndTime: '2026-11-06T13:30:00.000Z',
  phaseId: 'p1',
  phases: [{ id: 'p1', name: 'Work' }],
  googleReminders: { useDefault: true },
  seriesGroupId: 's1',
  originalOccurrenceYmd: '2026-11-06',
  createdAt: '',
  updatedAt: '',
};

describe('taskPatchDiff', () => {
  it('a full payload with nothing changed sends only the time zone', () => {
    const diff = taskPatchDiff(task, {
      name: 'Standup',
      description: undefined,
      eventType: 'admin',
      isUnscheduled: false,
      estimatedTimeInMinutes: 30,
      isRecurring: false,
      recurrencePattern: undefined,
      recurrenceWeekDays: [],
      allowSplit: false,
      priority: 'medium',
      deadline: '2026-11-06T21:59:00.000Z',
      earliestStartTime: null,
      timeZone: 'Europe/Kyiv',
      eligibleWeekDays: null,
      status: 'todo',
      phaseIds: ['p1'],
      phaseId: 'p1',
      location: null,
      googleColorId: null,
      googleVisibility: null,
      googleTransparency: null,
      googleReminders: { useDefault: true },
      scheduledStartTime: '2026-11-06T13:00:00.000Z',
      scheduledEndTime: '2026-11-06T13:30:00.000Z',
    });
    expect(diff).toEqual({ timeZone: 'Europe/Kyiv' });
  });

  it('keeps only the changed fields', () => {
    const diff = taskPatchDiff(task, {
      name: 'Standup (guest)',
      estimatedTimeInMinutes: 30,
      scheduledStartTime: '2026-11-06T14:00:00.000Z',
      scheduledEndTime: '2026-11-06T14:30:00.000Z',
      phaseIds: ['p1'],
    });
    expect(diff).toEqual({
      name: 'Standup (guest)',
      scheduledStartTime: '2026-11-06T14:00:00.000Z',
      scheduledEndTime: '2026-11-06T14:30:00.000Z',
    });
  });

  it('clearing a phase or a deadline is a change', () => {
    expect(taskPatchDiff(task, { phaseIds: [], deadline: null })).toEqual({
      phaseIds: [],
      deadline: null,
    });
  });

  it('instants compare by moment, weekday lists by set', () => {
    const series = { ...task, isRecurring: true, recurrenceWeekDays: [1, 3] };
    expect(
      taskPatchDiff(series, {
        deadline: '2026-11-07T00:59:00.000+03:00',
        recurrenceWeekDays: [3, 1],
      }),
    ).toEqual({});
    expect(taskPatchDiff(series, { recurrenceWeekDays: [1, 3, 5] })).toEqual({
      recurrenceWeekDays: [1, 3, 5],
    });
  });
});
