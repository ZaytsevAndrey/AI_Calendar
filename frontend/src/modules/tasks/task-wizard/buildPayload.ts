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

/**
 * Day for the preferred clock: the seated slot's day while it is still inside
 * the window, so saving an untouched task never moves it to today.
 */
function preferredDayYmd(
  zone: string,
  seatedStartTime?: string,
  earliestStartTime?: string,
  deadline?: string,
): string {
  const from = dateTimeLocalYmd(earliestStartTime);
  const until = dateTimeLocalYmd(deadline);
  const seated = seatedStartTime?.trim() ? localYmd(seatedStartTime, zone) : null;
  if (seated && (!from || seated >= from) && (!until || seated <= until)) {
    return seated;
  }
  return from || until || localYmd(new Date().toISOString(), zone);
}

function preferredWindowIso(
  preferredStartTime: string,
  estimatedTimeInMinutes: number,
  timeZone: string,
  deadline?: string,
  earliestStartTime?: string,
  seatedStartTime?: string,
): { start: string; end: string } {
  const zone = resolveIanaTimeZone(timeZone);
  const windowYmd = preferredDayYmd(zone, seatedStartTime, earliestStartTime, deadline);
  const start = localDateTimeIso(windowYmd, preferredStartTime, zone);
  const end = new Date(
    new Date(start).getTime() + estimatedTimeInMinutes * 60 * 1000,
  ).toISOString();
  return { start, end };
}

function fixedSeriesFrom(scheduledStartTime?: string): string | undefined {
  const ymd = dateTimeLocalYmd(scheduledStartTime);
  return ymd ? `${ymd}T00:00` : undefined;
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
  const isUnscheduled = !!data.isUnscheduled;
  const isFixed = !isUnscheduled && !!data.isFixed;
  const isSeries = !isUnscheduled && !!data.isRecurring;
  // Fixed: the slot is the duration. The form always holds a number, so the slot must win.
  const estimatedTimeInMinutes =
    (isFixed ? minutesBetween(data.scheduledStartTime, data.scheduledEndTime, zone) : undefined) ??
    data.estimatedTimeInMinutes ??
    30;

  const primaryPhaseId = data.phaseId?.trim();
  const phaseIds = primaryPhaseId ? [primaryPhaseId] : [];

  const payload: CreateTaskDTO | UpdateTaskDTO = {
    name: data.name,
    description: data.description || undefined,
    eventType: isFixed ? 'fixed' : 'admin',
    isUnscheduled,
    estimatedTimeInMinutes,
    isRecurring: isSeries,
    recurrencePattern: isSeries ? data.recurrencePattern || undefined : undefined,
    recurrenceWeekDays: isSeries ? data.recurrenceWeekDays ?? [] : [],
    allowSplit: isFixed || isUnscheduled ? false : !!data.allowSplit,
    priority: data.priority,
    // A fixed series starts on its first slot's day and may end on an Until day.
    deadline:
      isUnscheduled || (isFixed && !isSeries) ? null : dateTimeLocalToIso(data.deadline, zone),
    earliestStartTime: isUnscheduled
      ? null
      : isFixed
        ? isSeries
          ? dateTimeLocalToIso(
              fixedSeriesFrom(data.scheduledStartTime),
              zone,
            )
          : null
        : dateTimeLocalToIso(data.earliestStartTime, zone),
    timeZone: zone,
    eligibleWeekDays:
      !isUnscheduled &&
      !isFixed &&
      !data.isRecurring &&
      windowSpansMultipleDays(data.earliestStartTime, data.deadline) &&
      data.eligibleWeekDays?.length
        ? data.eligibleWeekDays
        : null,
    status: data.status ?? 'todo',
    phaseIds: isUnscheduled || isFixed ? [] : phaseIds,
    phaseId: isUnscheduled || isFixed ? undefined : primaryPhaseId || undefined,
    location: data.location?.trim() || null,
    googleColorId: data.googleColorId?.trim() || null,
    googleVisibility: data.googleVisibility?.trim() || null,
    googleTransparency: data.googleTransparency?.trim() || null,
    googleReminders:
      data.googleReminderUseDefault === false
        ? {
            useDefault: false,
            overrides: (data.googleReminderOverrides ?? []).map((row) => ({
              method: row.method,
              minutes: row.minutes,
            })),
          }
        : { useDefault: true },
  };

  if (isUnscheduled) {
    payload.scheduledStartTime = null;
    payload.scheduledEndTime = null;
    return payload;
  }

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
      data.seatedStartTime,
    );
    payload.scheduledStartTime = window.start;
    payload.scheduledEndTime = window.end;
  } else {
    payload.scheduledStartTime = null;
    payload.scheduledEndTime = null;
  }

  return payload;
}

function googleFormFields(data?: Pick<
  TaskDTO,
  | 'location'
  | 'googleColorId'
  | 'googleVisibility'
  | 'googleTransparency'
  | 'googleReminders'
  | 'isUnscheduled'
>): Pick<
  TaskFormValues,
  | 'isUnscheduled'
  | 'location'
  | 'googleColorId'
  | 'googleVisibility'
  | 'googleTransparency'
  | 'googleReminderUseDefault'
  | 'googleReminderOverrides'
> {
  const reminders = data?.googleReminders;
  const overrides = reminders?.overrides?.length
    ? reminders.overrides.map((row) => ({
        method: row.method,
        minutes: row.minutes,
      }))
    : [{ method: 'popup' as const, minutes: 10 }];
  return {
    isUnscheduled: !!data?.isUnscheduled,
    location: data?.location ?? '',
    googleColorId: data?.googleColorId ?? '',
    googleVisibility: data?.googleVisibility ?? '',
    googleTransparency: data?.googleTransparency ?? 'opaque',
    googleReminderUseDefault: reminders ? !!reminders.useDefault : true,
    googleReminderOverrides: overrides,
  };
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
      status: payload.status ?? 'todo',
      deadline: payload.deadline ?? undefined,
      earliestStartTime: payload.earliestStartTime ?? undefined,
      eligibleWeekDays: payload.eligibleWeekDays ?? [],
      scheduledStartTime: payload.scheduledStartTime ?? undefined,
      scheduledEndTime: payload.scheduledEndTime ?? undefined,
      isUnscheduled: payload.isUnscheduled,
      location: payload.location,
      googleColorId: payload.googleColorId,
      googleVisibility: payload.googleVisibility,
      googleTransparency: payload.googleTransparency,
      googleReminders: payload.googleReminders,
      createdAt: '',
      updatedAt: '',
    },
    undefined,
    timeZone,
  );
}

export function initialFormValues(
  data?: TaskDTO,
  defaults?: {
    deadline?: string;
    earliestStartTime?: string;
    formPrefill?: TaskFormValues;
    unscheduled?: boolean;
    scheduleIntent?: boolean;
  },
  timeZone: string = 'UTC',
  defaultTaskDurationMinutes = 30,
): TaskFormValues {
  if (defaults?.formPrefill) {
    return defaults.formPrefill;
  }
  const zone = resolveIanaTimeZone(timeZone);
  if (!data) {
    const later = !!defaults?.unscheduled;
    // Flexible is the default: a name is enough, the planner finds the time.
    return {
      name: '',
      description: '',
      isFixed: false,
      phaseId: '',
      estimatedTimeInMinutes:
        defaultTaskDurationMinutes >= 5 ? defaultTaskDurationMinutes : 30,
      isRecurring: false,
      recurrenceWeekDays: [],
      allowSplit: true,
      priority: 'medium',
      status: 'todo',
      deadline: isoToDateTimeLocal(defaults?.deadline, zone),
      earliestStartTime: isoToDateTimeLocal(defaults?.earliestStartTime, zone),
      eligibleWeekDays: [],
      scheduledStartTime: '',
      scheduledEndTime: '',
      preferredStartTime: '',
      seatedStartTime: '',
      ...googleFormFields(),
      isUnscheduled: !!defaults?.unscheduled,
    };
  }
  const scheduleIntent = !!defaults?.scheduleIntent;
  const isUnscheduled = scheduleIntent ? false : !!data.isUnscheduled;
  const isFixed = !isUnscheduled && data.eventType === 'fixed';
  const phaseId = isFixed
    ? ''
    : (data.phaseId ?? (data.phases?.length ? data.phases[0].id : undefined) ?? '');
  return {
    name: data.name,
    description: data.description ?? '',
    isFixed,
    phaseId,
    estimatedTimeInMinutes: data.estimatedTimeInMinutes,
    isRecurring: isUnscheduled ? false : data.isRecurring,
    recurrencePattern: data.recurrencePattern ?? '',
    recurrenceWeekDays: data.recurrenceWeekDays ?? [],
    allowSplit: isUnscheduled ? true : data.allowSplit,
    priority: data.priority,
    status: data.status ?? 'todo',
    // A fixed series keeps its Until day; its From is the slot day itself.
    deadline:
      isUnscheduled || (isFixed && !data.isRecurring) ? '' : isoToDateTimeLocal(data.deadline, zone),
    earliestStartTime: isFixed || isUnscheduled ? '' : isoToDateTimeLocal(data.earliestStartTime, zone),
    eligibleWeekDays: data.eligibleWeekDays ?? [],
    scheduledStartTime: isFixed ? isoToDateTimeLocal(data.scheduledStartTime, zone) : '',
    scheduledEndTime: isFixed ? isoToDateTimeLocal(data.scheduledEndTime, zone) : '',
    preferredStartTime: isFixed || isUnscheduled ? '' : isoToHm(data.scheduledStartTime, zone),
    seatedStartTime: isFixed || isUnscheduled ? '' : data.scheduledStartTime ?? '',
    ...googleFormFields(data),
    isUnscheduled,
  };
}
