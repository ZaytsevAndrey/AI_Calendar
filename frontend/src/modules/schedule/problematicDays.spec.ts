import type { TaskDTO } from 'api/tasks.api';
import {
  isActiveProblematicTask,
  remainingProblematicDays,
} from './problematicDays';

function task(partial: Partial<TaskDTO>): TaskDTO {
  return {
    id: 't1',
    name: 'Parked',
    scheduleState: 'problematic',
    status: 'todo',
    isRecurring: false,
    estimatedTimeInMinutes: 30,
    ...partial,
  } as TaskDTO;
}

describe('problematicDays', () => {
  it('keeps today and future park days only', () => {
    expect(
      remainingProblematicDays(
        task({
          problematicOccurrenceYmds: ['2026-10-07', '2026-10-09', '2026-10-10'],
        }),
        undefined,
        '2026-10-09',
      ),
    ).toEqual(['2026-10-09', '2026-10-10']);
  });

  it('hides tasks whose park days are all in the past', () => {
    expect(
      isActiveProblematicTask(
        task({
          problematicDay: '2026-10-07',
          problematicOccurrenceYmds: ['2026-10-07'],
        }),
        '2026-10-09',
      ),
    ).toBe(false);
  });

  it('keeps problematic tasks with no day metadata', () => {
    expect(isActiveProblematicTask(task({}), '2026-10-09')).toBe(true);
  });
});
