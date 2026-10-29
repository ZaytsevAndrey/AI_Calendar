import type { TaskDTO } from 'api/tasks.api';
import { autoSeatedFromPark, markProblematicHandled } from './problematicSeatWatch';

const row = (id: string, partial: Partial<TaskDTO>): TaskDTO =>
  ({ id, name: id, scheduleState: 'none', ...partial }) as TaskDTO;

describe('autoSeatedFromPark', () => {
  it('reports parked tasks that came back with a slot', () => {
    const seated = autoSeatedFromPark(new Set(['a', 'b', 'c']), [
      row('a', { scheduledStartTime: '2026-10-30T10:00:00.000Z' }),
      row('b', { scheduleState: 'problematic' }),
      row('c', {}),
      row('d', { scheduledStartTime: '2026-10-30T11:00:00.000Z' }),
    ]);
    expect(seated.map((task) => task.id)).toEqual(['a']);
  });

  it('stays quiet once for a task the user placed', () => {
    markProblematicHandled('a');
    const tasks = [row('a', { scheduledStartTime: '2026-10-30T10:00:00.000Z' })];
    expect(autoSeatedFromPark(new Set(['a']), tasks)).toEqual([]);
    expect(autoSeatedFromPark(new Set(['a']), tasks).map((task) => task.id)).toEqual(['a']);
  });
});
