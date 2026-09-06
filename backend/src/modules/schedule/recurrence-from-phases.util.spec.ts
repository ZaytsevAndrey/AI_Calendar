import {
  effectiveRecurrenceWeekDays,
  normalizeWeekDays,
} from './recurrence-from-phases.util';
import { Phase } from '../phases/entities/phase.entity';

function phase(weekDays: number[] | null): Phase {
  return { weekDays } as Phase;
}

describe('normalizeWeekDays', () => {
  it('treats all seven days as no restriction', () => {
    expect(normalizeWeekDays([0, 1, 2, 3, 4, 5, 6])).toBeNull();
  });

  it('dedupes and sorts', () => {
    expect(normalizeWeekDays([3, 1, 1])).toEqual([1, 3]);
  });
});

describe('effectiveRecurrenceWeekDays', () => {
  it('intersects task days with phase days', () => {
    expect(effectiveRecurrenceWeekDays([1, 2, 6], [phase([1, 2, 3, 4, 5])])).toEqual([
      1, 2,
    ]);
  });

  it('returns empty when there is no overlap', () => {
    expect(effectiveRecurrenceWeekDays([0, 6], [phase([1, 2, 3, 4, 5])])).toEqual([]);
  });
});
