export type OverdueTone = 'none' | 'mild' | 'mid' | 'strong';

export function overdueDayCount(dueYmd: string, todayYmd: string): number {
  const due = Date.parse(`${dueYmd}T12:00:00Z`);
  const today = Date.parse(`${todayYmd}T12:00:00Z`);
  if (Number.isNaN(due) || Number.isNaN(today)) return 0;
  return Math.max(0, Math.round((today - due) / 86_400_000));
}

/** Stronger red the longer an open reminder sits past its day. */
export function overdueTone(days: number): OverdueTone {
  if (days <= 0) return 'none';
  if (days === 1) return 'mild';
  if (days < 7) return 'mid';
  return 'strong';
}
