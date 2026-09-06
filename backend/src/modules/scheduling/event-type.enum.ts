/** Legacy column values. New writes use only FIXED or ADMIN. */
export enum TaskEventType {
  FIXED = 'fixed',
  ADMIN = 'admin',
  /** @deprecated stored rows only */
  DAILY_ROUTINE = 'daily_routine',
  /** @deprecated stored rows only */
  QUICK_WIN = 'quick_win',
  /** @deprecated stored rows only */
  DEEP_WORK = 'deep_work',
  /** @deprecated stored rows only */
  ERRAND = 'errand',
  /** @deprecated stored rows only */
  FOCUS_BLOCK = 'focus_block',
  /** @deprecated stored rows only */
  LEARNING = 'learning',
}

export interface EventTypeRules {
  movable: boolean;
  splittable: boolean;
  defaultDurationMinutes: number;
}

const FIXED_RULES: EventTypeRules = {
  movable: false,
  splittable: false,
  defaultDurationMinutes: 60,
};

const FLEXIBLE_RULES: EventTypeRules = {
  movable: true,
  splittable: true,
  defaultDurationMinutes: 30,
};

export function isFixedEventType(type?: TaskEventType | string | null): boolean {
  return type === TaskEventType.FIXED;
}

export function getEventTypeRules(type: TaskEventType): EventTypeRules {
  return isFixedEventType(type) ? FIXED_RULES : FLEXIBLE_RULES;
}
