export type UnscheduledIconMeta = {
  id: 'phase' | 'earliest';
  label: string;
  tone: 'phase' | 'none';
  color?: string;
};

/** Accessible labels for icon-only later-task cards (no due date, no duration). */
export function buildUnscheduledIconMeta(input: {
  phaseName?: string | null;
  phaseColor?: string | null;
  earliestFormatted?: string | null;
  fromLabel: (time: string) => string;
}): UnscheduledIconMeta[] {
  const out: UnscheduledIconMeta[] = [];
  const phaseName = input.phaseName?.trim();
  if (phaseName) {
    out.push({
      id: 'phase',
      label: phaseName,
      tone: 'phase',
      color: input.phaseColor || undefined,
    });
  }
  if (input.earliestFormatted) {
    out.push({
      id: 'earliest',
      label: input.fromLabel(input.earliestFormatted),
      tone: 'none',
    });
  }
  return out;
}
