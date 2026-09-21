import { findTaskForGoogleEvent } from './findTaskForGoogleEvent';
import type { TaskDTO } from '../../api/tasks.api';

function task(partial: Partial<TaskDTO> & Pick<TaskDTO, 'id' | 'name'>): TaskDTO {
  return {
    estimatedTimeInMinutes: 30,
    isRecurring: false,
    allowSplit: true,
    priority: 'medium',
    status: 'todo',
    createdAt: '',
    updatedAt: '',
    ...partial,
  };
}

describe('findTaskForGoogleEvent', () => {
  it('matches by event id or recurring master id', () => {
    const linked = task({ id: 't1', name: 'Gym', googleEventId: 'series-1' });
    expect(findTaskForGoogleEvent([linked], { id: 'occ-9', recurringEventId: 'series-1' })?.id).toBe(
      't1',
    );
    expect(findTaskForGoogleEvent([linked], { id: 'series-1' })?.id).toBe('t1');
    expect(findTaskForGoogleEvent([linked], { id: 'other' })).toBeUndefined();
  });

  it('ignores tasks without a googleEventId', () => {
    const orphan = task({ id: 't2', name: 'Notes' });
    expect(findTaskForGoogleEvent([orphan], { id: 'series-1' })).toBeUndefined();
  });
});
