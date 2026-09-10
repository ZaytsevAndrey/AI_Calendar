import { resolveIanaTimeZone } from '../modules/user-settings/ianaTimeZones';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function ymdFromLocalDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function localYmd(nowIso: string, timeZone: string): string {
  const date = new Date(nowIso);
  const instant = Number.isNaN(date.getTime()) ? new Date() : date;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: resolveIanaTimeZone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

export function localHm(nowIso: string, timeZone: string): string {
  const date = new Date(nowIso);
  const instant = Number.isNaN(date.getTime()) ? new Date() : date;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: resolveIanaTimeZone(timeZone),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const hour = parts.find((part) => part.type === 'hour')?.value ?? '00';
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';
  return `${hour}:${minute}`;
}

export function offsetForTimeZone(timeZone: string, ymd: string): string {
  const probe = new Date(`${ymd}T12:00:00.000Z`);
  const raw =
    new Intl.DateTimeFormat('en-US', {
      timeZone: resolveIanaTimeZone(timeZone),
      timeZoneName: 'longOffset',
      year: 'numeric',
    })
      .formatToParts(probe)
      .find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  const match = raw.match(/([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!match) return '+00:00';
  return `${match[1]}${match[2].padStart(2, '0')}:${match[3] ?? '00'}`;
}

export function normalizeClockHm(value: string | null | undefined): string {
  const match = String(value ?? '').match(/(\d{1,2}):(\d{2})/);
  if (!match) return '00:00';
  const hour = Number(match[1]);
  if (hour > 23) return '00:00';
  return `${pad2(hour)}:${match[2]}`;
}

export function localDateTimeIso(ymd: string, hm: string, timeZone: string): string {
  return `${ymd}T${normalizeClockHm(hm)}:00${offsetForTimeZone(timeZone, ymd)}`;
}

/** ISO instant → `YYYY-MM-DDTHH:mm` wall clock in `timeZone`. */
export function isoToDateTimeLocal(value: string | undefined, timeZone: string): string {
  if (!value?.trim()) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const iso = date.toISOString();
  const zone = resolveIanaTimeZone(timeZone);
  return `${localYmd(iso, zone)}T${localHm(iso, zone)}`;
}

export function isoToHm(value: string | undefined, timeZone: string): string {
  if (!value?.trim()) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return localHm(date.toISOString(), resolveIanaTimeZone(timeZone));
}

/**
 * Naive `datetime-local` / `HH:mm` wall clock → ISO with the offset of `timeZone`
 * on that civil day. Does not use the browser zone.
 */
export function dateTimeLocalToIso(value: string | undefined, timeZone: string): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  if (!match) return null;
  return localDateTimeIso(match[1], match[2], resolveIanaTimeZone(timeZone));
}

export function addDaysToYmd(ymd: string, days: number): string {
  const [year, month, day] = ymd.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day + days));
  return utc.toISOString().slice(0, 10);
}

export function civilDayStartEndIso(
  ymd: string,
  timeZone: string,
): { start: string; end: string } {
  const zone = resolveIanaTimeZone(timeZone);
  return {
    start: localDateTimeIso(ymd, '00:00', zone),
    end: localDateTimeIso(ymd, '23:59', zone),
  };
}

/** Inclusive start of `ymd`, exclusive start of the next civil day — for Google `timeMin`/`timeMax`. */
export function civilDayQueryRange(
  ymd: string,
  timeZone: string,
): { timeMin: string; timeMax: string } {
  const zone = resolveIanaTimeZone(timeZone);
  return {
    timeMin: localDateTimeIso(ymd, '00:00', zone),
    timeMax: localDateTimeIso(addDaysToYmd(ymd, 1), '00:00', zone),
  };
}

export function dateTimeLocalYmd(value?: string): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}
