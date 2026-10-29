export type AppCalendarProviderId = 'google' | 'microsoft' | 'apple';

export function isAppCalendarProviderId(
  value: unknown,
): value is AppCalendarProviderId {
  return value === 'google' || value === 'microsoft' || value === 'apple';
}

/**
 * Which connected account hosts the app calendar for new writes.
 * A stored choice wins while that account stays connected.
 * Otherwise: Google if linked, then Microsoft, then Apple.
 */
export function resolveAppCalendarProvider(input: {
  stored?: string | null;
  googleLinked: boolean;
  microsoftConnected: boolean;
  appleConnected: boolean;
}): AppCalendarProviderId | null {
  const stored = input.stored;
  if (stored === 'google' && input.googleLinked) return 'google';
  if (stored === 'microsoft' && input.microsoftConnected) return 'microsoft';
  if (stored === 'apple' && input.appleConnected) return 'apple';
  if (input.googleLinked) return 'google';
  if (input.microsoftConnected) return 'microsoft';
  if (input.appleConnected) return 'apple';
  return null;
}
