import type { GoogleCalendarEvent } from 'api/google-calendar.api';
import type { TaskDTO } from 'api/tasks.api';
import { taskTraits } from 'modules/tasks/schedulingTraits';

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

/**
 * Scheduling behavior shown on a calendar chip: fixed, flexible, habit or
 * unscheduled. Never `recurring` — repeating is a separate marker
 * (`schedulingBadgeForEvent`), so a fixed series reads as fixed + repeats.
 */
export function schedulingKindForEvent(input: {
  event: GoogleCalendarEvent;
  task?: TaskDTO | null;
  overlay?: CalendarEventOverlayDTO | null;
  isHabit?: boolean;
}): SchedulingKind {
  if (input.isHabit) return 'habit';
  const task = input.task;
  if (task) {
    const traits = taskTraits(task);
    if (traits.unscheduled) return 'unscheduled';
    return traits.behavior;
  }
  if (input.overlay?.schedulingMode === 'flexible') return 'flexible';
  if (input.overlay?.schedulingMode === 'fixed') return 'fixed';
  // Untouched external / app event without a linked task → fixed anchor
  return 'fixed';
}

/**
 * Chip badge: behavior plus a repeat marker for an app series, its clock
 * siblings and its day copies. A series member's kind is not switched from
 * the chip (that is a series-level edit in the form).
 */
export function schedulingBadgeForEvent(input: {
  event: GoogleCalendarEvent;
  task?: TaskDTO | null;
  overlay?: CalendarEventOverlayDTO | null;
  isHabit?: boolean;
}): { kind: SchedulingKind; repeats: boolean; editable: boolean } {
  const kind = schedulingKindForEvent(input);
  const repeats = !input.isHabit && !!input.task && taskTraits(input.task).seriesMember;
  return {
    kind,
    repeats,
    editable: kindIsEditable(kind) && !input.isHabit && !repeats,
  };
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
