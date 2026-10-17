import type { GoogleCalendarListItem } from '../../api/google-calendar.api';
import type { CalendarProviderId } from './schedulingKind';

export type { GoogleCalendarListItem };

export type ProviderCalendarItem = {
  id: string;
  summary: string;
  primary?: boolean;
  selected?: boolean;
  accessRole?: string;
  provider: CalendarProviderId;
};

export type CalendarVisibilityRow = {
  /** Stored hide key: Google uses plain id; other providers use `provider:id`. */
  id: string;
  label: string;
  checked: boolean;
  disabled: boolean;
  provider: CalendarProviderId;
};

const READABLE_ROLES = new Set(['owner', 'writer', 'reader']);

function canList(item: {
  id?: string | null;
  primary?: boolean | null;
  selected?: boolean | null;
  accessRole?: string | null;
}): boolean {
  if (!item.id) return false;
  if (item.primary) return true;
  if (item.selected === false) return false;
  if (item.accessRole && !READABLE_ROLES.has(item.accessRole)) return false;
  return true;
}

/** Hide-storage key for a calendar (avoids id collisions across providers). */
export function calendarHideKey(
  provider: CalendarProviderId,
  calendarId: string,
): string {
  return provider === 'google' ? calendarId : `${provider}:${calendarId}`;
}

/**
 * Rows for the Calendar page picker, grouped by provider in the UI.
 * Checked means the calendar is drawn. The app calendar stays checked and disabled.
 */
export function calendarVisibilityRows(input: {
  items: Array<GoogleCalendarListItem | ProviderCalendarItem>;
  hiddenIds: string[];
  appCalendarId?: string | null;
  appCalendarName?: string | null;
}): CalendarVisibilityRow[] {
  const hidden = new Set(input.hiddenIds);
  const rows: CalendarVisibilityRow[] = [];
  const seen = new Set<string>();

  const push = (row: CalendarVisibilityRow) => {
    if (seen.has(row.id)) return;
    seen.add(row.id);
    rows.push(row);
  };

  for (const item of input.items) {
    if (!canList(item) || !item.id) continue;
    const provider: CalendarProviderId =
      'provider' in item && item.provider ? item.provider : 'google';
    const isApp = Boolean(
      provider === 'google' &&
        input.appCalendarId &&
        item.id === input.appCalendarId,
    );
    const hideKey = calendarHideKey(provider, item.id);
    push({
      id: hideKey,
      label: item.summary?.trim() || (item.primary ? 'Primary' : item.id),
      checked: isApp || !hidden.has(hideKey),
      disabled: isApp,
      provider,
    });
  }

  if (input.appCalendarId && !seen.has(input.appCalendarId)) {
    push({
      id: input.appCalendarId,
      label: input.appCalendarName?.trim() || 'App calendar',
      checked: true,
      disabled: true,
      provider: 'google',
    });
  }

  rows.sort((a, b) => {
    if (a.disabled !== b.disabled) return a.disabled ? -1 : 1;
    if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
    return a.label.localeCompare(b.label);
  });
  return rows;
}

export function nextHiddenCalendarIds(
  hiddenIds: string[],
  calendarId: string,
  visible: boolean,
  appCalendarId?: string | null,
): string[] {
  if (appCalendarId && calendarId === appCalendarId) return hiddenIds;
  const next = hiddenIds.filter((id) => id !== calendarId);
  if (!visible) next.push(calendarId);
  return next;
}

/** True when an event's calendar is not in the hidden list. */
export function isCalendarVisible(
  provider: CalendarProviderId | undefined,
  calendarId: string | undefined,
  hiddenIds: string[],
): boolean {
  if (!calendarId) return true;
  const p = provider ?? 'google';
  const hidden = new Set(hiddenIds);
  if (hidden.has(calendarHideKey(p, calendarId))) return false;
  if (p !== 'google' && hidden.has(calendarId)) return false;
  return true;
}
