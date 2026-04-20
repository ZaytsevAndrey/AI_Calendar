import type { PhaseDTO } from '../../../api/phases.api';

export type PhaseSchedulingTimeBounds = {
  timeMin: string;
  timeMax: string;
  startHHMM: string;
  endHHMM: string;
  /** Phase crosses midnight (e.g. 22:00–06:00); all slots stay enabled */
  overnight: boolean;
};

export type PreferredTimeSlotOption = {
  value: string;
  label: string;
  disabled: boolean;
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

/** Options for preferred-start `<select>`; slots outside phase are `disabled` when bounds apply */
export function buildPreferredStartSlotOptions(
  phaseBounds: PhaseSchedulingTimeBounds | null,
  stepMinutes: number = DEFAULT_SLOT_STEP,
): PreferredTimeSlotOption[] {
  const opts: PreferredTimeSlotOption[] = [
    { value: '', label: 'No preference', disabled: false },
  ];

  let sm: number | null = null;
  let em: number | null = null;
  if (phaseBounds && !phaseBounds.overnight) {
    sm = toMinutes(phaseBounds.startHHMM);
    em = toMinutes(phaseBounds.endHHMM);
  }

  for (let m = 0; m < 24 * 60; m += stepMinutes) {
    const hh = String(Math.floor(m / 60)).padStart(2, '0');
    const mm = String(m % 60).padStart(2, '0');
    const value = `${hh}:${mm}`;
    const disabled = sm !== null && em !== null && (m < sm || m > em);
    opts.push({ value, label: value, disabled });
  }

  return opts;
}

export function isPreferredStartOutsidePhaseWindow(
  hhmm: string,
  phaseBounds: PhaseSchedulingTimeBounds | null,
): boolean {
  if (!phaseBounds || phaseBounds.overnight) return false;
  const m = toMinutes(padHHMM(hhmm));
  const sm = toMinutes(phaseBounds.startHHMM);
  const em = toMinutes(phaseBounds.endHHMM);
  return m < sm || m > em;
}

/** Ensure current form value appears in the list (e.g. odd minute from API) */
export function mergeSavedPreferredStartIntoOptions(
  options: PreferredTimeSlotOption[],
  savedValue: string | undefined,
  phaseBounds: PhaseSchedulingTimeBounds | null,
): PreferredTimeSlotOption[] {
  const v = savedValue?.trim();
  if (!v) return options;
  if (options.some((o) => o.value === v)) return options;
  const disabled = isPreferredStartOutsidePhaseWindow(v, phaseBounds);
  const next = [...options];
  next.splice(1, 0, { value: v, label: v, disabled });
  return next;
}
