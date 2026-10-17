/**
 * Apple CalDAV object URLs contain `/` (and often look like full https URLs).
 * Nest/Fastify path params cannot carry those safely even when percent-encoded
 * (decoded slashes split the route). Use base64url opaque ids in API paths.
 */

export function encodeAppleObjectId(objectUrl: string): string {
  return Buffer.from(objectUrl, 'utf8').toString('base64url');
}

/** Resolve opaque id or legacy raw CalDAV URL to the object href. */
export function decodeAppleObjectId(eventId: string): string {
  const raw = eventId?.trim() ?? '';
  if (!raw) return raw;
  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }
  try {
    const decoded = Buffer.from(raw, 'base64url').toString('utf8');
    if (/^https?:\/\//i.test(decoded)) {
      return decoded;
    }
  } catch {
    /* fall through */
  }
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
