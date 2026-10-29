import type { TaskDTO } from 'api/tasks.api';

/**
 * Scheduling behavior and recurrence are independent: a task is fixed or
 * flexible, and separately single or recurring (fixed series, flexible
 * series, fixed one-off, flexible one-off). Every UI classification goes
 * through this one helper.
 */
export type SchedulingBehavior = 'fixed' | 'flexible';

export type TaskTraits = {
  /** Fixed: the engine never moves it. Flexible: it may be moved. */
  behavior: SchedulingBehavior;
  /** The task is a series (generates occurrences). */
  recurring: boolean;
  /** A series, a clock sibling, or a detached day copy of one. */
  seriesMember: boolean;
  /** Later inbox: no slot. */
  unscheduled: boolean;
};

export type TraitsSource = Pick<
  TaskDTO,
  'eventType' | 'isRecurring' | 'seriesGroupId' | 'isUnscheduled' | 'isFixedExternal'
>;

export function taskTraits(task: Partial<TraitsSource>): TaskTraits {
  const recurring = !!task.isRecurring;
  return {
    behavior: task.eventType === 'fixed' || task.isFixedExternal ? 'fixed' : 'flexible',
    recurring,
    seriesMember: recurring || !!task.seriesGroupId,
    unscheduled: !!task.isUnscheduled,
  };
}
