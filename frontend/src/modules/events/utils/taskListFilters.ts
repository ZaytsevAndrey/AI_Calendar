import type { TaskDTO } from '../../../api/tasks.api';
import { deadlineTone } from './deadlineTone';
import { hasTaskAlreadyEnded, isCurrentTask } from './isCurrentTask';

export type TaskStatusFilter = 'active' | 'all' | 'todo' | 'in_progress' | 'completed' | 'canceled';
export type ScheduleModeFilter = 'any' | 'fixed' | 'flexible' | 'recurring';

export type TaskNameStatusFilters = {
  query: string;
  status: TaskStatusFilter;
  overdueOnly: boolean;
};

export type ScheduledTaskFilters = TaskNameStatusFilters & {
  /** `any`, `none`, or a phase id. */
  phaseId: string;
  mode: ScheduleModeFilter;
};

export function matchesTaskName(name: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return name.toLowerCase().includes(needle);
}

/** Same status rules the Tasks page used before search: Active hides finished work. */
export function matchesStatusFilter(
  task: Pick<TaskDTO, 'status' | 'isRecurring' | 'scheduledEndTime'>,
  status: TaskStatusFilter,
  now = new Date(),
): boolean {
  if (status === 'all') return true;
  if (status === 'active') return isCurrentTask(task as TaskDTO, now);
  if (task.status !== status) return false;
  if (status === 'todo' || status === 'in_progress') {
    return !hasTaskAlreadyEnded(task, now);
  }
  return true;
}

/** Deadline already passed, and the task is still open. */
export function isOverdueOpenTask(
  task: Pick<TaskDTO, 'deadline' | 'status'>,
  nowMs = Date.now(),
): boolean {
  if (task.status === 'completed' || task.status === 'canceled') return false;
  return deadlineTone(task.deadline, nowMs) === 'overdue';
}

export function taskPhaseIds(task: Pick<TaskDTO, 'phaseId' | 'phase' | 'phases'>): string[] {
  const ids = new Set<string>();
  if (task.phaseId) ids.add(task.phaseId);
  if (task.phase?.id) ids.add(task.phase.id);
  for (const phase of task.phases ?? []) {
    if (phase?.id) ids.add(phase.id);
  }
  return [...ids];
}

export function scheduleModeOf(
  task: Pick<TaskDTO, 'isRecurring' | 'eventType'>,
): Exclude<ScheduleModeFilter, 'any'> {
  if (task.isRecurring) return 'recurring';
  if (task.eventType === 'fixed') return 'fixed';
  return 'flexible';
}

function matchesNameStatus(task: TaskDTO, filters: TaskNameStatusFilters, now: Date): boolean {
  if (!matchesTaskName(task.name, filters.query)) return false;
  if (!matchesStatusFilter(task, filters.status, now)) return false;
  if (filters.overdueOnly && !isOverdueOpenTask(task, now.getTime())) return false;
  return true;
}

export function filterUnscheduledTasks(
  tasks: TaskDTO[],
  filters: TaskNameStatusFilters,
  now = new Date(),
): TaskDTO[] {
  return tasks.filter((task) => !!task.isUnscheduled && matchesNameStatus(task, filters, now));
}

export function filterScheduledTasks(
  tasks: TaskDTO[],
  filters: ScheduledTaskFilters,
  now = new Date(),
): TaskDTO[] {
  return tasks.filter((task) => {
    if (task.isUnscheduled) return false;
    if (!matchesNameStatus(task, filters, now)) return false;
    if (filters.mode !== 'any' && scheduleModeOf(task) !== filters.mode) return false;
    if (filters.phaseId === 'any') return true;
    const phaseIds = taskPhaseIds(task);
    if (filters.phaseId === 'none') return phaseIds.length === 0;
    return phaseIds.includes(filters.phaseId);
  });
}
