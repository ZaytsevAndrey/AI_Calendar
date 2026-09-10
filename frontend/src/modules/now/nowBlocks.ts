import type { GoogleCalendarEvent } from '../../api/google-calendar.api';
import type { TaskDTO } from '../../api/tasks.api';
import { isCurrentTask } from '../events/utils/isCurrentTask';
import { eventEndDate, eventStartDate, visibleGoogleEvents } from '../calendar/calendarView';
import {
  addDaysToYmd,
  civilDayQueryRange,
  localDateTimeIso,
  localYmd,
} from '../../utils/ianaDateTime';
import { resolveIanaTimeZone } from '../user-settings/ianaTimeZones';

const PRIORITY_RANK: Record<TaskDTO['priority'], number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export type NowBlock = {
  key: string;
  title: string;
  startMs: number;
  endMs: number;
  allDay: boolean;
  task: TaskDTO | null;
  event: GoogleCalendarEvent | null;
};

const MAX_UNSCHEDULED = 5;

export function weekdayIndexUtc(ymd: string): number {
  const [year, month, day] = ymd.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function canCompleteNowBlock(block: NowBlock): boolean {
  const task = block.task;
  if (!task) return false;
  if (task.isRecurring || task.isFixedExternal) return false;
  if (task.status === 'completed' || task.status === 'canceled') return false;
  return true;
}

export function matchTaskToEvent(tasks: TaskDTO[], event: GoogleCalendarEvent): TaskDTO | undefined {
  const ids = [event.id, event.recurringEventId].filter(Boolean) as string[];
  if (!ids.length) return undefined;
  return tasks.find((task) => task.googleEventId && ids.includes(task.googleEventId));
}

function eventBounds(
  event: GoogleCalendarEvent,
  todayYmd: string,
  timeZone: string,
): { startMs: number; endMs: number; allDay: boolean } | null {
  const zone = resolveIanaTimeZone(timeZone);
  if (!event.start?.dateTime && event.start?.date) {
    const startYmd = event.start.date;
    const endYmd = event.end?.date || addDaysToYmd(startYmd, 1);
    if (todayYmd < startYmd || todayYmd >= endYmd) return null;
    const startMs = new Date(localDateTimeIso(todayYmd, '00:00', zone)).getTime();
    const endMs = new Date(localDateTimeIso(addDaysToYmd(todayYmd, 1), '00:00', zone)).getTime();
    return { startMs, endMs, allDay: true };
  }
  const start = eventStartDate(event);
  const end = eventEndDate(event);
  if (!start) return null;
  const startMs = start.getTime();
  const endMs = end && !Number.isNaN(end.getTime()) ? end.getTime() : startMs + 30 * 60 * 1000;
  if (!(endMs > startMs)) return null;
  return { startMs, endMs, allDay: false };
}

export function todayWindowIncludesTask(
  task: Pick<TaskDTO, 'earliestStartTime' | 'deadline' | 'eligibleWeekDays'>,
  todayYmd: string,
  timeZone: string,
): boolean {
  const { timeMin, timeMax } = civilDayQueryRange(todayYmd, timeZone);
  const dayStart = new Date(timeMin).getTime();
  const dayEnd = new Date(timeMax).getTime();
  const from = task.earliestStartTime ? new Date(task.earliestStartTime).getTime() : Number.NEGATIVE_INFINITY;
  const until = task.deadline ? new Date(task.deadline).getTime() : Number.POSITIVE_INFINITY;
  if (Number.isNaN(from) || Number.isNaN(until)) return true;
  if (from >= dayEnd || until < dayStart) return false;
  const days = task.eligibleWeekDays;
  if (days?.length) {
    return days.includes(weekdayIndexUtc(todayYmd));
  }
  return true;
}

function taskTimedBounds(task: TaskDTO): { startMs: number; endMs: number } | null {
  if (!task.scheduledStartTime || !task.scheduledEndTime) return null;
  const startMs = new Date(task.scheduledStartTime).getTime();
  const endMs = new Date(task.scheduledEndTime).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || !(endMs > startMs)) return null;
  return { startMs, endMs };
}

export function buildNowBlocks(
  events: GoogleCalendarEvent[],
  tasks: TaskDTO[],
  todayYmd: string,
  timeZone: string,
): NowBlock[] {
  const zone = resolveIanaTimeZone(timeZone);
  const { timeMin, timeMax } = civilDayQueryRange(todayYmd, zone);
  const dayStart = new Date(timeMin).getTime();
  const dayEnd = new Date(timeMax).getTime();
  const activeTasks = tasks.filter((task) => isCurrentTask(task));
  const usedTaskIds = new Set<string>();
  const blocks: NowBlock[] = [];

  for (const event of visibleGoogleEvents(events)) {
    const bounds = eventBounds(event, todayYmd, zone);
    if (!bounds) continue;
    const overlapsToday = bounds.startMs < dayEnd && bounds.endMs > dayStart;
    if (!overlapsToday) continue;
    const task = matchTaskToEvent(activeTasks, event) ?? null;
    if (task?.status === 'completed' || task?.status === 'canceled') continue;
    if (task) usedTaskIds.add(task.id);
    blocks.push({
      key: `event:${event.id}`,
      title: event.summary?.trim() || task?.name || 'Event',
      startMs: bounds.startMs,
      endMs: bounds.endMs,
      allDay: bounds.allDay,
      task,
      event,
    });
  }

  for (const task of activeTasks) {
    if (usedTaskIds.has(task.id)) continue;
    const bounds = taskTimedBounds(task);
    if (!bounds) continue;
    if (!(bounds.startMs < dayEnd && bounds.endMs > dayStart)) continue;
    blocks.push({
      key: `task:${task.id}`,
      title: task.name,
      startMs: bounds.startMs,
      endMs: bounds.endMs,
      allDay: false,
      task,
      event: null,
    });
  }

  return blocks;
}

function currentScore(block: NowBlock, nowMs: number): number {
  const remaining = block.endMs - nowMs;
  const startedAgo = nowMs - block.startMs;
  return startedAgo * 1_000_000 + (1_000_000_000 - remaining);
}

export function pickNowAndNext(
  blocks: NowBlock[],
  nowMs: number,
  todayEndMs: number,
): { now: NowBlock | null; next: NowBlock | null } {
  const current = blocks.filter((block) => block.startMs <= nowMs && nowMs < block.endMs);
  const timedCurrent = current.filter((block) => !block.allDay);
  const nowPool = timedCurrent.length ? timedCurrent : current;
  nowPool.sort((a, b) => currentScore(b, nowMs) - currentScore(a, nowMs));
  const now = nowPool[0] ?? null;

  const upcoming = blocks
    .filter((block) => block.startMs > nowMs && block.startMs < todayEndMs)
    .filter((block) => !now || block.key !== now.key)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const next = upcoming[0] ?? null;
  return { now, next };
}

export function unscheduledTasksForToday(
  tasks: TaskDTO[],
  occupiedTaskIds: Set<string>,
  todayYmd: string,
  timeZone: string,
): TaskDTO[] {
  return tasks
    .filter((task) => isCurrentTask(task))
    .filter((task) => !occupiedTaskIds.has(task.id))
    .filter((task) => !taskTimedBounds(task))
    .filter((task) => todayWindowIncludesTask(task, todayYmd, timeZone))
    .sort((a, b) => {
      const rank = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      if (rank !== 0) return rank;
      return a.createdAt.localeCompare(b.createdAt);
    })
    .slice(0, MAX_UNSCHEDULED);
}

export function todayNowContext(nowIso: string, timeZone: string) {
  const zone = resolveIanaTimeZone(timeZone);
  const todayYmd = localYmd(nowIso, zone);
  const range = civilDayQueryRange(todayYmd, zone);
  const yesterdayYmd = addDaysToYmd(todayYmd, -1);
  const fetchRange = civilDayQueryRange(yesterdayYmd, zone);
  return {
    todayYmd,
    timeZone: zone,
    todayEndMs: new Date(range.timeMax).getTime(),
    fetchTimeMin: fetchRange.timeMin,
    fetchTimeMax: range.timeMax,
  };
}
