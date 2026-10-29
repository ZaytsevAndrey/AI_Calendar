import type { TaskDTO } from 'api/tasks.api';
import { groupProblematicByDay, problematicItems } from './problematicItems';

function task(partial: Partial<TaskDTO> & Pick<TaskDTO, 'id' | 'name'>): TaskDTO {
  return {
    eventType: 'admin',
    estimatedTimeInMinutes: 30,
    isRecurring: false,
    isUnscheduled: false,
    scheduleState: 'problematic',
    status: 'todo',
    priority: 'medium',
    allowSplit: false,
    createdAt: '',
    updatedAt: '',
    ...partial,
  } as TaskDTO;
}

describe('problematicItems', () => {
  const today = '2026-10-29';

  it('gives one card per parked series day and drops past days', () => {
    const series = task({
      id: 's',
      name: 'Gym',
      isRecurring: true,
      problematicOccurrenceYmds: ['2026-10-28', '2026-10-30', '2026-10-31'],
    });
    expect(problematicItems([series], {}, today).map((i) => [i.ymd, i.kind])).toEqual([
      ['2026-10-30', 'seriesDay'],
      ['2026-10-31', 'seriesDay'],
    ]);
  });

  it('tells a series copy from a plain task and a series with no day', () => {
    const items = problematicItems(
      [
        task({ id: 'c', name: 'Copy', parentSeriesId: 's', problematicDay: '2026-10-30' }),
        task({ id: 'o', name: 'Call', problematicDay: '2026-10-30' }),
        task({ id: 'n', name: 'Series', isRecurring: true }),
      ],
      {},
      today,
    );
    expect(items.map((i) => [i.key, i.kind, i.ymd])).toEqual([
      ['c', 'seriesCopy', '2026-10-30'],
      ['o', 'oneOff', '2026-10-30'],
      ['n:none', 'seriesNoDay', null],
    ]);
  });

  it('uses job hints when the task has no day yet', () => {
    const items = problematicItems(
      [task({ id: 'o', name: 'Call' })],
      { o: { occurrenceYmds: ['2026-11-02'], reason: 'no_slot' } },
      today,
    );
    expect(items[0].ymd).toBe('2026-11-02');
  });
});

describe('groupProblematicByDay', () => {
  it('orders days and puts cards with no day last', () => {
    const items = problematicItems(
      [
        task({ id: 'b', name: 'B', problematicDay: '2026-11-01' }),
        task({ id: 'n', name: 'N', isRecurring: true }),
        task({ id: 'a', name: 'A', problematicDay: '2026-10-30' }),
        task({ id: 'c', name: 'C', problematicDay: '2026-10-30' }),
      ],
      {},
      '2026-10-29',
    );
    expect(
      groupProblematicByDay(items).map((g) => [g.ymd, g.items.map((i) => i.task.id)]),
    ).toEqual([
      ['2026-10-30', ['a', 'c']],
      ['2026-11-01', ['b']],
      [null, ['n']],
    ]);
  });
});
