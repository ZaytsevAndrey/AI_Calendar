import { quickWindows } from './quickWindows';

describe('quickWindows', () => {
  it('uses the Settings day and ends the week on Sunday', () => {
    // 21:30 UTC Wed 28 Oct is already Thu 29 Oct in Nicosia.
    const [today, tomorrow, week] = quickWindows('2026-10-28T22:30:00.000Z', 'Asia/Nicosia');
    expect(today).toEqual({ id: 'today', start: '2026-10-29', end: '2026-10-29' });
    expect(tomorrow).toEqual({ id: 'tomorrow', start: '2026-10-30', end: '2026-10-30' });
    expect(week).toEqual({ id: 'thisWeek', start: '2026-10-29', end: '2026-11-01' });
  });

  it('on Sunday this week is just today', () => {
    const week = quickWindows('2026-11-01T09:00:00.000Z', 'UTC')[2];
    expect(week).toEqual({ id: 'thisWeek', start: '2026-11-01', end: '2026-11-01' });
  });
});
