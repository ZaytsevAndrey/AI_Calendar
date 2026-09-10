const FALLBACK_TIME_ZONE = 'UTC';

export function detectClientTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || FALLBACK_TIME_ZONE;
}

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

export function listIanaTimeZones(): string[] {
  const intl = Intl as unknown as {
    supportedValuesOf?: (key: string) => string[];
  };
  const supported =
    typeof intl.supportedValuesOf === 'function'
      ? intl.supportedValuesOf('timeZone')
      : [];
  return supported.length ? supported : ['UTC'];
}

export function timeZoneSelectOptions(current?: string | null): string[] {
  const zones = listIanaTimeZones();
  const extra = current?.trim();
  if (extra && !zones.includes(extra)) {
    return [extra, ...zones];
  }
  return zones;
}
