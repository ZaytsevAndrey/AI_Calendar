import { buildGoogleRecurrenceRules, toRruleUntilUtc } from './google-recurrence.util';

describe('google-recurrence.util', () => {
  it('formats UNTIL in UTC compact form', () => {
    expect(toRruleUntilUtc(new Date('2026-10-05T06:00:00.000Z'))).toBe(
      '20261005T060000Z',
    );
  });

  it('builds DAILY without weekday restriction', () => {
    const first = new Date(2026, 8, 7, 9, 0, 0);
    const last = new Date(2026, 9, 5, 9, 0, 0);
    expect(
      buildGoogleRecurrenceRules({
        pattern: 'DAILY',
        firstStart: first,
        lastStart: last,
      }),
    ).toEqual([`RRULE:FREQ=DAILY;UNTIL=${toRruleUntilUtc(last)}`]);
  });

  it('maps DAILY + Mon–Fri phases to WEEKLY BYDAY', () => {
    const first = new Date(2026, 8, 7, 9, 0, 0);
    const last = new Date(2026, 9, 5, 9, 0, 0);
    expect(
      buildGoogleRecurrenceRules({
        pattern: 'DAILY',
        firstStart: first,
        lastStart: last,
        weekDays: [1, 2, 3, 4, 5],
      }),
    ).toEqual([`RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;UNTIL=${toRruleUntilUtc(last)}`]);
  });

  it('builds WEEKLY from the first occurrence weekday', () => {
    const first = new Date(2026, 8, 7, 9, 0, 0);
    const last = new Date(2026, 9, 5, 9, 0, 0);
    expect(first.getDay()).toBe(1);
    expect(
      buildGoogleRecurrenceRules({
        pattern: 'WEEKLY',
        firstStart: first,
        lastStart: last,
      }),
    ).toEqual([`RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=${toRruleUntilUtc(last)}`]);
  });

  it('builds BIWEEKLY with INTERVAL=2', () => {
    const first = new Date(2026, 8, 7, 9, 0, 0);
    const last = new Date(2026, 9, 5, 9, 0, 0);
    expect(
      buildGoogleRecurrenceRules({
        pattern: 'BIWEEKLY',
        firstStart: first,
        lastStart: last,
      }),
    ).toEqual([
      `RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;UNTIL=${toRruleUntilUtc(last)}`,
    ]);
  });

  it('builds MONTHLY', () => {
    const first = new Date(2026, 8, 7, 9, 0, 0);
    const last = new Date(2026, 9, 5, 9, 0, 0);
    expect(
      buildGoogleRecurrenceRules({
        pattern: 'MONTHLY',
        firstStart: first,
        lastStart: last,
      }),
    ).toEqual([`RRULE:FREQ=MONTHLY;UNTIL=${toRruleUntilUtc(last)}`]);
  });
});
