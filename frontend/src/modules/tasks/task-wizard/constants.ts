import i18n from 'i18n';
import type { TaskFormValues } from './schema';

export type TaskPresetId = 'flexible' | 'fixed' | 'recurring' | 'unscheduled';

export type TaskPreset = {
  id: TaskPresetId;
  label: string;
  hint: string;
};

export const TASK_PRESETS: TaskPreset[] = [
  {
    id: 'flexible',
    get label() {
      return i18n.t('tasks.preset.flexible');
    },
    get hint() {
      return i18n.t('tasks.preset.flexibleHint');
    },
  },
  {
    id: 'fixed',
    get label() {
      return i18n.t('tasks.preset.fixed');
    },
    get hint() {
      return i18n.t('tasks.preset.fixedHint');
    },
  },
  {
    id: 'recurring',
    get label() {
      return i18n.t('tasks.preset.recurring');
    },
    get hint() {
      return i18n.t('tasks.preset.recurringHint');
    },
  },
  {
    id: 'unscheduled',
    get label() {
      return i18n.t('tasks.preset.unscheduled');
    },
    get hint() {
      return i18n.t('tasks.preset.unscheduledHint');
    },
  },
];

export const PRIORITY_OPTIONS = [
  {
    value: 'low' as const,
    get label() {
      return i18n.t('tasks.priority.low');
    },
  },
  {
    value: 'medium' as const,
    get label() {
      return i18n.t('tasks.priority.medium');
    },
  },
  {
    value: 'high' as const,
    get label() {
      return i18n.t('tasks.priority.high');
    },
  },
  {
    value: 'urgent' as const,
    get label() {
      return i18n.t('tasks.priority.urgent');
    },
  },
];

const FLEXIBLE_DEFAULTS: Pick<
  TaskFormValues,
  | 'isFixed'
  | 'isUnscheduled'
  | 'isRecurring'
  | 'allowSplit'
  | 'estimatedTimeInMinutes'
  | 'recurrencePattern'
  | 'recurrenceWeekDays'
> = {
  isFixed: false,
  isUnscheduled: false,
  isRecurring: false,
  allowSplit: true,
  estimatedTimeInMinutes: 30,
  recurrencePattern: undefined,
  recurrenceWeekDays: [],
};

export const RECURRENCE_PATTERN_OPTIONS = [
  {
    value: 'DAILY' as const,
    get label() {
      return i18n.t('tasks.recurrence.daily');
    },
  },
  {
    value: 'WEEKLY' as const,
    get label() {
      return i18n.t('tasks.recurrence.weekly');
    },
  },
  {
    value: 'BIWEEKLY' as const,
    get label() {
      return i18n.t('tasks.recurrence.biweekly');
    },
  },
  {
    value: 'MONTHLY' as const,
    get label() {
      return i18n.t('tasks.recurrence.monthly');
    },
  },
];

export const WEEKDAY_OPTIONS = [
  {
    value: 1 as const,
    get label() {
      return i18n.t('tasks.weekday.mon');
    },
  },
  {
    value: 2 as const,
    get label() {
      return i18n.t('tasks.weekday.tue');
    },
  },
  {
    value: 3 as const,
    get label() {
      return i18n.t('tasks.weekday.wed');
    },
  },
  {
    value: 4 as const,
    get label() {
      return i18n.t('tasks.weekday.thu');
    },
  },
  {
    value: 5 as const,
    get label() {
      return i18n.t('tasks.weekday.fri');
    },
  },
  {
    value: 6 as const,
    get label() {
      return i18n.t('tasks.weekday.sat');
    },
  },
  {
    value: 0 as const,
    get label() {
      return i18n.t('tasks.weekday.sun');
    },
  },
];

export function presetPatch(id: TaskPresetId): Partial<TaskFormValues> {
  if (id === 'unscheduled') {
    return {
      isUnscheduled: true,
      isFixed: false,
      isRecurring: false,
      allowSplit: true,
      preferredStartTime: '',
      scheduledStartTime: '',
      scheduledEndTime: '',
      earliestStartTime: '',
      eligibleWeekDays: [],
    };
  }
  if (id === 'fixed') {
    return {
      isUnscheduled: false,
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
      isUnscheduled: false,
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
export function matchPreset(
  values: Pick<
    TaskFormValues,
    'isFixed' | 'isUnscheduled' | 'isRecurring' | 'allowSplit' | 'recurrencePattern'
  >,
): TaskPresetId | null {
  if (values.isUnscheduled) return 'unscheduled';
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
