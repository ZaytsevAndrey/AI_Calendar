import { orderYmdRange, ymdInRange } from './dateRange';

describe('orderYmdRange', () => {
  it('keeps a forward range and swaps a backward click', () => {
    expect(orderYmdRange('2026-10-24', '2026-10-26')).toEqual({
      start: '2026-10-24',
      end: '2026-10-26',
    });
    expect(orderYmdRange('2026-10-26', '2026-10-24')).toEqual({
      start: '2026-10-24',
      end: '2026-10-26',
    });
  });

  it('treats one day as a closed range', () => {
    expect(orderYmdRange('2026-10-24', '2026-10-24')).toEqual({
      start: '2026-10-24',
      end: '2026-10-24',
    });
    expect(ymdInRange('2026-10-24', '2026-10-24', '2026-10-24')).toBe(true);
    expect(ymdInRange('2026-10-25', '2026-10-24', '2026-10-26')).toBe(true);
    expect(ymdInRange('2026-10-27', '2026-10-24', '2026-10-26')).toBe(false);
  });
});

describe('addDaysYmd', () => {
    it('crosses months and years', () => {
        const { addDaysYmd } = require('./dateRange');
        expect(addDaysYmd('2026-10-30', 3)).toBe('2026-11-02');
        expect(addDaysYmd('2026-12-31', 1)).toBe('2027-01-01');
        expect(addDaysYmd('2026-03-01', -1)).toBe('2026-02-28');
    });
});
