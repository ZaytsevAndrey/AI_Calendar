import type { TaskFormValues } from './schema';

export type TaskPresetId = 'flexible' | 'fixed' | 'recurring';

export type TaskPreset = {
  id: TaskPresetId;
  label: string;
  hint: string;
};

export const TASK_PRESETS: TaskPreset[] = [
  {
    id: 'flexible',
    label: 'Flexible',
    hint: 'Planner picks a slot. You can still set a preferred start.',
  },
  {
    id: 'fixed',
    label: 'Fixed',
    hint: 'Exact start and end; planner will not move it.',
  },
  {
    id: 'recurring',
    label: 'Recurring',
    hint: 'Repeats on a pattern. Planner may move occurrences.',
  },
];

export const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
] as const;

const FLEXIBLE_DEFAULTS: Pick<
  TaskFormValues,
  | 'isFixed'
  | 'isRecurring'
  | 'allowSplit'
  | 'estimatedTimeInMinutes'
  | 'recurrencePattern'
  | 'recurrenceWeekDays'
> = {
  isFixed: false,
  isRecurring: false,
  allowSplit: true,
  estimatedTimeInMinutes: 30,
  recurrencePattern: undefined,
  recurrenceWeekDays: [],
};

export const RECURRENCE_PATTERN_OPTIONS = [
  { value: 'DAILY', label: 'Daily' },
  { value: 'WEEKLY', label: 'Weekly' },
  { value: 'BIWEEKLY', label: 'Bi-weekly' },
  { value: 'MONTHLY', label: 'Monthly' },
] as const;

export const WEEKDAY_OPTIONS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
] as const;

export function presetPatch(id: TaskPresetId): Partial<TaskFormValues> {
  if (id === 'fixed') {
    return {
      isFixed: true,
      isRecurring: false,
      allowSplit: false,
      preferredStartTime: '',
      recurrencePattern: undefined,
      recurrenceWeekDays: [],
    };
  }
  if (id === 'recurring') {
    return {
      isFixed: false,
      isRecurring: true,
      allowSplit: true,
      estimatedTimeInMinutes: 30,
      recurrencePattern: 'DAILY',
      recurrenceWeekDays: [1, 2, 3, 4, 5],
      scheduledStartTime: '',
      scheduledEndTime: '',
    };
  }
  return {
    ...FLEXIBLE_DEFAULTS,
    scheduledStartTime: '',
    scheduledEndTime: '',
  };
}

/** Highlight a preset only while current flags still match it. */
export function matchPreset(values: Pick<TaskFormValues, 'isFixed' | 'isRecurring' | 'allowSplit' | 'recurrencePattern'>): TaskPresetId | null {
  if (values.isFixed && !values.isRecurring) return 'fixed';
  if (
    !values.isFixed &&
    values.isRecurring &&
    values.allowSplit !== false &&
    values.recurrencePattern === 'DAILY'
  ) {
    return 'recurring';
  }
  if (!values.isFixed && !values.isRecurring && values.allowSplit !== false) {
    return 'flexible';
  }
  return null;
}
