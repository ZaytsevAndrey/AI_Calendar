import { layoutAllDay } from './allDayLayout';

const ev = (id: string, start: string, end: string) => ({ id, start: { date: start }, end: { date: end } });
const week = Array.from({ length: 7 }, (_, i) => new Date(2026, 9, 26 + i));

describe('layoutAllDay', () => {
  it('spans a multi-day event across the days it covers, end date exclusive', () => {
    const [bar] = layoutAllDay([ev('a', '2026-10-30', '2026-11-03')], week);
    expect(bar).toMatchObject({ from: 4, to: 6, row: 0 });
  });

  it('clips to the visible days and stacks overlaps', () => {
    const bars = layoutAllDay(
      [ev('a', '2026-10-20', '2026-10-28'), ev('b', '2026-10-27', '2026-10-28'), ev('c', '2026-10-29', '2026-10-30')],
      week,
    );
    expect(bars.map((b) => [b.event.id, b.from, b.to, b.row])).toEqual([
      ['a', 0, 1, 0],
      ['b', 1, 1, 1],
      ['c', 3, 3, 0],
    ]);
  });

  it('skips events outside the view', () => {
    expect(layoutAllDay([ev('a', '2026-11-05', '2026-11-06')], week)).toEqual([]);
  });
});
