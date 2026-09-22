import type { TaskDTO } from '../../../api/tasks.api';
import { filterScheduledTasks, filterUnscheduledTasks } from './taskListFilters';

const now = new Date('2026-09-21T12:00:00.000Z');

function task(partial: Partial<TaskDTO> & Pick<TaskDTO, 'id' | 'name'>): TaskDTO {
  return {
    estimatedTimeInMinutes: 30,
    isRecurring: false,
    allowSplit: true,
    priority: 'medium',
    status: 'todo',
    createdAt: '2026-09-10T06:00:00.000Z',
    updatedAt: '2026-09-10T06:00:00.000Z',
    ...partial,
  };
}

const inbox = task({ id: 'inbox', name: 'Buy milk', isUnscheduled: true, deadline: '2026-09-20T12:00:00.000Z' });
const flexible = task({
  id: 'flex',
  name: 'Write brief',
  eventType: 'admin',
  phaseId: 'focus',
  phase: { id: 'focus', name: 'Focus' },
});
const fixed = task({ id: 'fixed', name: 'Dentist', eventType: 'fixed' });
const recurring = task({ id: 'series', name: 'Weekly review', isRecurring: true, eventType: 'admin' });
const done = task({ id: 'done', name: 'Write brief notes', status: 'completed', eventType: 'admin' });
const overdue = task({
  id: 'late',
  name: 'File taxes',
  eventType: 'admin',
  deadline: '2026-09-20T12:00:00.000Z',
});
const tasks = [inbox, flexible, fixed, recurring, done, overdue];

describe('filterUnscheduledTasks', () => {
  const open = { query: '', status: 'active' as const, overdueOnly: false };

  it('keeps the inbox separate from scheduled tasks', () => {
    expect(filterUnscheduledTasks(tasks, open, now).map((item) => item.id)).toEqual(['inbox']);
  });

  it('matches a case-insensitive name substring and can show only overdue', () => {
    expect(filterUnscheduledTasks(tasks, { ...open, query: 'MILK' }, now).map((item) => item.id)).toEqual(['inbox']);
    expect(filterUnscheduledTasks(tasks, { ...open, query: 'brief' }, now)).toEqual([]);
    expect(filterUnscheduledTasks(tasks, { ...open, overdueOnly: true }, now).map((item) => item.id)).toEqual([
      'inbox',
    ]);
  });

  it('can show a completed inbox item without touching scheduled tasks', () => {
    const completedInbox = task({ id: 'old', name: 'Old idea', isUnscheduled: true, status: 'completed' });
    const listed = filterUnscheduledTasks(
      [completedInbox, flexible],
      { query: '', status: 'completed', overdueOnly: false },
      now,
    );
    expect(listed.map((item) => item.id)).toEqual(['old']);
  });
});

describe('filterScheduledTasks', () => {
  const open = {
    query: '',
    status: 'active' as const,
    overdueOnly: false,
    phaseId: 'any',
    mode: 'any' as const,
  };

  it('drops unscheduled and completed tasks from the active list', () => {
    expect(filterScheduledTasks(tasks, open, now).map((item) => item.id)).toEqual([
      'flex',
      'fixed',
      'series',
      'late',
    ]);
  });

  it('filters by name, phase, schedule type, and overdue together', () => {
    expect(filterScheduledTasks(tasks, { ...open, query: 'write' }, now).map((item) => item.id)).toEqual(['flex']);
    expect(filterScheduledTasks(tasks, { ...open, phaseId: 'focus' }, now).map((item) => item.id)).toEqual(['flex']);
    expect(filterScheduledTasks(tasks, { ...open, phaseId: 'none' }, now).map((item) => item.id)).toEqual([
      'fixed',
      'series',
      'late',
    ]);
    expect(filterScheduledTasks(tasks, { ...open, mode: 'fixed' }, now).map((item) => item.id)).toEqual(['fixed']);
    expect(filterScheduledTasks(tasks, { ...open, mode: 'recurring' }, now).map((item) => item.id)).toEqual([
      'series',
    ]);
    expect(filterScheduledTasks(tasks, { ...open, mode: 'flexible' }, now).map((item) => item.id)).toEqual([
      'flex',
      'late',
    ]);
    expect(filterScheduledTasks(tasks, { ...open, overdueOnly: true }, now).map((item) => item.id)).toEqual(['late']);
  });

  it('does not treat a completed task with a past deadline as overdue', () => {
    const closed = task({
      id: 'closed',
      name: 'Paid',
      status: 'completed',
      deadline: '2026-09-01T12:00:00.000Z',
    });
    expect(
      filterScheduledTasks([closed], { ...open, status: 'all', overdueOnly: true }, now),
    ).toEqual([]);
  });
});
