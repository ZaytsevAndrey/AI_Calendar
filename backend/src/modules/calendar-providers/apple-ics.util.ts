/** Minimal iCalendar helpers for Apple CalDAV event mapping. */

export type ParsedVEvent = {
  uid: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  recurringEventId?: string;
  status?: string;
  transparency?: string;
};

function unfoldIcs(raw: string): string {
  return raw.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
}

function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

function propValue(block: string, name: string): string | undefined {
  const re = new RegExp(`^${name}[;:](.*)$`, 'im');
  const m = block.match(re);
  if (!m) return undefined;
  const line = m[0];
  const idx = line.indexOf(':');
  return idx >= 0 ? unescapeText(line.slice(idx + 1).trim()) : undefined;
}

function propParams(block: string, name: string): Record<string, string> {
  const re = new RegExp(`^${name}([^:]*):(.*)$`, 'im');
  const m = block.match(re);
  const out: Record<string, string> = {};
  if (!m) return out;
  const params = m[1] || '';
  for (const part of params.split(';')) {
    if (!part || !part.includes('=')) continue;
    const [k, v] = part.split('=');
    out[k.replace(/^\s*;?\s*/, '').toUpperCase()] = v;
  }
  return out;
}

/** Convert ICS date/datetime to ISO-ish provider fields. */
export function parseIcsDate(
  block: string,
  name: 'DTSTART' | 'DTEND',
): { dateTime?: string; date?: string; timeZone?: string } | undefined {
  const re = new RegExp(`^${name}([^:]*):(.*)$`, 'im');
  const m = block.match(re);
  if (!m) return undefined;
  const params = propParams(block, name);
  const raw = (m[2] || '').trim();
  if (!raw) return undefined;
  if (params.VALUE === 'DATE' || /^\d{8}$/.test(raw)) {
    const y = raw.slice(0, 4);
    const mo = raw.slice(4, 6);
    const d = raw.slice(6, 8);
    return { date: `${y}-${mo}-${d}` };
  }
  // 20240101T120000Z or 20240101T120000
  const compact = raw.replace(/[-:]/g, '');
  const y = compact.slice(0, 4);
  const mo = compact.slice(4, 6);
  const d = compact.slice(6, 8);
  const hh = compact.slice(9, 11) || '00';
  const mm = compact.slice(11, 13) || '00';
  const ss = compact.slice(13, 15) || '00';
  const z = /Z$/i.test(raw);
  const timeZone = params.TZID;
  if (z) {
    return {
      dateTime: `${y}-${mo}-${d}T${hh}:${mm}:${ss}.000Z`,
      timeZone: 'UTC',
    };
  }
  // Floating / TZID local — treat as wall time with Z for storage consistency
  // when no offset; callers display with timeZone hint when present.
  return {
    dateTime: `${y}-${mo}-${d}T${hh}:${mm}:${ss}.000Z`,
    timeZone: timeZone || 'UTC',
  };
}

export function extractVEventBlock(ics: string): string | null {
  const unfolded = unfoldIcs(ics);
  const m = unfolded.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/i);
  return m ? m[0] : null;
}

function applyDuration(
  start: { dateTime?: string; date?: string; timeZone?: string },
  durationRaw: string,
): { dateTime?: string; date?: string; timeZone?: string } | undefined {
  if (!start.dateTime && !start.date) return undefined;
  // Basic ISO-8601 duration: PT1H30M / P1D
  const m = durationRaw.match(
    /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i,
  );
  if (!m) return undefined;
  const days = Number(m[1] || 0);
  const hours = Number(m[2] || 0);
  const mins = Number(m[3] || 0);
  const secs = Number(m[4] || 0);
  const ms =
    ((days * 24 + hours) * 60 + mins) * 60_000 + secs * 1000;
  if (start.date) {
    const base = new Date(`${start.date}T00:00:00.000Z`);
    const end = new Date(base.getTime() + ms);
    const ymd = end.toISOString().slice(0, 10);
    return { date: ymd };
  }
  const base = new Date(start.dateTime!);
  if (!Number.isFinite(base.getTime())) return undefined;
  return {
    dateTime: new Date(base.getTime() + ms).toISOString(),
    timeZone: start.timeZone,
  };
}

export function parseVEvent(ics: string): ParsedVEvent | null {
  const block = extractVEventBlock(ics);
  if (!block) return null;
  const uid = propValue(block, 'UID');
  if (!uid) return null;
  const recurId = propValue(block, 'RECURRENCE-ID');
  const start = parseIcsDate(block, 'DTSTART');
  let end = parseIcsDate(block, 'DTEND');
  if (!end && start) {
    const duration = propValue(block, 'DURATION');
    if (duration) end = applyDuration(start, duration);
  }
  // Some Apple events omit DTEND; treat as zero-length so the chip still draws.
  if (!end && start) end = { ...start };
  const statusRaw = propValue(block, 'STATUS')?.toUpperCase();
  const transp = propValue(block, 'TRANSP')?.toUpperCase();
  return {
    uid,
    summary: propValue(block, 'SUMMARY'),
    description: propValue(block, 'DESCRIPTION'),
    location: propValue(block, 'LOCATION'),
    start,
    end,
    recurringEventId: recurId ? uid : undefined,
    status: statusRaw === 'CANCELLED' ? 'cancelled' : undefined,
    transparency: transp === 'TRANSPARENT' ? 'transparent' : undefined,
  };
}

function toIcsUtc(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  );
}

/** Patch DTSTART/DTEND (and SUMMARY etc.) inside an existing ICS payload. */
export function patchVEventIcs(
  ics: string,
  patch: {
    summary?: string;
    description?: string;
    location?: string;
    startIso?: string;
    endIso?: string;
  },
): string {
  let out = ics;
  const replaceProp = (name: string, value: string) => {
    const re = new RegExp(`^${name}[^:]*:.*$`, 'im');
    if (re.test(out)) {
      out = out.replace(re, `${name}:${value}`);
    } else {
      out = out.replace(/END:VEVENT/i, `${name}:${value}\r\nEND:VEVENT`);
    }
  };
  if (patch.summary !== undefined) {
    replaceProp('SUMMARY', patch.summary.replace(/\n/g, '\\n'));
  }
  if (patch.description !== undefined) {
    replaceProp('DESCRIPTION', patch.description.replace(/\n/g, '\\n'));
  }
  if (patch.location !== undefined) {
    replaceProp('LOCATION', patch.location.replace(/\n/g, '\\n'));
  }
  if (patch.startIso) {
    const re = /^DTSTART[^:]*:.*$/im;
    out = out.replace(re, `DTSTART:${toIcsUtc(patch.startIso)}`);
  }
  if (patch.endIso) {
    const re = /^DTEND[^:]*:.*$/im;
    if (re.test(out)) {
      out = out.replace(re, `DTEND:${toIcsUtc(patch.endIso)}`);
    } else {
      out = out.replace(
        /END:VEVENT/i,
        `DTEND:${toIcsUtc(patch.endIso)}\r\nEND:VEVENT`,
      );
    }
  }
  return out;
}

export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}
