/** Half-hour cards keep their slot and use a smaller stack. Shorter ones are micro cards. */
export const TIMED_CARD_HALF_HOUR_MIN = 30;

/**
 * 48px per hour, so a half-hour card is 24px (border box).
 * The 1px border takes 2px. The other 22px are 11px of plaques and 11px of title.
 */
export const TIMED_CARD_HALF_HOUR_PX = 24;

/** Hover size of a micro card: a little taller than a half-hour slot so the stack fits. */
export const TIMED_CARD_OPEN_PX = 36;

/** Normal chips and a title line need this much. Below it, the stack is scaled down. */
export const TIMED_CARD_ROOMY_PX = 40;

const PX_PER_HOUR = 48;

export type TimedCardMode = 'micro' | 'fit' | 'stacked';

export type TimedCardBox = {
  mode: TimedCardMode;
  /** Resting height. Always the event's own duration, never grown. */
  heightPx: number;
  /** Hover or focus height of a micro card: one half-hour slot. */
  openPx: number;
};

/** Extra classes for a timed card. Tall cards keep the base stacked class only. */
export function timedCardClass(mode: TimedCardMode): string {
  if (mode === 'micro') return 'calendar-chip--micro';
  if (mode === 'fit') return 'calendar-chip--fit';
  return '';
}

export function timedCardBox(durationMin: number, pxPerHour = PX_PER_HOUR): TimedCardBox {
  const minutes = Number.isFinite(durationMin) ? durationMin : 0;
  const raw = (Math.max(0, minutes) / 60) * pxPerHour;
  const openPx = TIMED_CARD_OPEN_PX * (pxPerHour / PX_PER_HOUR);
  const roomyPx = TIMED_CARD_ROOMY_PX * (pxPerHour / PX_PER_HOUR);
  if (minutes < TIMED_CARD_HALF_HOUR_MIN) {
    return { mode: 'micro', heightPx: raw, openPx };
  }
  if (raw < roomyPx) {
    return { mode: 'fit', heightPx: raw, openPx };
  }
  return { mode: 'stacked', heightPx: raw, openPx };
}
