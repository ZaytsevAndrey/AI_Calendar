import type { CalendarProviderId } from './calendar-provider.types';

/** Hide-storage key: Google uses the raw calendar id; other providers use `provider:id`. */
export function isHiddenCalendar(
  provider: CalendarProviderId,
  calendarId: string | undefined,
  hiddenIds: string[],
): boolean {
  if (!calendarId) return false;
  const hidden = new Set(hiddenIds);
  if (provider === 'google') return hidden.has(calendarId);
  return hidden.has(`${provider}:${calendarId}`) || hidden.has(calendarId);
}
