const READABLE_ROLES = new Set(['owner', 'writer', 'reader']);

export type DisplayCalendarListItem = {
  id?: string | null;
  primary?: boolean | null;
  selected?: boolean | null;
  accessRole?: string | null;
};

/**
 * Calendars drawn on the Calendar page.
 * Default is primary + the app calendar + Google calendars with selected !== false.
 * Hidden ids remove calendars from that set. The app calendar is always included.
 */
export function displayCalendarIds(input: {
  items: DisplayCalendarListItem[];
  hiddenIds: string[];
  appCalendarId: string | null;
  listFailed?: boolean;
}): string[] {
  const hidden = new Set(input.hiddenIds.filter((id) => id.length > 0));
  if (input.appCalendarId) hidden.delete(input.appCalendarId);

  let hidePrimary = hidden.has('primary');
  for (const item of input.items) {
    if (item?.primary && item.id && hidden.has(item.id)) hidePrimary = true;
  }

  const ids = new Set<string>();
  if (!hidePrimary) ids.add('primary');
  if (input.appCalendarId) ids.add(input.appCalendarId);

  if (!input.listFailed) {
    for (const item of input.items) {
      if (!item?.id || item.primary || item.selected === false) continue;
      if (item.accessRole && !READABLE_ROLES.has(item.accessRole)) continue;
      if (hidden.has(item.id)) continue;
      ids.add(item.id);
    }
  }

  return [...ids];
}
