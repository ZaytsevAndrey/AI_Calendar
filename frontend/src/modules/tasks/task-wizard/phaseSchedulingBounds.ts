import type { PhaseDTO } from '../../../api/phases.api';

export type PhaseSchedulingTimeBounds = {
  timeMin: string;
  timeMax: string;
  startHHMM: string;
  endHHMM: string;
  /** Phase crosses midnight (e.g. 22:00–06:00) */
  overnight: boolean;
};

export type PreferredTimeSlotOption = {
  value: string;
  label: string;
};

function padHHMM(raw: string): string {
  const [h = '0', m = '0'] = raw.trim().split(':');
  const hh = String(Math.min(23, Math.max(0, parseInt(h, 10) || 0))).padStart(2, '0');
  const mm = String(Math.min(59, Math.max(0, parseInt(m, 10) || 0))).padStart(2, '0');
  return `${hh}:${mm}`;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((x) => parseInt(x, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
}

export function getPhaseSchedulingTimeBounds(
  phase: PhaseDTO | undefined,
): PhaseSchedulingTimeBounds | null {
  if (!phase?.startTime?.trim() || !phase?.endTime?.trim()) return null;
  const startHHMM = padHHMM(phase.startTime);
  const endHHMM = padHHMM(phase.endTime);
  const sm = toMinutes(startHHMM);
  const em = toMinutes(endHHMM);
  if (sm === em) return null;
  const overnight = em < sm;
  return {
    timeMin: startHHMM,
    timeMax: endHHMM,
    startHHMM,
    endHHMM,
    overnight,
  };
}

const DEFAULT_SLOT_STEP = 15;

/** Whether `hhmm` falls outside the phase window (inclusive ends). */
export function isPreferredStartOutsidePhaseWindow(
  hhmm: string,
  phaseBounds: PhaseSchedulingTimeBounds | null,
): boolean {
  if (!phaseBounds) return false;
  const m = toMinutes(padHHMM(hhmm));
  const sm = toMinutes(phaseBounds.startHHMM);
  const em = toMinutes(phaseBounds.endHHMM);
  if (phaseBounds.overnight) {
    return !(m >= sm || m <= em);
  }
  return m < sm || m > em;
}

/** Options for preferred-start `<select>`; only slots inside the phase when bounds apply. */
export function buildPreferredStartSlotOptions(
  phaseBounds: PhaseSchedulingTimeBounds | null,
  stepMinutes: number = DEFAULT_SLOT_STEP,
): PreferredTimeSlotOption[] {
  const opts: PreferredTimeSlotOption[] = [{ value: '', label: 'No preference' }];

  for (let m = 0; m < 24 * 60; m += stepMinutes) {
    const hh = String(Math.floor(m / 60)).padStart(2, '0');
    const mm = String(m % 60).padStart(2, '0');
    const value = `${hh}:${mm}`;
    if (phaseBounds && isPreferredStartOutsidePhaseWindow(value, phaseBounds)) {
      continue;
    }
    opts.push({ value, label: value });
  }

  return opts;
}

/** Ensure current form value appears in the list (e.g. odd minute from API) when still in-phase. */
export function mergeSavedPreferredStartIntoOptions(
  options: PreferredTimeSlotOption[],
  savedValue: string | undefined,
  phaseBounds: PhaseSchedulingTimeBounds | null,
): PreferredTimeSlotOption[] {
  const v = savedValue?.trim();
  if (!v) return options;
  if (options.some((o) => o.value === v)) return options;
  if (isPreferredStartOutsidePhaseWindow(v, phaseBounds)) return options;
  const next = [...options];
  next.splice(1, 0, { value: v, label: v });
  return next;
}
