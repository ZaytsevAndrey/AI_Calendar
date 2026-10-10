import type { TaskDTO } from '../../../api/tasks.api';
import { groupTasksBySeriesGroup, seriesMemberKind } from './groupTasksBySeriesGroup';

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

describe('seriesMemberKind', () => {
  it('classifies recurring, problematic, and one-off members', () => {
    expect(seriesMemberKind({ isRecurring: true, scheduleState: 'none' })).toBe('series');
    expect(seriesMemberKind({ isRecurring: false, scheduleState: 'problematic' })).toBe('problematic');
    expect(seriesMemberKind({ isRecurring: false, scheduleState: 'resolved' })).toBe('oneOff');
  });
});

describe('groupTasksBySeriesGroup', () => {
  it('keeps unrelated tasks as single rows', () => {
    const a = task({ id: 'a', name: 'Solo' });
    const b = task({ id: 'b', name: 'Also solo', seriesGroupId: null });
    expect(groupTasksBySeriesGroup([a, b])).toEqual([
      { kind: 'single', task: a },
      { kind: 'single', task: b },
    ]);
  });

  it('does not wrap a lone seriesGroupId member in a group', () => {
    const only = task({ id: 'g1', name: 'Workout', seriesGroupId: 'g1', isRecurring: true });
    expect(groupTasksBySeriesGroup([only])).toEqual([{ kind: 'single', task: only }]);
  });

  it('groups siblings that share seriesGroupId and picks the primary title', () => {
    const primary = task({ id: 'g1', name: 'Workout', seriesGroupId: 'g1', isRecurring: true });
    const sibling = task({
      id: 'g1-b',
      name: 'Workout evening',
      seriesGroupId: 'g1',
      isRecurring: true,
    });
    const oneOff = task({
      id: 'g1-c',
      name: 'Workout',
      seriesGroupId: 'g1',
      parentSeriesId: 'g1',
      scheduleState: 'problematic',
    });
    const other = task({ id: 'x', name: 'Other' });

    expect(groupTasksBySeriesGroup([primary, other, sibling, oneOff])).toEqual([
      {
        kind: 'group',
        seriesGroupId: 'g1',
        title: 'Workout',
        members: [
          { task: primary, memberKind: 'series' },
          { task: sibling, memberKind: 'series' },
          { task: oneOff, memberKind: 'problematic' },
        ],
      },
      { kind: 'single', task: other },
    ]);
  });

  it('uses the first recurring name when id does not match seriesGroupId', () => {
    const a = task({ id: 'a', name: 'Tail', seriesGroupId: 'g9', isRecurring: true });
    const b = task({ id: 'b', name: 'Detached', seriesGroupId: 'g9' });
    const grouped = groupTasksBySeriesGroup([b, a]);
    expect(grouped).toEqual([
      {
        kind: 'group',
        seriesGroupId: 'g9',
        title: 'Tail',
        members: [
          { task: b, memberKind: 'oneOff' },
          { task: a, memberKind: 'series' },
        ],
      },
    ]);
  });
});
