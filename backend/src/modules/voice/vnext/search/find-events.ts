/**
 * `find_events`: read the user's provider calendar events so the voice agent can act on an event
 * that is not a Luefy task. Results become authorized catalog rows for this turn only.
 * Events synced from Luefy tasks are left out; those are reached through the task.
 */
import type { ProviderEvent } from '../../../calendar-providers/calendar-provider.types';
import { addDaysToYmd } from '../../voice-local-date.util';
import type { EntityRecord } from '../reference/reference-resolver';

export const FIND_EVENTS_TOOL = 'find_events';
export const FIND_EVENTS_ARGS = ['day', 'from', 'to', 'nameContains'] as const;
/** A longer window is a broad scan the voice agent does not need. */
export const FIND_EVENTS_MAX_DAYS = 31;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export type FindEventsArgs = { from: string; to: string; nameContains?: string };

export function parseFindEventsArgs(raw: Record<string, unknown>): { ok: true; args: FindEventsArgs } | { ok: false; error: string } {
  for (const key of ['day', 'from', 'to'] as const) {
    if (raw[key] !== undefined && (typeof raw[key] !== 'string' || !YMD.test(raw[key] as string))) return { ok: false, error: `invalid_${key}` };
  }
  const day = raw.day as string | undefined;
  if (day && (raw.from || raw.to)) return { ok: false, error: 'day_with_range' };
  const from = day ?? (raw.from as string | undefined);
  const to = day ?? (raw.to as string | undefined) ?? from;
  if (!from || !to) return { ok: false, error: 'missing_day' };
  if (from > to) return { ok: false, error: 'invalid_range' };
  if (addDaysToYmd(from, FIND_EVENTS_MAX_DAYS) < to) return { ok: false, error: 'range_too_long' };
  if (raw.nameContains !== undefined && (typeof raw.nameContains !== 'string' || !raw.nameContains.trim())) {
    return { ok: false, error: 'invalid_nameContains' };
  }
  return { ok: true, args: { from, to, ...(raw.nameContains ? { nameContains: (raw.nameContains as string).trim() } : {}) } };
}

export function externalEntityId(event: Pick<ProviderEvent, 'provider' | 'id'>): string {
  return `ext:${event.provider}:${event.id}`;
}

/**
 * One provider event as a catalog row, or null when it is a Luefy task's own event or is cancelled.
 * Writable only for a timed event the user organizes; an invitation or an all-day event is read-only.
 */
export function externalRecord(
  event: ProviderEvent,
  userId: string,
  syncedEventIds: ReadonlySet<string>,
  revision: (text: string) => number,
): EntityRecord | null {
  if (event.status === 'cancelled' || event.isAppGenerated || syncedEventIds.has(event.id)) return null;
  const start = event.start?.dateTime ? new Date(event.start.dateTime).toISOString() : null;
  const end = event.end?.dateTime ? new Date(event.end.dateTime).toISOString() : null;
  const organized = event.organizer ? event.organizer.self === true : true;
  return {
    id: externalEntityId(event),
    userId,
    type: 'external_event',
    name: event.summary?.trim() || '(untitled)',
    status: 'open',
    revision: revision([event.updated ?? '', start ?? event.start?.date ?? '', end ?? event.end?.date ?? '', event.status ?? '', event.summary ?? ''].join('|')),
    ...(event.calendarId ? { calendarId: event.calendarId } : {}),
    ...(event.recurringEventId ? { recurring: true } : {}),
    scheduledStart: start,
    scheduledEnd: end,
    googleEventId: event.id,
    writable: Boolean(start && end && organized),
    provider: event.provider,
  };
}
