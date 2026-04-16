/** Request body fields managed by this app but not part of the Google Calendar API event resource. */
export const APP_MANAGED_EVENT_BODY_KEYS = [
  'phaseId',
  'emoji',
  'priority',
  'status',
  'deadline',
  'estimatedTime',
  'splitTasks',
  'splitMin',
  'splitMax',
] as const;

export type AppManagedEventBodyKey = (typeof APP_MANAGED_EVENT_BODY_KEYS)[number];

export function stripAppManagedEventProperties<T extends Record<string, unknown>>(
  body: T,
): Omit<T, AppManagedEventBodyKey> {
  const out = { ...body } as Record<string, unknown>;
  for (const key of APP_MANAGED_EVENT_BODY_KEYS) {
    delete out[key];
  }
  return out as Omit<T, AppManagedEventBodyKey>;
}

export function extractPhaseId(body: Record<string, unknown>): string | undefined {
  const v = body.phaseId;
  if (v === undefined || v === null || v === '') return undefined;
  return String(v);
}

function timeStrToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return NaN;
  return h * 60 + m;
}

/** Whether a clock time (minutes from midnight) falls in the sleep window [sleep, wake) wrapping midnight if needed. */
export function isMinutesInSleepWindow(
  minutes: number,
  sleepTime: string,
  wakeTime: string,
): boolean {
  const sleepStart = timeStrToMinutes(sleepTime);
  const sleepEnd = timeStrToMinutes(wakeTime);
  if (Number.isNaN(minutes) || Number.isNaN(sleepStart) || Number.isNaN(sleepEnd)) {
    return false;
  }
  if (sleepStart > sleepEnd) {
    return minutes >= sleepStart || minutes < sleepEnd;
  }
  return minutes >= sleepStart && minutes < sleepEnd;
}

export function wallClockMinutesInTimeZone(iso: string, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(new Date(iso));
  const hourPart = parts.find((p) => p.type === 'hour');
  const minutePart = parts.find((p) => p.type === 'minute');
  const hour = hourPart ? parseInt(hourPart.value, 10) : NaN;
  const minute = minutePart ? parseInt(minutePart.value, 10) : NaN;
  return hour * 60 + minute;
}
