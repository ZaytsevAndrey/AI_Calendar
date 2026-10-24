import { overdueDayCount, overdueTone } from './overdue';

describe('day reminder overdue tone', () => {
  it('stays quiet on the due day and deepens after a week', () => {
    expect(overdueDayCount('2026-10-24', '2026-10-24')).toBe(0);
    expect(overdueTone(0)).toBe('none');
    expect(overdueTone(1)).toBe('mild');
    expect(overdueTone(3)).toBe('mid');
    expect(overdueTone(7)).toBe('strong');
  });
});
