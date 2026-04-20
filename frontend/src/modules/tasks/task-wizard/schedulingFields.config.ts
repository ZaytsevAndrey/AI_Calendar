import type { TaskEventType } from '../../../api/tasks.api';
import type { TaskWizardFormValues } from './schema';

export type SchedulingFieldKey =
  | 'scheduledStartTime'
  | 'scheduledEndTime'
  | 'deadline'
  | 'estimatedTimeInMinutes'
  | 'allowSplit'
  | 'isRecurring'
  | 'recurrencePattern'
  | 'preferredStartTime';

export type EventSchedulingConfig = {
  mode: 'fixed' | 'flexible';
  fields: SchedulingFieldKey[];
  validationFieldsWhenRecurring: (keyof TaskWizardFormValues)[];
  validationFieldsWhenNotRecurring: (keyof TaskWizardFormValues)[];
};

export const SCHEDULING_MODE_DESCRIPTION: Record<EventSchedulingConfig['mode'], string> = {
  fixed: 'Fixed tasks require exact start and end times. Deadline is optional.',
  flexible: 'Set planning fields used by the scheduler for flexible tasks.',
};

export const EVENT_TYPE_SCHEDULING_HINTS: Partial<Record<TaskEventType, string>> = {
  daily_routine:
    'Optional: preferred start time; end = start + estimated duration. If the task has a phase with specific weekdays (e.g. Mon–Fri), recurring copies follow only those days in the planner and in Google Calendar.',
};

export const SCHEDULING_FIELD_VISIBILITY: Partial<
  Record<SchedulingFieldKey, { requiresRecurring?: boolean }>
> = {
  recurrencePattern: { requiresRecurring: true },
};

export const SCHEDULING_FIELD_LABELS: Record<SchedulingFieldKey, string> = {
  scheduledStartTime: 'Fixed start',
  scheduledEndTime: 'Fixed end',
  deadline: 'Deadline',
  estimatedTimeInMinutes: 'Estimated time (minutes)',
  allowSplit: 'Allow splitting',
  isRecurring: 'Recurring task',
  recurrencePattern: 'Recurrence pattern',
  preferredStartTime: 'Preferred start',
};

export const SCHEDULING_FIELD_HINTS: Partial<Record<SchedulingFieldKey, string>> = {
  deadline: '(optional)',
  estimatedTimeInMinutes:
    'Typical default for this type is about {defaultForType} minutes; adjust to match the real effort.',
  allowSplit: 'Planner may break this task into smaller scheduled chunks.',
};

export const SPLIT_UNAVAILABLE_HINT = 'Not available for this task type.';

export const RECURRENCE_PATTERN_OPTIONS = [
  { value: 'DAILY', label: 'Daily' },
  { value: 'WEEKLY', label: 'Weekly' },
  { value: 'BIWEEKLY', label: 'Bi-weekly' },
  { value: 'MONTHLY', label: 'Monthly' },
] as const;

const FIXED_CONFIG: EventSchedulingConfig = {
  mode: 'fixed',
  fields: ['scheduledStartTime', 'scheduledEndTime', 'deadline'],
  validationFieldsWhenRecurring: ['scheduledStartTime', 'scheduledEndTime'],
  validationFieldsWhenNotRecurring: ['scheduledStartTime', 'scheduledEndTime'],
};

const FLEXIBLE_DEFAULT: EventSchedulingConfig = {
  mode: 'flexible',
  fields: ['estimatedTimeInMinutes', 'allowSplit', 'isRecurring', 'recurrencePattern'],
  validationFieldsWhenRecurring: ['estimatedTimeInMinutes', 'allowSplit', 'isRecurring', 'recurrencePattern'],
  validationFieldsWhenNotRecurring: ['estimatedTimeInMinutes', 'allowSplit', 'isRecurring'],
};

const DAILY_ROUTINE_CONFIG: EventSchedulingConfig = {
  mode: 'flexible',
  fields: [
    'estimatedTimeInMinutes',
    'allowSplit',
    'isRecurring',
    'recurrencePattern',
    'preferredStartTime',
  ],
  validationFieldsWhenRecurring: [
    'estimatedTimeInMinutes',
    'allowSplit',
    'isRecurring',
    'recurrencePattern',
  ],
  validationFieldsWhenNotRecurring: ['estimatedTimeInMinutes', 'allowSplit', 'isRecurring'],
};

export const EVENT_TYPE_SCHEDULING_CONFIG: Record<TaskEventType, EventSchedulingConfig> = {
  fixed: FIXED_CONFIG,
  daily_routine: DAILY_ROUTINE_CONFIG,
  quick_win: FLEXIBLE_DEFAULT,
  deep_work: FLEXIBLE_DEFAULT,
  errand: FLEXIBLE_DEFAULT,
  admin: FLEXIBLE_DEFAULT,
  focus_block: FLEXIBLE_DEFAULT,
  learning: FLEXIBLE_DEFAULT,
};

export function getSchedulingConfigForEventType(
  eventType?: TaskEventType,
): EventSchedulingConfig {
  if (!eventType) return FLEXIBLE_DEFAULT;
  return EVENT_TYPE_SCHEDULING_CONFIG[eventType] ?? FLEXIBLE_DEFAULT;
}

