import { normalizeHiddenCalendarIds } from './hidden-google-calendars.util';

describe('normalizeHiddenCalendarIds', () => {
  it('trims, dedupes, and drops the app calendar', () => {
    expect(
      normalizeHiddenCalendarIds(
        [
          ' holidays@group.v.calendar.google.com ',
          'holidays@group.v.calendar.google.com',
          'app@group.calendar.google.com',
          '',
          12,
        ],
        'app@group.calendar.google.com',
      ),
    ).toEqual(['holidays@group.v.calendar.google.com']);
  });

  it('returns an empty list for a non-array', () => {
    expect(normalizeHiddenCalendarIds('primary', null)).toEqual([]);
  });
});
