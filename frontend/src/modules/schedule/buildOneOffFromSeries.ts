import type { CreateTaskDTO, TaskDTO } from 'api/tasks.api';
import { resolveIanaTimeZone } from 'modules/user-settings/ianaTimeZones';
import { localDateTimeIso } from 'utils/ianaDateTime';

/**
 * Prefill a one-off fixed event cloned from a recurring series for a civil day.
 * Recurrence fields are cleared; `startHm` defaults to noon in the given zone.
 */
export function buildOneOffFromSeries(
  task: TaskDTO,
  placeYmd: string,
  timeZone: string,
  startHm = '12:00',
  phaseIdOverride?: string | null,
): CreateTaskDTO {
  const zone = resolveIanaTimeZone(timeZone || task.scheduleTimeZone || 'UTC');
  const duration = Math.max(1, task.estimatedTimeInMinutes || 30);
  const phaseId =
    phaseIdOverride ||
    task.phaseId ||
    task.phases?.[0]?.id ||
    task.phase?.id;
  const clock = /^\d{2}:\d{2}$/.test(startHm) ? startHm : '12:00';
  const start = localDateTimeIso(placeYmd, clock, zone);
  const end = new Date(
    new Date(start).getTime() + duration * 60 * 1000,
  ).toISOString();

  return {
    name: task.name,
    description: task.description,
    phaseId,
    phaseIds: phaseId ? [phaseId] : undefined,
    eventType: 'fixed',
    estimatedTimeInMinutes: duration,
    scheduledStartTime: start,
    scheduledEndTime: end,
    isRecurring: false,
    recurrencePattern: undefined,
    recurrenceWeekDays: [],
    allowSplit: false,
    priority: task.priority,
    deadline: null,
    earliestStartTime: null,
    eligibleWeekDays: [],
    timeZone: zone,
    isUnscheduled: false,
    isProblematic: false,
    location: task.location ?? null,
    googleColorId: task.googleColorId ?? null,
    googleVisibility: task.googleVisibility ?? null,
    googleTransparency: task.googleTransparency ?? null,
    googleReminders: task.googleReminders ?? null,
  };
}

export function occurrenceStartIsoForYmd(
  occurrenceYmd: string,
  timeZone: string,
): string {
  const zone = resolveIanaTimeZone(timeZone);
  return localDateTimeIso(occurrenceYmd, '12:00', zone);
}
