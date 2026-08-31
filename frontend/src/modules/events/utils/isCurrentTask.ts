import { TaskDTO } from '../../../api/tasks.api';

/** True when a one-off task's scheduled window has already ended. Recurring series stay current. */
export function hasTaskAlreadyEnded(task: Pick<TaskDTO, 'isRecurring' | 'scheduledEndTime'>, now = new Date()): boolean {
  if (task.isRecurring) return false;
  if (!task.scheduledEndTime) return false;
  const end = new Date(task.scheduledEndTime);
  if (Number.isNaN(end.getTime())) return false;
  return end.getTime() < now.getTime();
}

/** Active work: not completed/canceled, and not a finished one-off occurrence. */
export function isCurrentTask(task: TaskDTO, now = new Date()): boolean {
  if (task.status === 'completed' || task.status === 'canceled') return false;
  return !hasTaskAlreadyEnded(task, now);
}
