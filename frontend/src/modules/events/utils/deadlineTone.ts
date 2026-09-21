export type DeadlineTone = 'none' | 'soon' | 'today' | 'overdue';

/** Highlight optional deadlines on unscheduled inbox items. */
export function deadlineTone(deadline?: string | null, nowMs = Date.now()): DeadlineTone {
  if (!deadline) return 'none';
  const due = new Date(deadline).getTime();
  if (Number.isNaN(due)) return 'none';
  if (due < nowMs) return 'overdue';
  const hours = (due - nowMs) / 36e5;
  if (hours <= 24) return 'today';
  if (hours <= 72) return 'soon';
  return 'none';
}

export function deadlineToneClass(tone: DeadlineTone): string {
  if (tone === 'overdue') return 'font-medium text-ide-error';
  if (tone === 'today') return 'font-medium text-ide-warn';
  if (tone === 'soon') return 'text-ide-warn';
  return '';
}

export function deadlineToneLabel(tone: DeadlineTone): string {
  if (tone === 'overdue') return 'Overdue · ';
  if (tone === 'today') return 'Due soon · ';
  if (tone === 'soon') return 'Approaching · ';
  return '';
}
