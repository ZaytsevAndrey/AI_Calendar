import { buildGoogleRecurrenceRules, setRruleUntil, toRruleUntilUtc } from './google-recurrence.util';

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
    ).toEqual([`RRULE:FREQ=MONTHLY;BYMONTHDAY=7;UNTIL=${toRruleUntilUtc(last)}`]);
  });

  it('PE-09 MONTHLY from the 31st falls back to the month end like the local days', () => {
    const first = new Date('2027-02-28T09:00:00.000Z');
    const last = new Date('2027-05-31T09:00:00.000Z');
    expect(
      buildGoogleRecurrenceRules({
        pattern: 'MONTHLY',
        firstStart: first,
        lastStart: last,
        anchorStart: new Date('2027-01-31T09:00:00.000Z'),
        timeZone: 'UTC',
      }),
    ).toEqual([
      `RRULE:FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1;UNTIL=${toRruleUntilUtc(last)}`,
    ]);
  });

  it('PE-25 reads the fallback weekday in the user zone, not the server zone', () => {
    // Mon 00:30 in Kyiv is still Sunday in UTC.
    const first = new Date('2026-11-01T22:30:00.000Z');
    const last = new Date('2026-11-22T22:30:00.000Z');
    expect(
      buildGoogleRecurrenceRules({
        pattern: 'WEEKLY',
        firstStart: first,
        lastStart: last,
        timeZone: 'Europe/Kyiv',
      }),
    ).toEqual([`RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=${toRruleUntilUtc(last)}`]);
  });

  it('replaces or appends UNTIL on an existing RRULE', () => {
    const until = new Date('2026-04-20T09:00:00.000Z');
    expect(setRruleUntil('RRULE:FREQ=DAILY', until)).toBe(
      `RRULE:FREQ=DAILY;UNTIL=${toRruleUntilUtc(until)}`,
    );
    expect(
      setRruleUntil('RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20260101T000000Z', until),
    ).toBe(`RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=${toRruleUntilUtc(until)}`);
  });

  it('appends EXDATE for skipped occurrence starts', () => {
    const first = new Date('2026-09-21T06:00:00.000Z');
    const last = new Date('2026-09-25T06:00:00.000Z');
    const skipped = new Date('2026-09-23T06:00:00.000Z');
    expect(
      buildGoogleRecurrenceRules({
        pattern: 'DAILY',
        firstStart: first,
        lastStart: last,
        excludeStarts: [skipped],
      }),
    ).toEqual([
      `RRULE:FREQ=DAILY;UNTIL=${toRruleUntilUtc(last)}`,
      `EXDATE:${toRruleUntilUtc(skipped)}`,
    ]);
  });
});
