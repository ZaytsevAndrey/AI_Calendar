import type { GoogleCalendarListItem } from '../../api/google-calendar.api';

export type { GoogleCalendarListItem };

export type CalendarVisibilityRow = {
  id: string;
  label: string;
  checked: boolean;
  disabled: boolean;
};

const READABLE_ROLES = new Set(['owner', 'writer', 'reader']);

function canList(item: GoogleCalendarListItem): boolean {
  if (!item.id) return false;
  if (item.primary) return true;
  if (item.selected === false) return false;
  if (item.accessRole && !READABLE_ROLES.has(item.accessRole)) return false;
  return true;
}

/**
 * Rows for the Calendar page picker.
 * Checked means the calendar is drawn. The app calendar stays checked and disabled.
 */
export function calendarVisibilityRows(input: {
  items: GoogleCalendarListItem[];
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
    const isApp = Boolean(input.appCalendarId && item.id === input.appCalendarId);
    push({
      id: item.id,
      label: item.summary?.trim() || (item.primary ? 'Primary' : item.id),
      checked: isApp || !hidden.has(item.id),
      disabled: isApp,
    });
  }

  if (input.appCalendarId && !seen.has(input.appCalendarId)) {
    push({
      id: input.appCalendarId,
      label: input.appCalendarName?.trim() || 'App calendar',
      checked: true,
      disabled: true,
    });
  }

  rows.sort((a, b) => {
    if (a.disabled !== b.disabled) return a.disabled ? -1 : 1;
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
