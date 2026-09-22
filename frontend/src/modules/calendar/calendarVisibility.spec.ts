import { calendarVisibilityRows, nextHiddenCalendarIds } from './calendarVisibility';

const items = [
  { id: 'user@gmail.com', summary: 'Andrii', primary: true, selected: true, accessRole: 'owner' },
  {
    id: 'app@group.calendar.google.com',
    summary: 'AI Calendar Assistant',
    selected: true,
    accessRole: 'owner',
  },
  {
    id: 'holidays@group.v.calendar.google.com',
    summary: 'Holidays',
    selected: true,
    accessRole: 'reader',
  },
  {
    id: 'birthdays@group.v.calendar.google.com',
    summary: 'Birthdays',
    selected: false,
    accessRole: 'reader',
  },
];

describe('calendarVisibilityRows', () => {
  it('lists selected calendars and keeps the app calendar checked', () => {
    const rows = calendarVisibilityRows({
      items,
      hiddenIds: ['holidays@group.v.calendar.google.com'],
      appCalendarId: 'app@group.calendar.google.com',
      appCalendarName: 'AI Calendar Assistant',
    });

    expect(rows.find((row) => row.id === 'app@group.calendar.google.com')).toMatchObject({
      checked: true,
      disabled: true,
    });
    expect(rows.find((row) => row.id === 'holidays@group.v.calendar.google.com')).toMatchObject({
      checked: false,
      disabled: false,
    });
    expect(rows.find((row) => row.id === 'user@gmail.com')?.checked).toBe(true);
    expect(rows.some((row) => row.id === 'birthdays@group.v.calendar.google.com')).toBe(false);
  });
});

describe('nextHiddenCalendarIds', () => {
  it('hides a calendar and refuses to hide the app calendar', () => {
    expect(
      nextHiddenCalendarIds([], 'holidays@group.v.calendar.google.com', false, 'app@group.calendar.google.com'),
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
