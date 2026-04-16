import type { CreateTaskDTO, TaskDTO, UpdateTaskDTO, TaskEventType } from '../../../api/tasks.api';
import type { TaskWizardFormValues } from './schema';
import { DEFAULT_DURATION_BY_TYPE, SPLITTABLE_TYPES } from './constants';

export function buildTaskPayload(data: TaskWizardFormValues): CreateTaskDTO | UpdateTaskDTO {
  const eventType = (data.eventType ?? 'admin') as TaskEventType;
  const typeAllowsSplit = SPLITTABLE_TYPES.has(eventType);
  const phaseIds = (data.phaseIds ?? []).filter(Boolean);
  const estimatedTimeInMinutes =
    data.estimatedTimeInMinutes ?? DEFAULT_DURATION_BY_TYPE[eventType] ?? 30;

  const payload: CreateTaskDTO | UpdateTaskDTO = {
    name: data.name,
    description: data.description || undefined,
    eventType,
    estimatedTimeInMinutes,
    isRecurring: !!data.isRecurring,
    recurrencePattern: data.isRecurring ? data.recurrencePattern || undefined : undefined,
    allowSplit: typeAllowsSplit ? data.allowSplit : false,
    priority: data.priority,
    deadline: data.deadline || undefined,
    phaseIds: phaseIds.length ? phaseIds : undefined,
    phaseId: phaseIds[0],
  };

  if (eventType === 'fixed' && data.scheduledStartTime && data.scheduledEndTime) {
    payload.scheduledStartTime = new Date(data.scheduledStartTime).toISOString();
    payload.scheduledEndTime = new Date(data.scheduledEndTime).toISOString();
  }

  if (
    eventType === 'daily_routine' &&
    data.preferredStartTime &&
    data.preferredEndTime
  ) {
    const baseDate = new Date();
    const yyyy = baseDate.getFullYear();
    const mm = String(baseDate.getMonth() + 1).padStart(2, '0');
    const dd = String(baseDate.getDate()).padStart(2, '0');
    payload.scheduledStartTime = new Date(
      `${yyyy}-${mm}-${dd}T${data.preferredStartTime}:00`,
    ).toISOString();
    payload.scheduledEndTime = new Date(
      `${yyyy}-${mm}-${dd}T${data.preferredEndTime}:00`,
    ).toISOString();
  }

  return payload;
}

export function initialWizardValues(data?: TaskDTO): TaskWizardFormValues {
  if (!data) {
    return {
      name: '',
      description: '',
      eventType: undefined,
      phaseIds: [],
      estimatedTimeInMinutes: 30,
      isRecurring: false,
      allowSplit: true,
      priority: 'medium',
      preferredStartTime: undefined,
      preferredEndTime: undefined,
    };
  }
  const phaseIds =
    data.phases?.length ? data.phases.map((p) => p.id) : data.phaseId ? [data.phaseId] : [];
  return {
    name: data.name,
    description: data.description ?? '',
    eventType: (data.eventType ?? 'admin') as TaskWizardFormValues['eventType'],
    phaseIds,
    estimatedTimeInMinutes: data.estimatedTimeInMinutes,
    isRecurring: data.isRecurring,
    recurrencePattern: data.recurrencePattern ?? '',
    allowSplit: data.allowSplit,
    priority: data.priority,
    deadline: data.deadline
      ? new Date(data.deadline).toISOString().substring(0, 16)
      : undefined,
    scheduledStartTime: data.scheduledStartTime
      ? new Date(data.scheduledStartTime).toISOString().substring(0, 16)
      : undefined,
    scheduledEndTime: data.scheduledEndTime
      ? new Date(data.scheduledEndTime).toISOString().substring(0, 16)
      : undefined,
    preferredStartTime: data.scheduledStartTime
      ? new Date(data.scheduledStartTime).toISOString().substring(11, 16)
      : undefined,
    preferredEndTime: data.scheduledEndTime
      ? new Date(data.scheduledEndTime).toISOString().substring(11, 16)
      : undefined,
  };
}
