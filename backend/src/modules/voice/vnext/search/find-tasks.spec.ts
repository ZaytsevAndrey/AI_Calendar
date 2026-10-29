import { TaskStatus, type Task } from '../../../tasks/entities/task.entity';
import type { ScheduledTask } from '../../../schedule/schedule.entity';
import { FIND_TASKS_CAP, findTasks } from './find-tasks';

const USER = 'u1';
const TZ = 'Europe/Kyiv';

function task(id: string, name: string, extra: Partial<Task> = {}): Task {
  return { id, userId: USER, name, status: TaskStatus.TODO, isRecurring: false, googleEventCalendarId: null, ...extra } as Task;
}

function slot(taskId: string, start: string, calendar: string | null = null): ScheduledTask {
  return { id: `s-${taskId}-${start}`, taskId, scheduledStartTime: new Date(start), scheduledEndTime: new Date(start), googleEventCalendarId: calendar } as ScheduledTask;
}

const TASKS = [
  task('a', 'Team sync'),
  task('b', 'Standup'),
  task('c', 'Gym'),
  task('d', 'Sync done', { status: TaskStatus.COMPLETED }),
  task('e', 'Later sync'),
  task('x', 'Other user sync', { userId: 'u2' }),
];
const SLOTS = [
  slot('a', '2026-10-19T07:00:00.000Z', 'work'),
  slot('b', '2026-10-19T08:00:00.000Z'),
  slot('c', '2026-10-20T08:00:00.000Z'),
  // A second slot of b on another day: day filters look at every slot, not the first.
  slot('b', '2026-10-21T08:00:00.000Z'),
  slot('d', '2026-10-19T09:00:00.000Z'),
];

const run = (args: Record<string, unknown>) => findTasks({ userId: USER, timeZone: TZ, tasks: TASKS, slots: SLOTS }, args);

describe('find_tasks', () => {
  it('returns the complete set of open owned tasks for a day, checking every slot', () => {
    expect(run({ day: '2026-10-19' }).receipt).toEqual({ complete: true, ids: ['a', 'b'] });
    expect(run({ day: '2026-10-21' }).receipt.ids).toEqual(['b']);
    expect(run({ from: '2026-10-19', to: '2026-10-20' }).receipt.ids).toEqual(['a', 'b', 'c']);
  });

  it('applies literal name, calendar, and scheduled filters', () => {
    expect(run({ nameContains: 'SYNC' }).receipt.ids).toEqual(['a', 'e']);
    expect(run({ calendarId: 'work' }).receipt.ids).toEqual(['a']);
    expect(run({ scheduled: false }).receipt.ids).toEqual(['e']);
  });

  it('rejects a search with no filter or a malformed one instead of returning everything', () => {
    expect(run({}).result).toEqual({ error: 'no_filter' });
    expect(run({ day: 'monday' }).result).toEqual({ error: 'invalid_day' });
    expect(run({ day: '2026-10-19', from: '2026-10-19' }).result).toEqual({ error: 'day_with_range' });
    expect(run({}).receipt.complete).toBe(false);
  });

  it('marks an oversized set truncated, not complete', () => {
    const many = Array.from({ length: FIND_TASKS_CAP + 1 }, (_, index) => task(`t${index}`, `Call ${index}`));
    const found = findTasks({ userId: USER, timeZone: TZ, tasks: many, slots: [] }, { nameContains: 'call' });
    expect(found.receipt.complete).toBe(false);
    expect(found.receipt.truncated).toBe(true);
    expect(found.result).toMatchObject({ complete: false, truncated: true, total: FIND_TASKS_CAP + 1 });
  });
});
