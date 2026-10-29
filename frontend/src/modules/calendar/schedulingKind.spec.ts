import {
  kindIsEditable,
  overlayForEvent,
  schedulingBadgeForEvent,
  schedulingKindForEvent,
} from './schedulingKind';
import type { GoogleCalendarEvent } from 'api/google-calendar.api';
import type { TaskDTO } from 'api/tasks.api';

const event = (partial: Partial<GoogleCalendarEvent> = {}): GoogleCalendarEvent =>
  ({
    id: 'ev-1',
    calendarId: 'cal-1',
    summary: 'Meet',
    start: { dateTime: '2026-01-01T10:00:00Z' },
    end: { dateTime: '2026-01-01T11:00:00Z' },
    ...partial,
  }) as GoogleCalendarEvent;

const task = (partial: Partial<TaskDTO> = {}): TaskDTO =>
  ({
    id: 't1',
    name: 'Task',
    eventType: 'admin',
    isRecurring: false,
    ...partial,
  }) as TaskDTO;

describe('schedulingKindForEvent', () => {
  it('defaults untouched external events to fixed', () => {
    expect(schedulingKindForEvent({ event: event() })).toBe('fixed');
  });

  it('uses overlay flexible when present', () => {
    expect(
      schedulingKindForEvent({
        event: event(),
        overlay: {
          id: 'o1',
          provider: 'google',
          externalCalendarId: 'cal-1',
          externalEventId: 'ev-1',
          schedulingMode: 'flexible',
        },
      }),
    ).toBe('flexible');
  });

  it('prefers linked task mode over overlay', () => {
    expect(
      schedulingKindForEvent({
        event: event(),
        task: task({ eventType: 'fixed' }),
        overlay: {
          id: 'o1',
          provider: 'google',
          externalCalendarId: 'cal-1',
          externalEventId: 'ev-1',
          schedulingMode: 'flexible',
        },
      }),
    ).toBe('fixed');
  });

  it('marks habits and recurring', () => {
    expect(schedulingKindForEvent({ event: event(), isHabit: true })).toBe(
      'habit',
    );
    // Recurrence is not a kind: a series shows its behavior plus a repeat marker.
    expect(
      schedulingKindForEvent({
        event: event(),
        task: task({ isRecurring: true }),
      }),
    ).toBe('flexible');
  });

  it('shows a fixed series as fixed + repeats, read-only from the chip', () => {
    expect(
      schedulingBadgeForEvent({
        event: event(),
        task: task({ isRecurring: true, eventType: 'fixed' }),
      }),
    ).toEqual({ kind: 'fixed', repeats: true, editable: false });
    expect(
      schedulingBadgeForEvent({
        event: event(),
        task: task({ isRecurring: false, eventType: 'fixed', seriesGroupId: 's1' }),
      }),
    ).toEqual({ kind: 'fixed', repeats: true, editable: false });
    expect(
      schedulingBadgeForEvent({
        event: event(),
        task: task({ isRecurring: true, eventType: 'admin' }),
      }),
    ).toEqual({ kind: 'flexible', repeats: true, editable: false });
    expect(
      schedulingBadgeForEvent({ event: event(), task: task({ eventType: 'fixed' }) }),
    ).toEqual({ kind: 'fixed', repeats: false, editable: true });
  });
});

describe('overlayForEvent / kindIsEditable', () => {
  it('matches event id or recurringEventId', () => {
    const overlays = [
      {
        id: 'o1',
        provider: 'google' as const,
        externalCalendarId: 'c',
        externalEventId: 'series-1',
        schedulingMode: 'flexible' as const,
      },
    ];
    expect(
      overlayForEvent(overlays, event({ id: 'inst', recurringEventId: 'series-1' }))
        ?.schedulingMode,
    ).toBe('flexible');
  });

  it('editable only for fixed/flexible/unscheduled', () => {
    expect(kindIsEditable('fixed')).toBe(true);
    expect(kindIsEditable('habit')).toBe(false);
    expect(kindIsEditable('recurring')).toBe(false);
  });
});
