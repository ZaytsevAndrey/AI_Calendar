import type { TaskDTO } from '../../../api/tasks.api';

export type SeriesMemberKind = 'series' | 'oneOff' | 'problematic';

export type TaskListEntry =
  | { kind: 'single'; task: TaskDTO }
  | {
      kind: 'group';
      seriesGroupId: string;
      title: string;
      members: Array<{ task: TaskDTO; memberKind: SeriesMemberKind }>;
    };

export function seriesMemberKind(task: Pick<TaskDTO, 'isRecurring' | 'scheduleState'>): SeriesMemberKind {
  if (task.scheduleState === 'problematic') return 'problematic';
  if (task.isRecurring) return 'series';
  return 'oneOff';
}

function pickGroupTitle(members: TaskDTO[], seriesGroupId: string): string {
  const primary = members.find((task) => task.id === seriesGroupId);
  if (primary) return primary.name;
  const recurring = members.find((task) => task.isRecurring);
  if (recurring) return recurring.name;
  return members[0]?.name ?? '';
}

/**
 * Collapse filtered tasks that share `seriesGroupId` into a group entry.
 * Lone members (or null group id) stay as single rows.
 */
export function groupTasksBySeriesGroup(tasks: TaskDTO[]): TaskListEntry[] {
  const byGroup = new Map<string, TaskDTO[]>();
  const order: Array<{ type: 'single'; task: TaskDTO } | { type: 'group'; seriesGroupId: string }> = [];

  for (const task of tasks) {
    const groupId = task.seriesGroupId?.trim() || '';
    if (!groupId) {
      order.push({ type: 'single', task });
      continue;
    }
    const existing = byGroup.get(groupId);
    if (existing) {
      existing.push(task);
      continue;
    }
    byGroup.set(groupId, [task]);
    order.push({ type: 'group', seriesGroupId: groupId });
  }

  const entries: TaskListEntry[] = [];
  for (const item of order) {
    if (item.type === 'single') {
      entries.push({ kind: 'single', task: item.task });
      continue;
    }
    const members = byGroup.get(item.seriesGroupId) ?? [];
    if (members.length < 2) {
      const only = members[0];
      if (only) entries.push({ kind: 'single', task: only });
      continue;
    }
    entries.push({
      kind: 'group',
      seriesGroupId: item.seriesGroupId,
      title: pickGroupTitle(members, item.seriesGroupId),
      members: members.map((task) => ({ task, memberKind: seriesMemberKind(task) })),
    });
  }
  return entries;
}
