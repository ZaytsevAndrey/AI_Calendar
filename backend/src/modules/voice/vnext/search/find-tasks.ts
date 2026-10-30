/**
 * `find_tasks`: the trusted set search for bulk operations.
 * The model chooses structured filters; this function applies them to the caller's whole
 * task catalog and every slot, so the result is the complete set or says it is not.
 * Membership is never decided by the model's own list of ids.
 */
import type { ScheduledTask } from '../../../schedule/schedule.entity';
import { TaskStatus, type Task, isProblematicSchedule } from '../../../tasks/entities/task.entity';
import { localHm, localYmd } from '../../voice-local-date.util';
import type { SearchReceipt } from './receipt';

export const FIND_TASKS_TOOL = 'find_tasks';
export const FIND_TASKS_ARGS = ['day', 'from', 'to', 'nameContains', 'calendarId', 'scheduled'] as const;
/** More members than this is reported as truncated, never cut silently. */
export const FIND_TASKS_CAP = 50;

export type FindTasksArgs = {
  day?: string;
  from?: string;
  to?: string;
  nameContains?: string;
  calendarId?: string;
  scheduled?: boolean;
};

export type FindTasksResult =
  | { error: string }
  | {
      complete: boolean;
      truncated: boolean;
      total: number;
      items: Array<{ id: string; name: string; status: string; starts: string[]; calendarId: string | null; recurring: boolean; state: TaskSearchState }>;
    };

/**
 * Where an open task stands: `later` is the Unscheduled inbox (`isUnscheduled`), `parked` has
 * no seat because placement could not find one (`scheduleState` problematic), `scheduled` has
 * at least one slot, `unplaced` has none yet. A parked task is not a Later task (VC-16).
 */
export type TaskSearchState = 'later' | 'parked' | 'scheduled' | 'unplaced';

export function taskSearchState(task: Pick<Task, 'isUnscheduled' | 'scheduleState'>, slotCount: number): TaskSearchState {
  if (task.isUnscheduled) return 'later';
  if (isProblematicSchedule(task)) return 'parked';
  return slotCount ? 'scheduled' : 'unplaced';
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function parseArgs(raw: Record<string, unknown>): { ok: true; args: FindTasksArgs } | { ok: false; error: string } {
  const args: FindTasksArgs = {};
  for (const key of ['day', 'from', 'to'] as const) {
    if (raw[key] === undefined) continue;
    if (typeof raw[key] !== 'string' || !YMD.test(raw[key] as string)) return { ok: false, error: `invalid_${key}` };
    args[key] = raw[key] as string;
  }
  if (args.day && (args.from || args.to)) return { ok: false, error: 'day_with_range' };
  if (args.from && args.to && args.from > args.to) return { ok: false, error: 'invalid_range' };
  if (raw.nameContains !== undefined) {
    if (typeof raw.nameContains !== 'string' || !raw.nameContains.trim()) return { ok: false, error: 'invalid_nameContains' };
    args.nameContains = raw.nameContains.trim();
  }
  if (raw.calendarId !== undefined) {
    if (typeof raw.calendarId !== 'string' || !raw.calendarId.trim()) return { ok: false, error: 'invalid_calendarId' };
    args.calendarId = raw.calendarId.trim();
  }
  if (raw.scheduled !== undefined) {
    if (typeof raw.scheduled !== 'boolean') return { ok: false, error: 'invalid_scheduled' };
    args.scheduled = raw.scheduled;
  }
  if (!args.day && !args.from && !args.to && !args.nameContains && !args.calendarId && args.scheduled === undefined) {
    return { ok: false, error: 'no_filter' };
  }
  return { ok: true, args };
}

function isOpen(status: TaskStatus): boolean {
  return status !== TaskStatus.COMPLETED && status !== TaskStatus.CANCELED;
}

export function findTasks(
  input: { userId: string; timeZone: string; tasks: readonly Task[]; slots: readonly ScheduledTask[] },
  raw: Record<string, unknown>,
): { result: FindTasksResult; receipt: SearchReceipt } {
  const parsed = parseArgs(raw);
  if (!parsed.ok) return { result: { error: parsed.error }, receipt: { complete: false, failed: true, ids: [] } };
  const args = parsed.args;
  const needle = args.nameContains?.toLocaleLowerCase();
  const slotsByTask = new Map<string, ScheduledTask[]>();
  for (const slot of input.slots) {
    const list = slotsByTask.get(slot.taskId) ?? [];
    list.push(slot);
    slotsByTask.set(slot.taskId, list);
  }
  const matches = input.tasks.filter((task) => {
    if (task.userId !== input.userId) return false;
    // Writes need open rows; a completed or canceled task is not a member.
    if (!isOpen(task.status)) return false;
    if (needle && !task.name.toLocaleLowerCase().includes(needle)) return false;
    const slots = slotsByTask.get(task.id) ?? [];
    if (args.calendarId && !slots.some((slot) => slot.googleEventCalendarId === args.calendarId) && task.googleEventCalendarId !== args.calendarId) {
      return false;
    }
    // `scheduled: false` is the Later inbox, not every task without a slot: a parked task is reported as parked.
    if (args.scheduled === true && !slots.length) return false;
    if (args.scheduled === false && !task.isUnscheduled) return false;
    if (args.day || args.from || args.to) {
      const from = args.day ?? args.from ?? '0000-00-00';
      const to = args.day ?? args.to ?? '9999-99-99';
      const inRange = slots.some((slot) => {
        const ymd = localYmd(new Date(slot.scheduledStartTime).toISOString(), input.timeZone);
        return ymd >= from && ymd <= to;
      });
      if (!inRange) return false;
    }
    return true;
  });
  const truncated = matches.length > FIND_TASKS_CAP;
  const kept = matches.slice(0, FIND_TASKS_CAP);
  return {
    result: {
      complete: !truncated,
      truncated,
      total: matches.length,
      items: kept.map((task) => ({
        id: task.id,
        name: task.name,
        status: task.status,
        starts: (slotsByTask.get(task.id) ?? [])
          .map((slot) => new Date(slot.scheduledStartTime).toISOString())
          .sort()
          .map((iso) => `${localYmd(iso, input.timeZone)} ${localHm(iso, input.timeZone)}`),
        calendarId: task.googleEventCalendarId ?? null,
        recurring: Boolean(task.isRecurring),
        state: taskSearchState(task, (slotsByTask.get(task.id) ?? []).length),
      })),
    },
    receipt: truncated
      ? { complete: false, truncated: true, ids: kept.map((task) => task.id) }
      : { complete: true, ids: kept.map((task) => task.id) },
  };
}
