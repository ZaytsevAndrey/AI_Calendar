import type { CreateTaskDTO, TaskDTO, UpdateTaskDTO } from '../../../api/tasks.api';
import { resolveIanaTimeZone } from '../../user-settings/ianaTimeZones';
import {
  dateTimeLocalToIso,
  dateTimeLocalYmd,
  isoToDateTimeLocal,
  isoToHm,
  localDateTimeIso,
  localYmd,
} from '../../../utils/ianaDateTime';
import type { TaskFormValues } from './schema';

export function windowSpansMultipleDays(from?: string, until?: string): boolean {
  const startYmd = dateTimeLocalYmd(from);
  const endYmd = dateTimeLocalYmd(until);
  if (!startYmd || !endYmd) return false;
  return startYmd !== endYmd;
}

function preferredWindowIso(
  preferredStartTime: string,
  estimatedTimeInMinutes: number,
  timeZone: string,
  deadline?: string,
  earliestStartTime?: string,
): { start: string; end: string } {
  const zone = resolveIanaTimeZone(timeZone);
  const windowYmd =
    dateTimeLocalYmd(earliestStartTime) ||
    dateTimeLocalYmd(deadline) ||
    localYmd(new Date().toISOString(), zone);
  const start = localDateTimeIso(windowYmd, preferredStartTime, zone);
  const end = new Date(
    new Date(start).getTime() + estimatedTimeInMinutes * 60 * 1000,
  ).toISOString();
  return { start, end };
}

function minutesBetween(
  startLocal: string | undefined,
  endLocal: string | undefined,
  timeZone: string,
): number | undefined {
  const startIso = dateTimeLocalToIso(startLocal, timeZone);
  const endIso = dateTimeLocalToIso(endLocal, timeZone);
  if (!startIso || !endIso) return undefined;
  return Math.max(
    1,
    Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000),
  );
}

export function buildTaskPayload(
  data: TaskFormValues,
  timeZone: string,
): CreateTaskDTO | UpdateTaskDTO {
  const zone = resolveIanaTimeZone(timeZone);
  const isFixed = !!data.isFixed;
  const estimatedTimeInMinutes =
    data.estimatedTimeInMinutes ??
    (isFixed ? minutesBetween(data.scheduledStartTime, data.scheduledEndTime, zone) : undefined) ??
    30;

  const primaryPhaseId = data.phaseId?.trim();
  const phaseIds = primaryPhaseId ? [primaryPhaseId] : [];

  const payload: CreateTaskDTO | UpdateTaskDTO = {
    name: data.name,
    description: data.description || undefined,
    eventType: isFixed ? 'fixed' : 'admin',
    estimatedTimeInMinutes,
    isRecurring: !isFixed && !!data.isRecurring,
    recurrencePattern: !isFixed && data.isRecurring ? data.recurrencePattern || undefined : undefined,
    recurrenceWeekDays: !isFixed && data.isRecurring ? data.recurrenceWeekDays ?? [] : [],
    allowSplit: isFixed ? false : !!data.allowSplit,
    priority: data.priority,
    deadline: dateTimeLocalToIso(data.deadline, zone),
    earliestStartTime: isFixed ? null : dateTimeLocalToIso(data.earliestStartTime, zone),
    timeZone: zone,
    eligibleWeekDays:
      !isFixed &&
      !data.isRecurring &&
      windowSpansMultipleDays(data.earliestStartTime, data.deadline) &&
      data.eligibleWeekDays?.length
        ? data.eligibleWeekDays
        : null,
    phaseIds,
    phaseId: primaryPhaseId || undefined,
  };

  if (isFixed && data.scheduledStartTime && data.scheduledEndTime) {
    payload.scheduledStartTime = dateTimeLocalToIso(data.scheduledStartTime, zone);
    payload.scheduledEndTime = dateTimeLocalToIso(data.scheduledEndTime, zone);
  } else if (!isFixed && data.preferredStartTime?.trim()) {
    const window = preferredWindowIso(
      data.preferredStartTime.trim(),
      estimatedTimeInMinutes,
      zone,
      data.deadline,
      data.earliestStartTime,
    );
    payload.scheduledStartTime = window.start;
    payload.scheduledEndTime = window.end;
  } else {
    payload.scheduledStartTime = null;
    payload.scheduledEndTime = null;
  }

  return payload;
}

export function formValuesFromCreatePayload(
  payload: CreateTaskDTO,
  timeZone: string,
): TaskFormValues {
  const isFixed = payload.eventType === 'fixed';
  return initialFormValues(
    {
      id: 'voice-prefill',
      name: payload.name,
      description: payload.description,
      phaseId: payload.phaseId ?? payload.phaseIds?.[0],
      eventType: payload.eventType,
      estimatedTimeInMinutes: payload.estimatedTimeInMinutes ?? 30,
      isRecurring: payload.isRecurring ?? false,
      recurrencePattern: payload.recurrencePattern ?? undefined,
      recurrenceWeekDays: payload.recurrenceWeekDays ?? [],
      allowSplit: payload.allowSplit ?? !isFixed,
      priority: payload.priority ?? 'medium',
      deadline: payload.deadline ?? undefined,
      earliestStartTime: payload.earliestStartTime ?? undefined,
      eligibleWeekDays: payload.eligibleWeekDays ?? [],
      scheduledStartTime: payload.scheduledStartTime ?? undefined,
      scheduledEndTime: payload.scheduledEndTime ?? undefined,
      status: 'todo',
      createdAt: '',
      updatedAt: '',
    },
    undefined,
    timeZone,
  );
}

export function initialFormValues(
  data?: TaskDTO,
  defaults?: { deadline?: string; earliestStartTime?: string; formPrefill?: TaskFormValues },
  timeZone: string = 'UTC',
): TaskFormValues {
  if (defaults?.formPrefill) {
    return defaults.formPrefill;
  }
  const zone = resolveIanaTimeZone(timeZone);
  if (!data) {
    return {
      name: '',
      description: '',
      isFixed: false,
      phaseId: '',
      estimatedTimeInMinutes: 30,
      isRecurring: false,
      recurrenceWeekDays: [],
      allowSplit: true,
      priority: 'medium',
      deadline: isoToDateTimeLocal(defaults?.deadline, zone),
      earliestStartTime: isoToDateTimeLocal(defaults?.earliestStartTime, zone),
      eligibleWeekDays: [],
      scheduledStartTime: '',
      scheduledEndTime: '',
      preferredStartTime: '',
    };
  }
  const isFixed = data.eventType === 'fixed';
  const phaseId = data.phaseId ?? (data.phases?.length ? data.phases[0].id : undefined) ?? '';
  return {
    name: data.name,
    description: data.description ?? '',
    isFixed,
    phaseId,
    estimatedTimeInMinutes: data.estimatedTimeInMinutes,
    isRecurring: data.isRecurring,
    recurrencePattern: data.recurrencePattern ?? '',
    recurrenceWeekDays: data.recurrenceWeekDays ?? [],
    allowSplit: data.allowSplit,
    priority: data.priority,
    deadline: isoToDateTimeLocal(data.deadline, zone),
    earliestStartTime: isFixed ? '' : isoToDateTimeLocal(data.earliestStartTime, zone),
    eligibleWeekDays: data.eligibleWeekDays ?? [],
    scheduledStartTime: isFixed ? isoToDateTimeLocal(data.scheduledStartTime, zone) : '',
    scheduledEndTime: isFixed ? isoToDateTimeLocal(data.scheduledEndTime, zone) : '',
    preferredStartTime: isFixed ? '' : isoToHm(data.scheduledStartTime, zone),
  };
}
