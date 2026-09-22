import { displayCalendarIds } from './display-calendar-ids.util';

const items = [
  { id: 'user@gmail.com', primary: true, selected: true, accessRole: 'owner' },
  { id: 'app@group.calendar.google.com', selected: true, accessRole: 'owner' },
  { id: 'holidays@group.v.calendar.google.com', selected: true, accessRole: 'reader' },
  { id: 'hidden-in-google@group.calendar.google.com', selected: false, accessRole: 'reader' },
  { id: 'freebusy@group.calendar.google.com', selected: true, accessRole: 'freeBusyReader' },
];

describe('displayCalendarIds', () => {
  it('shows primary, the app calendar, and Google-selected calendars', () => {
    expect(
      displayCalendarIds({
        items,
        hiddenIds: [],
        appCalendarId: 'app@group.calendar.google.com',
      }),
    ).toEqual([
      'primary',
      'app@group.calendar.google.com',
      'holidays@group.v.calendar.google.com',
    ]);
  });

  it('drops a hidden calendar and still shows the app calendar', () => {
    expect(
      displayCalendarIds({
        items,
        hiddenIds: [
          'holidays@group.v.calendar.google.com',
          'app@group.calendar.google.com',
        ],
        appCalendarId: 'app@group.calendar.google.com',
      }),
    ).toEqual(['primary', 'app@group.calendar.google.com']);
  });

  it('hides primary when its real id is hidden', () => {
    expect(
      displayCalendarIds({
        items,
        hiddenIds: ['user@gmail.com'],
        appCalendarId: 'app@group.calendar.google.com',
      }),
    ).toEqual([
      'app@group.calendar.google.com',
      'holidays@group.v.calendar.google.com',
    ]);
  });

  it('keeps primary and the app calendar when the calendar list fails', () => {
    expect(
      displayCalendarIds({
        items,
        hiddenIds: ['holidays@group.v.calendar.google.com'],
        appCalendarId: 'app@group.calendar.google.com',
        listFailed: true,
      }),
    ).toEqual(['primary', 'app@group.calendar.google.com']);
  });
});
