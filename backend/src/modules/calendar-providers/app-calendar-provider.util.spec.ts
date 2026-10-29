import { resolveAppCalendarProvider } from './app-calendar-provider.util';
import {
  buildVEventIcs,
  graphRecurrenceFromRules,
  toGraphEventBody,
} from './app-event-body';

describe('resolveAppCalendarProvider', () => {
  const none = {
    googleLinked: false,
    microsoftConnected: false,
    appleConnected: false,
  };

  it('keeps the stored account while connected', () => {
    expect(
      resolveAppCalendarProvider({
        stored: 'microsoft',
        googleLinked: true,
        microsoftConnected: true,
        appleConnected: true,
      }),
    ).toBe('microsoft');
  });

  it('falls back when the stored account is gone', () => {
    expect(
      resolveAppCalendarProvider({
        stored: 'microsoft',
        googleLinked: true,
        microsoftConnected: false,
        appleConnected: true,
      }),
    ).toBe('google');
  });

  it('picks Microsoft when that is the only link', () => {
    expect(
      resolveAppCalendarProvider({
        ...none,
        microsoftConnected: true,
      }),
    ).toBe('microsoft');
  });

  it('returns null when nothing is connected', () => {
    expect(resolveAppCalendarProvider(none)).toBeNull();
  });
});

describe('toGraphEventBody', () => {
  it('maps a weekly series with an end date', () => {
    const body = toGraphEventBody({
      summary: 'Focus',
      start: { dateTime: '2026-10-19T09:00:00.000Z', timeZone: 'Europe/Kyiv' },
      end: { dateTime: '2026-10-19T10:00:00.000Z', timeZone: 'Europe/Kyiv' },
      recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261116T090000Z'],
    });
    expect(body.subject).toBe('Focus');
    expect(body.recurrence).toEqual({
      pattern: {
        type: 'weekly',
        interval: 1,
        daysOfWeek: ['monday', 'wednesday'],
        firstDayOfWeek: 'sunday',
      },
      range: {
        type: 'endDate',
        startDate: '2026-10-19',
        endDate: '2026-11-16',
        recurrenceTimeZone: 'Europe/Kyiv',
      },
    });
  });

  it('leaves a one-off without recurrence', () => {
    expect(
      graphRecurrenceFromRules(undefined, '2026-10-19T09:00:00.000Z', 'UTC'),
    ).toBeUndefined();
  });
});

describe('buildVEventIcs', () => {
  it('includes the title and RRULE', () => {
    const ics = buildVEventIcs(
      {
        summary: 'Read',
        start: { dateTime: '2026-10-19T09:00:00.000Z' },
        end: { dateTime: '2026-10-19T09:30:00.000Z' },
        recurrence: ['RRULE:FREQ=DAILY;UNTIL=20261101T090000Z'],
      },
      'uid-1',
    );
    expect(ics).toContain('SUMMARY:Read');
    expect(ics).toContain('RRULE:FREQ=DAILY;UNTIL=20261101T090000Z');
  });
});
