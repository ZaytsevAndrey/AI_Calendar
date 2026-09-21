import { resolveIanaTimeZone } from '../../common/iana-time-zone';
import { toRruleUntilUtc } from '../schedule/google-recurrence.util';
import {
  localDateTimeIso,
  localHm,
  localYmd,
} from '../voice/voice-local-date.util';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeSkippedOccurrenceYmds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const ymd = String(item ?? '').slice(0, 10);
    if (!YMD.test(ymd) || seen.has(ymd)) continue;
    seen.add(ymd);
    out.push(ymd);
  }
  return out.sort();
}

export function addSkippedOccurrenceYmd(
  existing: unknown,
  ymd: string,
): string[] {
  return normalizeSkippedOccurrenceYmds([
    ...(Array.isArray(existing) ? existing : []),
    ymd,
  ]);
}

export function isOccurrenceYmdSkipped(
  existing: unknown,
  ymd: string,
): boolean {
  return normalizeSkippedOccurrenceYmds(existing).includes(ymd);
}

export function googleRecurringInstanceId(
  masterEventId: string,
  occurrenceStart: Date,
): string {
  return `${masterEventId}_${toRruleUntilUtc(occurrenceStart)}`;
}

export function matchScheduledSlotIndex(
  rows: Array<{ scheduledStartTime: Date | string; scheduledEndTime: Date | string }>,
  occurrenceStart: Date,
): number {
  const t = occurrenceStart.getTime();
  if (!Number.isFinite(t)) return -1;
  const starts = rows.map((row) => new Date(row.scheduledStartTime).getTime());
  const ends = rows.map((row) => new Date(row.scheduledEndTime).getTime());
  const containing = starts.findIndex(
    (start, i) => Number.isFinite(start) && Number.isFinite(ends[i]) && start <= t && t < ends[i],
  );
  if (containing >= 0) return containing;
  let best = -1;
  let bestDiff = Infinity;
  for (let i = 0; i < starts.length; i++) {
    if (!Number.isFinite(starts[i])) continue;
    const diff = Math.abs(starts[i] - t);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  return best >= 0 && bestDiff <= 2 * 60 * 1000 ? best : -1;
}

export function excludeStartsForSkippedYmds(opts: {
  skippedYmds: unknown;
  firstStart: Date;
  lastStart: Date;
  timeZone?: string | null;
  placedYmds: string[];
}): Date[] {
  const tz = resolveIanaTimeZone(opts.timeZone);
  const firstYmd = localYmd(opts.firstStart.toISOString(), tz);
  const lastYmd = localYmd(opts.lastStart.toISOString(), tz);
  const placed = new Set(opts.placedYmds);
  const clock = localHm(opts.firstStart.toISOString(), tz);
  const out: Date[] = [];
  for (const ymd of normalizeSkippedOccurrenceYmds(opts.skippedYmds)) {
    if (ymd < firstYmd || ymd > lastYmd) continue;
    if (placed.has(ymd)) continue;
    const instant = new Date(localDateTimeIso(ymd, clock, tz));
    if (!Number.isNaN(instant.getTime())) out.push(instant);
  }
  return out;
}
