/** Fields this app already sends to Google; reused for Microsoft and Apple. */
export type AppEventBody = {
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  recurrence?: string[];
};

const GRAPH_DAYS: Record<string, string> = {
  SU: 'sunday',
  MO: 'monday',
  TU: 'tuesday',
  WE: 'wednesday',
  TH: 'thursday',
  FR: 'friday',
  SA: 'saturday',
};

export function appEventBodyFromGoogle(
  event: Record<string, unknown>,
): AppEventBody {
  const start = event.start as AppEventBody['start'];
  const end = event.end as AppEventBody['end'];
  const recurrence = Array.isArray(event.recurrence)
    ? event.recurrence.filter((row): row is string => typeof row === 'string')
    : undefined;
  return {
    summary: typeof event.summary === 'string' ? event.summary : undefined,
    description:
      typeof event.description === 'string' ? event.description : undefined,
    location: typeof event.location === 'string' ? event.location : undefined,
    start: start?.dateTime ? start : undefined,
    end: end?.dateTime ? end : undefined,
    recurrence: recurrence?.length ? recurrence : undefined,
  };
}

function graphDateTime(part?: {
  dateTime?: string;
  timeZone?: string;
}): { dateTime: string; timeZone: string } | undefined {
  if (!part?.dateTime) return undefined;
  const dateTime = part.dateTime
    .trim()
    .replace(/Z$/i, '')
    .replace(/[+-]\d{2}:\d{2}$/, '')
    .replace(/\.\d+$/, '');
  return { dateTime, timeZone: part.timeZone || 'UTC' };
}

function rruleParts(rrule: string): Record<string, string> {
  const body = rrule.replace(/^RRULE:/i, '');
  const out: Record<string, string> = {};
  for (const piece of body.split(';')) {
    const eq = piece.indexOf('=');
    if (eq <= 0) continue;
    out[piece.slice(0, eq).toUpperCase()] = piece.slice(eq + 1);
  }
  return out;
}

function untilDate(until: string | undefined): string | null {
  if (!until || until.length < 8) return null;
  return `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}`;
}

function startDate(iso: string | undefined): string {
  if (!iso) return new Date().toISOString().slice(0, 10);
  return iso.slice(0, 10);
}

export function graphRecurrenceFromRules(
  rules: string[] | undefined,
  startIso: string | undefined,
  timeZone: string,
): Record<string, unknown> | undefined {
  const rrule = rules?.find((row) => /^RRULE:/i.test(row));
  if (!rrule) return undefined;
  const parts = rruleParts(rrule);
  const freq = (parts.FREQ || '').toUpperCase();
  const interval = Math.max(1, Number(parts.INTERVAL || '1') || 1);
  let type = 'daily';
  if (freq === 'WEEKLY') type = 'weekly';
  else if (freq === 'MONTHLY') type = 'absoluteMonthly';
  else if (freq !== 'DAILY') return undefined;

  const pattern: Record<string, unknown> = { type, interval };
  if (type === 'weekly' && parts.BYDAY) {
    pattern.daysOfWeek = parts.BYDAY.split(',')
      .map((day) => GRAPH_DAYS[day.trim().toUpperCase()])
      .filter(Boolean);
    pattern.firstDayOfWeek = 'sunday';
  }
  if (type === 'absoluteMonthly') {
    const day = Number(startDate(startIso).slice(8, 10));
    if (day >= 1 && day <= 31) pattern.dayOfMonth = day;
  }

  const range: Record<string, unknown> = {
    type: 'noEnd',
    startDate: startDate(startIso),
    recurrenceTimeZone: timeZone,
  };
  const end = untilDate(parts.UNTIL);
  if (end) {
    range.type = 'endDate';
    range.endDate = end;
  }
  return { pattern, range };
}

export function toGraphEventBody(body: AppEventBody): Record<string, unknown> {
  const start = graphDateTime(body.start);
  const end = graphDateTime(body.end);
  const timeZone = body.start?.timeZone || body.end?.timeZone || 'UTC';
  const out: Record<string, unknown> = {};
  if (body.summary !== undefined) out.subject = body.summary;
  if (body.description !== undefined) {
    out.body = { contentType: 'text', content: body.description };
  }
  if (body.location !== undefined) {
    out.location = { displayName: body.location };
  }
  if (start) out.start = start;
  if (end) out.end = end;
  const recurrence = graphRecurrenceFromRules(
    body.recurrence,
    body.start?.dateTime,
    timeZone,
  );
  if (recurrence) out.recurrence = recurrence;
  return out;
}

function icsEscape(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function icsStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.replace(/[-:]/g, '');
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

export function buildVEventIcs(body: AppEventBody, uid: string): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AI Calendar Assistant//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${icsStamp(new Date().toISOString())}`,
  ];
  if (body.start?.dateTime) lines.push(`DTSTART:${icsStamp(body.start.dateTime)}`);
  if (body.end?.dateTime) lines.push(`DTEND:${icsStamp(body.end.dateTime)}`);
  if (body.summary) lines.push(`SUMMARY:${icsEscape(body.summary)}`);
  if (body.description) lines.push(`DESCRIPTION:${icsEscape(body.description)}`);
  if (body.location) lines.push(`LOCATION:${icsEscape(body.location)}`);
  for (const rule of body.recurrence ?? []) {
    if (/^(RRULE|EXDATE)/i.test(rule)) lines.push(rule);
  }
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n');
}
