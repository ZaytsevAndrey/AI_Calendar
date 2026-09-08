import { GoogleCalendarEvent } from '../../../api/google-calendar.api';
import {
  PAST_APP_EVENT_COLOR,
  getEventColor,
  isPastAppEvent,
} from './eventAppearance';

function event(partial: Partial<GoogleCalendarEvent>): GoogleCalendarEvent {
  return {
    id: 'e1',
    start: { dateTime: '2026-04-20T09:00:00.000Z' },
    end: { dateTime: '2026-04-20T10:00:00.000Z' },
    ...partial,
  };
}

describe('isPastAppEvent', () => {
  const now = Date.parse('2026-04-20T12:00:00.000Z');

  it('is false for events that are not from the app calendar', () => {
    expect(
      isPastAppEvent(
        event({ isAppGenerated: false, end: { dateTime: '2026-04-20T10:00:00.000Z' } }),
        now,
      ),
    ).toBe(false);
  });

  it('is true only for fully ended app-calendar events', () => {
    expect(
      isPastAppEvent(
        event({ isAppGenerated: true, end: { dateTime: '2026-04-20T10:00:00.000Z' } }),
        now,
      ),
    ).toBe(true);
    expect(
      isPastAppEvent(
        event({ isAppGenerated: true, end: { dateTime: '2026-04-20T12:00:00.000Z' } }),
        now,
      ),
    ).toBe(true);
    expect(
      isPastAppEvent(
        event({ isAppGenerated: true, end: { dateTime: '2026-04-20T13:00:00.000Z' } }),
        now,
      ),
    ).toBe(false);
  });
});

describe('getEventColor', () => {
  it('uses gray for past app events and the Google color otherwise', () => {
    expect(
      getEventColor(
        event({
          isAppGenerated: true,
          colorId: '7',
          end: { dateTime: '2026-04-20T10:00:00.000Z' },
        }),
      ),
    ).toBe(PAST_APP_EVENT_COLOR);

    const futureApp = event({
      isAppGenerated: true,
      colorId: '7',
      end: { dateTime: '2099-01-01T10:00:00.000Z' },
    });
    expect(getEventColor(futureApp)).toBe('#039be5');

    const pastExternal = event({
      isAppGenerated: false,
      colorId: '4',
      end: { dateTime: '2026-04-20T10:00:00.000Z' },
    });
    expect(getEventColor(pastExternal)).toBe('#e67c73');
  });
});
