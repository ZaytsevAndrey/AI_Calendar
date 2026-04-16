import type { TaskEventType } from '../../../api/tasks.api';

export const EVENT_TYPE_OPTIONS: { value: TaskEventType; label: string; hint: string }[] = [
  { value: 'fixed', label: 'Fixed block', hint: 'You set exact start and end; planner will not move it.' },
  { value: 'daily_routine', label: 'Daily routine', hint: 'Repeating habit-style work; can be split if allowed.' },
  { value: 'quick_win', label: 'Quick win', hint: 'Short focused item; not splittable by type rules.' },
  { value: 'deep_work', label: 'Deep work', hint: 'Long focus; may be split into chunks when enabled.' },
  { value: 'errand', label: 'Errand', hint: 'Bounded real-world task.' },
  { value: 'admin', label: 'Admin', hint: 'General backlog item (default style).' },
  { value: 'focus_block', label: 'Focus block', hint: 'Protected focus window.' },
  { value: 'learning', label: 'Learning', hint: 'Study or practice time.' },
];

export const SPLITTABLE_TYPES = new Set<TaskEventType>([
  'daily_routine',
  'deep_work',
  'admin',
  'focus_block',
  'learning',
]);

export const DEFAULT_DURATION_BY_TYPE: Partial<Record<TaskEventType, number>> = {
  fixed: 60,
  daily_routine: 30,
  quick_win: 15,
  deep_work: 120,
  errand: 45,
  admin: 30,
  focus_block: 90,
  learning: 60,
};

export const WIZARD_STEP_LABELS = ['Type & Context', 'Details', 'Scheduling', 'Review'] as const;

export const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
] as const;
