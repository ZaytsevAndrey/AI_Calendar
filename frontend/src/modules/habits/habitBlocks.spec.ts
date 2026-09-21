import type { HabitDTO } from '../../api/habits.api';
import { habitBlockChips, isHabitGoogleEvent } from './habitBlocks';

function habit(partial: Partial<HabitDTO>): HabitDTO {
  return {
    id: 'h1',
    name: 'Exercise',
    color: '#22c55e',
    description: null,
    checkedToday: false,
    currentStreak: 0,
    points: 0,
    totalCheckIns: 0,
    checkInDates: [],
    blockStartTime: '09:00',
    blockMinutes: 30,
    googleEventId: null,
    createdAt: '',
    updatedAt: '',
    ...partial,
  };
}

describe('habitBlockChips', () => {
  const day = new Date(2026, 3, 20);

  it('builds one chip per reserved habit per visible day', () => {
    const chips = habitBlockChips([habit({})], [day], 'UTC');
    expect(chips).toHaveLength(1);
    expect(chips[0]).toMatchObject({
      id: 'h1:2026-04-20',
      ymd: '2026-04-20',
      startMinutes: 9 * 60,
      done: false,
    });
    expect(chips[0].start.toISOString()).toBe('2026-04-20T09:00:00.000Z');
  });

  it('marks the chip done when that day is checked in', () => {
    const chips = habitBlockChips(
      [habit({ checkInDates: ['2026-04-20'] })],
      [day],
      'UTC',
    );
    expect(chips[0].done).toBe(true);
  });

  it('treats a habit series and its instances as the same Google event', () => {
    const ids = new Set(['series-1']);
    expect(isHabitGoogleEvent(ids, { id: 'occ-1', recurringEventId: 'series-1' })).toBe(true);
    expect(isHabitGoogleEvent(ids, { id: 'other' })).toBe(false);
  });

  it('still draws an in-app chip when the block is also on Google', () => {
    const chips = habitBlockChips(
      [habit({ googleEventId: 'series-1' })],
      [day],
      'UTC',
    );
    expect(chips).toHaveLength(1);
    expect(chips[0].startMinutes).toBe(9 * 60);
  });

  it('skips check-in-only habits', () => {
    expect(
      habitBlockChips([habit({ blockStartTime: null, blockMinutes: null })], [day], 'UTC'),
    ).toEqual([]);
  });
});
