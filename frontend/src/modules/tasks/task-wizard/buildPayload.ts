import type { CreateTaskDTO, TaskDTO, UpdateTaskDTO } from '../../../api/tasks.api';
import type { TaskFormValues } from './schema';

function toLocalDateTimeInput(value?: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

function toLocalTimeInput(value?: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${min}`;
}

export function windowSpansMultipleDays(from?: string, until?: string): boolean {
  if (!from?.trim() || !until?.trim()) return false;
  const start = new Date(from);
  const end = new Date(until);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
  return (
    start.getFullYear() !== end.getFullYear() ||
    start.getMonth() !== end.getMonth() ||
    start.getDate() !== end.getDate()
  );
}

function preferredWindowIso(
  preferredStartTime: string,
  estimatedTimeInMinutes: number,
  deadline?: string,
  earliestStartTime?: string,
): { start: string; end: string } {
  let baseDate = new Date();
  const windowStart = earliestStartTime?.trim() || deadline?.trim();
  if (windowStart) {
    const fromWindow = new Date(windowStart);
    if (!Number.isNaN(fromWindow.getTime())) {
      baseDate = fromWindow;
    }
  }
  const yyyy = baseDate.getFullYear();
  const mm = String(baseDate.getMonth() + 1).padStart(2, '0');
  const dd = String(baseDate.getDate()).padStart(2, '0');
  const startLocal = new Date(`${yyyy}-${mm}-${dd}T${preferredStartTime}:00`);
  const endLocal = new Date(startLocal.getTime() + estimatedTimeInMinutes * 60 * 1000);
  return { start: startLocal.toISOString(), end: endLocal.toISOString() };
}

export function buildTaskPayload(data: TaskFormValues): CreateTaskDTO | UpdateTaskDTO {
  const isFixed = !!data.isFixed;
  const estimatedTimeInMinutes =
    data.estimatedTimeInMinutes ??
    (isFixed && data.scheduledStartTime && data.scheduledEndTime
      ? Math.max(
          1,
          Math.round(
            (new Date(data.scheduledEndTime).getTime() - new Date(data.scheduledStartTime).getTime()) /
              60000,
          ),
        )
      : 30);

  const primaryPhaseId = data.phaseId?.trim();
  const phaseIds = primaryPhaseId ? [primaryPhaseId] : [];

  const payload: CreateTaskDTO | UpdateTaskDTO = {
    name: data.name,
    description: data.description || undefined,
    eventType: isFixed ? 'fixed' : 'admin',
    estimatedTimeInMinutes,
    isRecurring: !isFixed && !!data.isRecurring,
    recurrencePattern: !isFixed && data.isRecurring ? data.recurrencePattern || undefined : undefined,
    recurrenceWeekDays:
      !isFixed && data.isRecurring ? data.recurrenceWeekDays ?? [] : [],
    allowSplit: isFixed ? false : !!data.allowSplit,
    priority: data.priority,
    deadline: data.deadline?.trim()
      ? new Date(data.deadline).toISOString()
      : undefined,
    earliestStartTime:
      !isFixed && data.earliestStartTime?.trim()
        ? new Date(data.earliestStartTime).toISOString()
        : null,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    eligibleWeekDays:
      !isFixed &&
      !data.isRecurring &&
      windowSpansMultipleDays(data.earliestStartTime, data.deadline) &&
      data.eligibleWeekDays?.length
        ? data.eligibleWeekDays
        : null,
    phaseIds: phaseIds.length ? phaseIds : undefined,
    phaseId: primaryPhaseId || undefined,
  };

  if (isFixed && data.scheduledStartTime && data.scheduledEndTime) {
    payload.scheduledStartTime = new Date(data.scheduledStartTime).toISOString();
    payload.scheduledEndTime = new Date(data.scheduledEndTime).toISOString();
  } else if (!isFixed && data.preferredStartTime?.trim()) {
    const window = preferredWindowIso(
      data.preferredStartTime.trim(),
      estimatedTimeInMinutes,
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

export function formValuesFromCreatePayload(payload: CreateTaskDTO): TaskFormValues {
  const isFixed = payload.eventType === 'fixed';
  return initialFormValues({
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
    deadline: payload.deadline,
    earliestStartTime: payload.earliestStartTime ?? undefined,
    eligibleWeekDays: payload.eligibleWeekDays ?? [],
    scheduledStartTime: payload.scheduledStartTime ?? undefined,
    scheduledEndTime: payload.scheduledEndTime ?? undefined,
    status: 'todo',
    createdAt: '',
    updatedAt: '',
  });
}

export function initialFormValues(
  data?: TaskDTO,
  defaults?: { deadline?: string; earliestStartTime?: string; formPrefill?: TaskFormValues },
): TaskFormValues {
  if (defaults?.formPrefill) {
    return defaults.formPrefill;
  }
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
      deadline: toLocalDateTimeInput(defaults?.deadline) ?? '',
      earliestStartTime: toLocalDateTimeInput(defaults?.earliestStartTime) ?? '',
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
    deadline: toLocalDateTimeInput(data.deadline) ?? '',
    earliestStartTime: isFixed ? '' : toLocalDateTimeInput(data.earliestStartTime) ?? '',
    eligibleWeekDays: data.eligibleWeekDays ?? [],
    scheduledStartTime: isFixed ? toLocalDateTimeInput(data.scheduledStartTime) ?? '' : '',
    scheduledEndTime: isFixed ? toLocalDateTimeInput(data.scheduledEndTime) ?? '' : '',
    preferredStartTime: isFixed ? '' : toLocalTimeInput(data.scheduledStartTime) ?? '',
  };
}
