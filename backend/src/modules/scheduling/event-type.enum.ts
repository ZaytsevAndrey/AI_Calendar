export enum TaskEventType {
  FIXED = 'fixed',
  DAILY_ROUTINE = 'daily_routine',
  QUICK_WIN = 'quick_win',
  DEEP_WORK = 'deep_work',
  ERRAND = 'errand',
  ADMIN = 'admin',
  FOCUS_BLOCK = 'focus_block',
  LEARNING = 'learning',
}

export interface EventTypeRules {
  movable: boolean;
  splittable: boolean;
  defaultDurationMinutes: number;
}

export const EVENT_TYPE_RULES: Record<TaskEventType, EventTypeRules> = {
  [TaskEventType.FIXED]: {
    movable: false,
    splittable: false,
    defaultDurationMinutes: 60,
  },
  [TaskEventType.DAILY_ROUTINE]: {
    movable: true,
    splittable: true,
    defaultDurationMinutes: 30,
  },
  [TaskEventType.QUICK_WIN]: {
    movable: true,
    splittable: false,
    defaultDurationMinutes: 15,
  },
  [TaskEventType.DEEP_WORK]: {
    movable: true,
    splittable: true,
    defaultDurationMinutes: 120,
  },
  [TaskEventType.ERRAND]: {
    movable: true,
    splittable: false,
    defaultDurationMinutes: 45,
  },
  [TaskEventType.ADMIN]: {
    movable: true,
    splittable: true,
    defaultDurationMinutes: 30,
  },
  [TaskEventType.FOCUS_BLOCK]: {
    movable: true,
    splittable: true,
    defaultDurationMinutes: 90,
  },
  [TaskEventType.LEARNING]: {
    movable: true,
    splittable: true,
    defaultDurationMinutes: 60,
  },
};

export function getEventTypeRules(type: TaskEventType): EventTypeRules {
  return EVENT_TYPE_RULES[type] ?? EVENT_TYPE_RULES[TaskEventType.ADMIN];
}
