import i18n from 'i18n';
import type { TaskFormValues } from './schema';

/**
 * Scheduling mode of the form. Repeat is not a mode: a flexible or fixed
 * task may repeat, and switching modes keeps the repeat rule.
 */
export type TaskPresetId = 'flexible' | 'fixed' | 'unscheduled';

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
    id: 'unscheduled',
    get label() {
      return i18n.t('tasks.preset.unscheduled');
    },
    get hint() {
      return i18n.t('tasks.preset.unscheduledHint');
    },
  },
];

export const STATUS_OPTIONS = [
  {
    value: 'todo' as const,
    get label() {
      return i18n.t('tasks.status.todo');
    },
  },
  {
    value: 'in_progress' as const,
    get label() {
      return i18n.t('tasks.status.inProgress');
    },
  },
  {
    value: 'completed' as const,
    get label() {
      return i18n.t('tasks.status.completed');
    },
  },
  {
    value: 'canceled' as const,
    get label() {
      return i18n.t('tasks.status.canceled');
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

type RecurrenceOption = { value: 'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY'; label: string };

/**
 * DAILY with days and WEEKLY with days expand to the same days, so a new task
 * gets one "on chosen days" choice. WEEKLY stays listed only for a task that
 * already has it: rewriting the pattern would count as a schedule change.
 */
export function recurrenceOptionsFor(current?: string): RecurrenceOption[] {
  const options: RecurrenceOption[] = [
    { value: 'DAILY', label: i18n.t('tasks.recurrence.onDays') },
    { value: 'BIWEEKLY', label: i18n.t('tasks.recurrence.biweekly') },
    { value: 'MONTHLY', label: i18n.t('tasks.recurrence.monthly') },
  ];
  if (current === 'WEEKLY') {
    options.splice(1, 0, { value: 'WEEKLY', label: i18n.t('tasks.recurrence.onceAWeek') });
  }
  return options;
}

export const WORKDAYS = [1, 2, 3, 4, 5];
export const ALL_DAYS = [1, 2, 3, 4, 5, 6, 0];

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

/**
 * Mode switch. Only the mode's own fields change; the repeat rule
 * (`isRecurring`, pattern, days) is left as it is — except for Later, which
 * cannot hold a series.
 */
export function presetPatch(
  id: TaskPresetId,
  defaultMinutes = 30,
): Partial<TaskFormValues> {
  const minutes = defaultMinutes >= 5 ? defaultMinutes : 30;
  if (id === 'unscheduled') {
    return {
      isUnscheduled: true,
      isFixed: false,
      isRecurring: false,
      recurrencePattern: undefined,
      recurrenceWeekDays: [],
      allowSplit: true,
      preferredStartTime: '',
      scheduledStartTime: '',
      scheduledEndTime: '',
      earliestStartTime: '',
      deadline: '',
      eligibleWeekDays: [],
    };
  }
  if (id === 'fixed') {
    return {
      isUnscheduled: false,
      isFixed: true,
      allowSplit: false,
      preferredStartTime: '',
      earliestStartTime: '',
      deadline: '',
      phaseId: '',
    };
  }
  return {
    isUnscheduled: false,
    isFixed: false,
    allowSplit: true,
    estimatedTimeInMinutes: minutes,
    scheduledStartTime: '',
    scheduledEndTime: '',
  };
}

/** Highlight a preset only while current flags still match it. */
export function matchPreset(
  values: Pick<TaskFormValues, 'isFixed' | 'isUnscheduled'>,
): TaskPresetId {
  if (values.isUnscheduled) return 'unscheduled';
  return values.isFixed ? 'fixed' : 'flexible';
}
