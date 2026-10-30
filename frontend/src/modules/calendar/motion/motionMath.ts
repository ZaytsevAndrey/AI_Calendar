import type { MutationStage } from '../../schedule/taskMutationProgress';

export type Box = { left: number; top: number; width: number; height: number };

export type EdgeDirection = 'prev' | 'next';

/** How far a card has «moved over» to its new place at each server stage (0…1). */
export const STAGE_PROGRESS: Record<MutationStage, number> = {
  saving: 0.3,
  placing: 0.6,
  syncing: 0.85,
  done: 1,
  error: 0,
};

export function stageProgress(stage: MutationStage | null | undefined): number {
  return stage ? STAGE_PROGRESS[stage] : 0;
}

/**
 * A damped spring sampled into a CSS `linear()` easing, so WAAPI and CSS get
 * the same settle without a JS animation loop. Overshoot comes from `bounce`.
 */
export function springEasing(bounce = 0.18, cycles = 1.6, samples = 40): string {
  const zeta = 1 - Math.min(0.9, Math.max(0, bounce));
  // Oscillations per animation length: lower is a lazier start, higher a snappier one.
  const omega = 2 * Math.PI * cycles;
  const value = (t: number) => {
    if (zeta >= 1) return 1 - (1 + omega * t) * Math.exp(-omega * t);
    const wd = omega * Math.sqrt(1 - zeta * zeta);
    return (
      1 -
      Math.exp(-zeta * omega * t) *
        (Math.cos(wd * t) + ((zeta * omega) / wd) * Math.sin(wd * t))
    );
  };
  const points: string[] = [];
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    // The last point is pinned to 1 so the animation ends exactly at rest.
    const v = i === samples ? 1 : value(t);
    points.push(String(Math.round(v * 1000) / 1000));
  }
  return `linear(${points.join(', ')})`;
}

/**
 * Transform (origin: center) that draws a box laid out at `to` centered where
 * `from` is, scaled uniformly so text never stretches. The scale is clamped:
 * a wide panel row and a 15-minute chip only hint at each other's size.
 */
export function travelTransform(from: Box, to: Box, min = 0.4, max = 1.2): string {
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);
  const raw =
    to.width > 0 && to.height > 0 ? Math.min(from.width / to.width, from.height / to.height) : 1;
  const scale = Math.min(max, Math.max(min, raw));
  return `translate(${round(dx)}px, ${round(dy)}px) scale(${round(scale, 3)})`;
}

/** Changes smaller than this are layout jitter, not a move worth animating. */
export function boxMoved(a: Box, b: Box, threshold = 1.5): boolean {
  return (
    Math.abs(a.left - b.left) > threshold ||
    Math.abs(a.top - b.top) > threshold ||
    Math.abs(a.width - b.width) > threshold ||
    Math.abs(a.height - b.height) > threshold
  );
}

/** Which pagination arrow a date outside the visible range sits behind. */
export function offscreenDirection(
  targetMs: number,
  range: { startMs: number; endMs: number } | null,
): EdgeDirection | null {
  if (!range || !Number.isFinite(targetMs)) return null;
  if (targetMs < range.startMs) return 'prev';
  if (targetMs >= range.endMs) return 'next';
  return null;
}

export function splitKeys(value: string | null | undefined): string[] {
  return (value ?? '').split(' ').filter(Boolean);
}

export function joinKeys(keys: Array<string | null | undefined>): string {
  return Array.from(new Set(keys.filter((key): key is string => !!key))).join(' ');
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
