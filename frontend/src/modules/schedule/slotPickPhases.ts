import type { PhaseDTO } from '../../api/phases.api';
import { localDateTimeIso, normalizeClockHm } from '../../utils/ianaDateTime';
import { resolveIanaTimeZone } from '../user-settings/ianaTimeZones';

export type PhaseWindow = {
  id: string;
  name: string;
  color: string;
  startMs: number;
  endMs: number;
};

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function weekdayIndexInZone(ymd: string, timeZone: string): number {
  const zone = resolveIanaTimeZone(timeZone);
  const probe = new Date(localDateTimeIso(ymd, '12:00', zone));
  const short = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    weekday: 'short',
  }).format(probe);
  return WEEKDAY_MAP[short] ?? 0;
}

function phaseAppliesOnYmd(phase: PhaseDTO, ymd: string, timeZone: string): boolean {
  if (!phase.weekDays || phase.weekDays.length === 0) return true;
  return phase.weekDays.includes(weekdayIndexInZone(ymd, timeZone));
}

/** Schedulable phase windows for a civil day (handles overnight phases). */
export function phaseWindowsForDay(
  phases: PhaseDTO[],
  ymd: string,
  timeZone: string,
): PhaseWindow[] {
  const zone = resolveIanaTimeZone(timeZone);
  const out: PhaseWindow[] = [];
  for (const p of phases) {
    if (!p?.id || p.type === 'sleep_time') continue;
    if (!phaseAppliesOnYmd(p, ymd, zone)) continue;
    const startHm = normalizeClockHm(p.startTime);
    const endHm = normalizeClockHm(p.endTime);
    let startMs = Date.parse(localDateTimeIso(ymd, startHm, zone));
    let endMs = Date.parse(localDateTimeIso(ymd, endHm, zone));
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
    if (endMs <= startMs) endMs += 24 * 60 * 60 * 1000;
    out.push({
      id: p.id,
      name: p.name,
      color: p.color || '#4a90e2',
      startMs,
      endMs,
    });
  }
  return out;
}

/** Tightest phase window containing `focusMs`, or null. */
export function phaseIdAtFocus(
  windows: PhaseWindow[],
  focusMs: number,
): string | null {
  const hits = windows
    .filter((w) => focusMs >= w.startMs && focusMs < w.endMs)
    .sort((a, b) => a.endMs - a.startMs - (b.endMs - b.startMs));
  return hits[0]?.id ?? null;
}

export function phaseWindowById(
  windows: PhaseWindow[],
  phaseId: string,
): PhaseWindow | null {
  return windows.find((w) => w.id === phaseId) ?? null;
}
