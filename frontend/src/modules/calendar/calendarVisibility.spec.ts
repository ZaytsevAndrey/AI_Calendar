import {
  calendarHideKey,
  calendarVisibilityRows,
  isCalendarVisible,
  nextHiddenCalendarIds,
} from './calendarVisibility';

const items = [
  {
    id: 'user@gmail.com',
    summary: 'Andrii',
    primary: true,
    selected: true,
    accessRole: 'owner',
    provider: 'google' as const,
  },
  {
    id: 'app@group.calendar.google.com',
    summary: 'luefy',
    selected: true,
    accessRole: 'owner',
    provider: 'google' as const,
  },
  {
    id: 'holidays@group.v.calendar.google.com',
    summary: 'Holidays',
    selected: true,
    accessRole: 'reader',
    provider: 'google' as const,
  },
  {
    id: 'birthdays@group.v.calendar.google.com',
    summary: 'Birthdays',
    selected: false,
    accessRole: 'reader',
    provider: 'google' as const,
  },
  {
    id: 'ms-cal-1',
    summary: 'Outlook',
    primary: true,
    selected: true,
    provider: 'microsoft' as const,
  },
];

describe('calendarVisibilityRows', () => {
  it('lists selected calendars and keeps the app calendar checked', () => {
    const rows = calendarVisibilityRows({
      items,
      hiddenIds: ['holidays@group.v.calendar.google.com'],
      appCalendarId: 'app@group.calendar.google.com',
      appCalendarName: 'luefy',
    });

    expect(rows.find((row) => row.id === 'app@group.calendar.google.com')).toMatchObject({
      checked: true,
      disabled: true,
      provider: 'google',
    });
    expect(rows.find((row) => row.id === 'holidays@group.v.calendar.google.com')).toMatchObject({
      checked: false,
      disabled: false,
    });
    expect(rows.find((row) => row.id === 'user@gmail.com')?.checked).toBe(true);
    expect(rows.some((row) => row.id === 'birthdays@group.v.calendar.google.com')).toBe(false);
    expect(rows.find((row) => row.id === 'microsoft:ms-cal-1')).toMatchObject({
      checked: true,
      provider: 'microsoft',
      label: 'Outlook',
    });
  });
});

describe('calendarHideKey / isCalendarVisible', () => {
  it('uses composite keys for non-Google providers', () => {
    expect(calendarHideKey('google', 'primary')).toBe('primary');
    expect(calendarHideKey('microsoft', 'abc')).toBe('microsoft:abc');
    expect(isCalendarVisible('microsoft', 'abc', ['microsoft:abc'])).toBe(false);
    expect(isCalendarVisible('microsoft', 'abc', [])).toBe(true);
    expect(isCalendarVisible('google', 'primary', ['primary'])).toBe(false);
  });
});

describe('nextHiddenCalendarIds', () => {
  it('hides a calendar and refuses to hide the app calendar', () => {
    expect(
      nextHiddenCalendarIds(
        [],
        'holidays@group.v.calendar.google.com',
        false,
        'app@group.calendar.google.com',
      ),
    ).toEqual(['holidays@group.v.calendar.google.com']);
    expect(
      nextHiddenCalendarIds(
        ['holidays@group.v.calendar.google.com'],
        'app@group.calendar.google.com',
        false,
        'app@group.calendar.google.com',
      ),
    ).toEqual(['holidays@group.v.calendar.google.com']);
  });

  it('shows a calendar again by removing its id', () => {
    expect(
      nextHiddenCalendarIds(
        ['holidays@group.v.calendar.google.com'],
        'holidays@group.v.calendar.google.com',
        true,
      ),
    ).toEqual([]);
  });
});
