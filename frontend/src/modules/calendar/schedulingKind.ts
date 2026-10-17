import type { GoogleCalendarEvent } from 'api/google-calendar.api';
import type { TaskDTO } from 'api/tasks.api';
import { scheduleModeOf } from 'modules/events/utils/taskListFilters';

export type CalendarProviderId = 'google' | 'microsoft' | 'apple';

export type SchedulingKind =
  | 'fixed'
  | 'flexible'
  | 'recurring'
  | 'habit'
  | 'unscheduled';

export type CalendarEventOverlayDTO = {
  id: string;
  provider: CalendarProviderId;
  externalCalendarId: string;
  externalEventId: string;
  schedulingMode: 'fixed' | 'flexible';
};

/** Kind shown on a calendar chip (icons; habit/recurring are read-only). */
export function schedulingKindForEvent(input: {
  event: GoogleCalendarEvent;
  task?: TaskDTO | null;
  overlay?: CalendarEventOverlayDTO | null;
  isHabit?: boolean;
}): SchedulingKind {
  if (input.isHabit) return 'habit';
  const task = input.task;
  if (task) {
    if (task.isUnscheduled) return 'unscheduled';
    const mode = scheduleModeOf(task);
    if (mode === 'recurring') return 'recurring';
    if (mode === 'fixed') return 'fixed';
    return 'flexible';
  }
  if (input.overlay?.schedulingMode === 'flexible') return 'flexible';
  if (input.overlay?.schedulingMode === 'fixed') return 'fixed';
  // Untouched external / app event without a linked task → fixed anchor
  return 'fixed';
}

export function overlayForEvent(
  overlays: CalendarEventOverlayDTO[],
  event: GoogleCalendarEvent,
  provider: CalendarProviderId = 'google',
): CalendarEventOverlayDTO | undefined {
  return overlays.find(
    (o) =>
      o.provider === provider &&
      (o.externalEventId === event.id ||
        (!!event.recurringEventId &&
          o.externalEventId === event.recurringEventId)),
  );
}

export function kindIsEditable(kind: SchedulingKind): boolean {
  return kind === 'fixed' || kind === 'flexible' || kind === 'unscheduled';
}
