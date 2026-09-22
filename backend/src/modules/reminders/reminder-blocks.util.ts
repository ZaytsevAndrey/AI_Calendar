import {
  REMINDER_LOOKAHEAD_MS,
  startsWithinLookahead,
  type TimedReminderBlock,
} from './reminder-due.util';

const MAX_SPAN_MS = 36 * 60 * 60 * 1000;

export type ReminderGoogleEvent = {
  id?: string | null;
  summary?: string | null;
  status?: string | null;
  recurringEventId?: string | null;
  start?: { dateTime?: string | null; date?: string | null } | null;
};

export type ReminderTaskRow = {
  id: string;
  name: string;
  status: string;
  isUnscheduled?: boolean;
  googleEventId?: string | null;
  scheduledStartTime?: Date | string | null;
  scheduledEndTime?: Date | string | null;
};

function toMs(value: Date | string | null | undefined): number | null {
  if (value == null || value === '') return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Timed blocks from the same sources as Now/Next that start within the lookahead.
 * All-day events are omitted: their start is midnight.
 */
export function buildTimedReminderBlocks(input: {
  nowMs: number;
  lookaheadMs?: number;
  events: ReminderGoogleEvent[];
  tasks: ReminderTaskRow[];
}): TimedReminderBlock[] {
  const lookaheadMs = input.lookaheadMs ?? REMINDER_LOOKAHEAD_MS;
  const imminent = (startMs: number) =>
    startsWithinLookahead(startMs, input.nowMs, lookaheadMs);
  const blocks: TimedReminderBlock[] = [];
  const coveredGoogleIds = new Set<string>();

  for (const event of input.events) {
    if (!event?.id || event.status === 'cancelled') continue;
    const dateTime = event.start?.dateTime;
    if (!dateTime) continue;
    const startMs = toMs(dateTime);
    if (startMs == null || !imminent(startMs)) continue;
    coveredGoogleIds.add(event.id);
    if (event.recurringEventId) coveredGoogleIds.add(event.recurringEventId);
    blocks.push({
      key: `event:${event.id}`,
      title: event.summary?.trim() || 'Event',
      startMs,
    });
  }

  for (const task of input.tasks) {
    if (task.status === 'completed' || task.status === 'canceled') continue;
    if (task.isUnscheduled) continue;
    if (task.googleEventId && coveredGoogleIds.has(task.googleEventId)) continue;
    const startMs = toMs(task.scheduledStartTime);
    const endMs = toMs(task.scheduledEndTime);
    if (startMs == null || endMs == null || !(endMs > startMs)) continue;
    if (endMs - startMs > MAX_SPAN_MS) continue;
    if (!imminent(startMs)) continue;
    blocks.push({
      key: `task:${task.id}`,
      title: task.name?.trim() || 'Task',
      startMs,
    });
  }

  return blocks;
}
