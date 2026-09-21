import { habitBlockIntervals } from './habit-blocks.util';

describe('habitBlockIntervals', () => {
  const habits = [{ blockStartTime: '09:00', blockMinutes: 60 }];

  it('reserves the same clock time on each day in the window', () => {
    expect(habitBlockIntervals(habits, '2026-04-20', '2026-04-22', 'UTC')).toEqual([
      {
        start: Date.parse('2026-04-20T09:00:00.000Z'),
        end: Date.parse('2026-04-20T10:00:00.000Z'),
      },
      {
        start: Date.parse('2026-04-21T09:00:00.000Z'),
        end: Date.parse('2026-04-21T10:00:00.000Z'),
      },
    ]);
  });

  it('ignores habits that are check-ins only', () => {
    expect(
      habitBlockIntervals(
        [
          { blockStartTime: null, blockMinutes: null },
          { blockStartTime: '09:00', blockMinutes: null },
          { blockStartTime: null, blockMinutes: 30 },
        ],
        '2026-04-20',
        '2026-04-21',
        'UTC',
      ),
    ).toEqual([]);
  });

  it('returns nothing for an empty day range', () => {
    expect(habitBlockIntervals(habits, '2026-04-20', '2026-04-20', 'UTC')).toEqual([]);
  });
});
