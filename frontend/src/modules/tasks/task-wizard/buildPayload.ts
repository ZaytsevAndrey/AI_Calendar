import type { CreateTaskDTO, TaskDTO, UpdateTaskDTO, TaskEventType } from '../../../api/tasks.api';
import type { TaskWizardFormValues } from './schema';
import { DEFAULT_DURATION_BY_TYPE, SPLITTABLE_TYPES } from './constants';

export function buildTaskPayload(data: TaskWizardFormValues): CreateTaskDTO | UpdateTaskDTO {
  const eventType = (data.eventType ?? 'admin') as TaskEventType;
  const typeAllowsSplit = SPLITTABLE_TYPES.has(eventType);
  const primaryPhaseId = data.phaseId?.trim();
  const phaseIds = primaryPhaseId ? [primaryPhaseId] : [];
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
    phaseId: primaryPhaseId || undefined,
  };

  if (eventType === 'fixed' && data.scheduledStartTime && data.scheduledEndTime) {
    payload.scheduledStartTime = new Date(data.scheduledStartTime).toISOString();
    payload.scheduledEndTime = new Date(data.scheduledEndTime).toISOString();
  }

  if (eventType === 'daily_routine' && data.preferredStartTime?.trim()) {
    const baseDate = new Date();
    const yyyy = baseDate.getFullYear();
    const mm = String(baseDate.getMonth() + 1).padStart(2, '0');
    const dd = String(baseDate.getDate()).padStart(2, '0');
    const startLocal = new Date(`${yyyy}-${mm}-${dd}T${data.preferredStartTime.trim()}:00`);
    const endLocal = new Date(startLocal.getTime() + estimatedTimeInMinutes * 60 * 1000);
    payload.scheduledStartTime = startLocal.toISOString();
    payload.scheduledEndTime = endLocal.toISOString();
  }

  return payload;
}

export function initialWizardValues(data?: TaskDTO): TaskWizardFormValues {
  if (!data) {
    return {
      name: '',
      description: '',
      eventType: undefined,
      phaseId: '',
      estimatedTimeInMinutes: 30,
      isRecurring: false,
      allowSplit: true,
      priority: 'medium',
      preferredStartTime: undefined,
    };
  }
  const phaseId =
    data.phaseId ?? (data.phases?.length ? data.phases[0].id : undefined) ?? '';
  return {
    name: data.name,
    description: data.description ?? '',
    eventType: (data.eventType ?? 'admin') as TaskWizardFormValues['eventType'],
    phaseId,
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
  };
}
