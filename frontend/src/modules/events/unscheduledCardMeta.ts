import type { DeadlineTone } from './utils/deadlineTone';

export type UnscheduledIconMeta = {
  id: 'phase' | 'earliest' | 'deadline';
  label: string;
  tone: DeadlineTone | 'phase';
  color?: string;
};

/** Accessible labels for icon-only unscheduled card constraints (no reason, no duration). */
export function buildUnscheduledIconMeta(input: {
  phaseName?: string | null;
  phaseColor?: string | null;
  earliestFormatted?: string | null;
  deadlineFormatted?: string | null;
  tone: DeadlineTone;
  fromLabel: (time: string) => string;
  dueLabel: (when: string) => string;
  overduePrefix: string;
  dueSoonPrefix: string;
  approachingPrefix: string;
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
  if (input.deadlineFormatted) {
    const prefix =
      input.tone === 'overdue'
        ? input.overduePrefix
        : input.tone === 'today'
          ? input.dueSoonPrefix
          : input.tone === 'soon'
            ? input.approachingPrefix
            : '';
    out.push({
      id: 'deadline',
      label: `${prefix}${input.dueLabel(input.deadlineFormatted)}`,
      tone: input.tone,
    });
  }
  return out;
}
