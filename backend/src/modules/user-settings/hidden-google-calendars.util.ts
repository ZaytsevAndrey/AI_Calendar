const MAX_HIDDEN = 50;
const MAX_ID_LENGTH = 1024;

/** Hide-list key for the app calendar. Non-Google ids are prefixed. */
export function appCalendarHideKey(
  provider: string | null | undefined,
  ids: {
    google?: string | null;
    microsoft?: string | null;
    apple?: string | null;
  },
): string | null {
  const p =
    provider === 'microsoft' || provider === 'apple' ? provider : 'google';
  const id =
    p === 'microsoft' ? ids.microsoft : p === 'apple' ? ids.apple : ids.google;
  if (!id) return null;
  return p === 'google' ? id : `${p}:${id}`;
}

/** Drop blanks, duplicates, and the app calendar so it cannot be hidden. */
export function normalizeHiddenCalendarIds(
  raw: unknown,
  appCalendarId?: string | null,
): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const id = item.trim();
    if (!id || id.length > MAX_ID_LENGTH) continue;
    if (appCalendarId && id === appCalendarId) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_HIDDEN) break;
  }
  return out;
}
