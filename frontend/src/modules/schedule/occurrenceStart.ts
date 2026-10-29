import { resolveIanaTimeZone } from 'modules/user-settings/ianaTimeZones';
import { localDateTimeIso } from 'utils/ianaDateTime';

/** A bare civil day as an instant: local noon, so no zone shifts it to a neighbour day. */
export function occurrenceStartIsoForYmd(
  occurrenceYmd: string,
  timeZone: string,
): string {
  const zone = resolveIanaTimeZone(timeZone);
  return localDateTimeIso(occurrenceYmd, '12:00', zone);
}
