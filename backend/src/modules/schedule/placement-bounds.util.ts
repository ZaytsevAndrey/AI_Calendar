import { TaskEventType } from '../scheduling/event-type.enum';
import type { Task } from '../tasks/entities/task.entity';
import {
  localDateTimeIso,
  localHm,
  localYmd,
  normalizeClockHm,
} from '../voice/voice-local-date.util';

/**
 * Movable non-recurring: do not search before earliestStartTime.
 * Day-only From (00:00 in the user zone) snaps to wake that local day so a
 * +03:00 midnight is not treated as "this evening" on a UTC host.
 */
export function placementNotBefore(
  task: Pick<
    Task,
    'isRecurring' | 'eventType' | 'earliestStartTime'
  >,
  startDay: Date,
  timeZone?: string | null,
  wakeTime?: string | null,
): Date {
  if (task.isRecurring || task.eventType === TaskEventType.FIXED) {
    return startDay;
  }
  if (!task.earliestStartTime) return startDay;
  const bound = new Date(task.earliestStartTime);
  let effective = bound;
  if (timeZone) {
    const iso = bound.toISOString();
    if (localHm(iso, timeZone) === '00:00') {
      const snapped = new Date(
        localDateTimeIso(
          localYmd(iso, timeZone),
          normalizeClockHm(wakeTime),
          timeZone,
        ),
      );
      if (!Number.isNaN(snapped.getTime())) {
        effective = snapped;
      }
    }
  }
  return effective > startDay ? effective : startDay;
}
