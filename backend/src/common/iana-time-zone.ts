const FALLBACK_TIME_ZONE = 'UTC';

export function isValidIanaTimeZone(value: string): boolean {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Prefer a stored IANA zone; invalid or empty values fall back to UTC. */
export function resolveIanaTimeZone(value?: string | null): string {
  const tz = value?.trim();
  if (!tz || !isValidIanaTimeZone(tz)) return FALLBACK_TIME_ZONE;
  return tz;
}
