import { startOfLocalDayIso } from '../voice/voice-local-date.util';
import type { MsInterval } from './free-slots.util';

export type ExternalEventLike = {
  id?: string | null;
  recurringEventId?: string | null;
  status?: string | null;
  transparency?: string | null;
  summary?: string | null;
  start?: { dateTime?: string | null; date?: string | null } | null;
  end?: { dateTime?: string | null; date?: string | null } | null;
};

export type ExternalBusyInterval = MsInterval & { label?: string };

export function isSyncedExternalEvent(
  ev: { id?: string | null; recurringEventId?: string | null },
  excludeIds: Set<string> | undefined,
): boolean {
  if (!excludeIds?.size) return false;
  if (ev.id && excludeIds.has(ev.id)) return true;
  if (ev.recurringEventId && excludeIds.has(ev.recurringEventId)) return true;
  return false;
}

/**
 * Timed events are busy. All-day events are busy only when `includeAllDay`.
 * Cancelled and transparent ("show as free") events are ignored.
 * Ids in `excludeIds` are the app's own synced events (task, slot, or habit).
 */
export function providerEventsToBusyIntervals(
  events: ExternalEventLike[],
  opts: {
    excludeIds?: Set<string>;
    timeZone: string;
    includeAllDay?: boolean;
  },
): ExternalBusyInterval[] {
  const busy: ExternalBusyInterval[] = [];
  for (const ev of events) {
    const iv = providerEventToBusyInterval(ev, opts);
    if (iv) busy.push(iv);
  }
  return busy;
}

export function providerEventToBusyInterval(
  ev: ExternalEventLike,
  opts: {
    excludeIds?: Set<string>;
    timeZone: string;
    includeAllDay?: boolean;
  },
): ExternalBusyInterval | null {
  if (!ev || ev.status === 'cancelled') return null;
  if (ev.transparency === 'transparent') return null;
  if (isSyncedExternalEvent(ev, opts.excludeIds)) return null;
  const label = typeof ev.summary === 'string' ? ev.summary.trim() : '';
  if (ev.start?.dateTime && ev.end?.dateTime) {
    const start = new Date(ev.start.dateTime).getTime();
    const end = new Date(ev.end.dateTime).getTime();
    if (!(end > start)) return null;
    return { start, end, ...(label ? { label } : {}) };
  }
  if (!opts.includeAllDay || !ev.start?.date || !ev.end?.date) return null;
  const start = new Date(
    startOfLocalDayIso(ev.start.date, opts.timeZone),
  ).getTime();
  const end = new Date(
    startOfLocalDayIso(ev.end.date, opts.timeZone),
  ).getTime();
  if (!(end > start)) return null;
  return { start, end, ...(label ? { label } : {}) };
}
