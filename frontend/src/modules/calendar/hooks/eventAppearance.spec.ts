import { GoogleCalendarEvent } from '../../../api/google-calendar.api';
import {
  EXTERNAL_EVENT_COLOR,
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
  it('maps our events to the phase palette and keeps external events neutral', () => {
    const app = event({ isAppGenerated: true, colorId: '9', end: { dateTime: '2026-04-20T10:00:00.000Z' } });
    expect(getEventColor(app)).toBe('rgb(var(--ph-blue))');
    expect(getEventColor(event({ isAppGenerated: true, colorId: '10' }))).toBe('rgb(var(--ph-green))');
    expect(getEventColor(event({ isAppGenerated: true }))).toBe('rgb(var(--ph-blue))');
    expect(getEventColor(event({ isAppGenerated: false, colorId: '4' }))).toBe(EXTERNAL_EVENT_COLOR);
  });
});
