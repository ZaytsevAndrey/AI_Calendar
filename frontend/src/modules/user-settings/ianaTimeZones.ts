export function detectClientTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
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
