import { localHm, localYmd } from '../../voice-local-date.util';

export type ClockResolution =
  | { status: 'ok'; iso: string }
  | { status: 'gap' }
  | { status: 'fold'; isos: [string, string] };

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function withOffset(ymd: string, hm: string, offsetMin: number): string {
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  return `${ymd}T${hm}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

function wall(ms: number, timeZone: string): { ymd: string; hm: string } {
  return { ymd: localYmd(new Date(ms).toISOString(), timeZone), hm: localHm(new Date(ms).toISOString(), timeZone) };
}

/**
 * Resolve a civil clock in an IANA zone.
 * A spring-forward gap matches no instant. A fall-back fold matches two.
 * Neither case picks an instant.
 */
export function resolveZonedClock(ymd: string, hm: string, timeZone: string): ClockResolution {
  const hits: number[] = [];
  for (let offsetMin = -12 * 60; offsetMin <= 14 * 60; offsetMin += 15) {
    const ms = Date.parse(withOffset(ymd, hm, offsetMin));
    if (Number.isNaN(ms)) continue;
    const local = wall(ms, timeZone);
    if (local.ymd === ymd && local.hm === hm) hits.push(ms);
  }
  const unique = [...new Set(hits)].sort((left, right) => left - right);
  if (unique.length === 0) return { status: 'gap' };
  if (unique.length === 1) return { status: 'ok', iso: new Date(unique[0]).toISOString() };
  return {
    status: 'fold',
    isos: [new Date(unique[0]).toISOString(), new Date(unique[1]).toISOString()],
  };
}
