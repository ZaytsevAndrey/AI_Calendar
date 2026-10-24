import {
  addDays,
  nextDueYmd,
  notificationWindow,
  overdueDays,
} from './day-reminder.dates';

describe('day reminder dates', () => {
  it('counts overdue civil days and stays at zero on the due day', () => {
    expect(overdueDays('2026-10-24', '2026-10-24')).toBe(0);
    expect(overdueDays('2026-10-24', '2026-10-25')).toBe(1);
    expect(overdueDays('2026-10-20', '2026-10-27')).toBe(7);
    expect(overdueDays('2026-10-30', '2026-10-24')).toBe(0);
  });

  it('steps daily, weekly, and biweekly from the open day', () => {
    expect(nextDueYmd({ dueYmd: '2026-10-24', pattern: 'DAILY' })).toBe('2026-10-25');
    expect(nextDueYmd({ dueYmd: '2026-10-24', pattern: 'BIWEEKLY' })).toBe('2026-11-07');
    expect(
      nextDueYmd({ dueYmd: '2026-10-24', pattern: 'WEEKLY', weekDays: [6] }),
    ).toBe('2026-10-31');
    expect(nextDueYmd({ dueYmd: '2026-10-24', pattern: 'WEEKLY' })).toBe('2026-10-31');
  });

  it('puts a 31st on the last day of a shorter month', () => {
    expect(
      nextDueYmd({ dueYmd: '2026-01-31', pattern: 'MONTHLY', monthDay: 31 }),
    ).toBe('2026-02-28');
    expect(
      nextDueYmd({ dueYmd: '2026-02-28', pattern: 'MONTHLY', monthDay: 31 }),
    ).toBe('2026-03-31');
  });

  it('keeps a 15-minute window and rolls past midnight', () => {
    expect(notificationWindow('2026-10-24', '09:00')).toEqual({
      startDateTime: '2026-10-24T09:00:00',
      endDateTime: '2026-10-24T09:15:00',
    });
    expect(notificationWindow('2026-10-24', '23:50')).toEqual({
      startDateTime: '2026-10-24T23:50:00',
      endDateTime: '2026-10-25T00:05:00',
    });
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});
