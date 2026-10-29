import type { TaskDTO } from 'api/tasks.api';

/** Parked tasks the user just acted on; their exit from the inbox is not news. */
const handledByUser = new Set<string>();

export function markProblematicHandled(taskId: string): void {
  handledByUser.add(taskId);
}

/**
 * Parked tasks (in `previous`) that now hold a slot without the user acting
 * on them: a freed hole seated them. Consumes the user-handled marks it sees.
 */
export function autoSeatedFromPark(
  previousParkedIds: ReadonlySet<string>,
  tasks: TaskDTO[],
): TaskDTO[] {
  const seated: TaskDTO[] = [];
  for (const task of tasks) {
    if (!previousParkedIds.has(task.id)) continue;
    if (task.scheduleState === 'problematic') continue;
    if (handledByUser.delete(task.id)) continue;
    if (task.scheduleState === 'none' && task.scheduledStartTime) seated.push(task);
  }
  return seated;
}
