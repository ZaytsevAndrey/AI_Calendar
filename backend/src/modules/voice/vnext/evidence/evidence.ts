export type ReadRecord = {
  requestId: string;
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  error?: string;
  day?: string;
  scope?: 'day' | 'week' | 'open' | 'now';
  /** Present only for a successful read that fits the model context. */
  result?: unknown;
  withheld?: 'result_too_large' | 'missing_result';
};

export type EvidenceNeed = {
  scope: 'day' | 'week' | 'named' | 'gaps' | 'reminders' | 'now';
  day?: string;
};

/** A tool error is not an empty calendar. A today read does not answer a week. */
export function evidenceCovers(need: EvidenceNeed, reads: ReadRecord[]): { ok: boolean; reason?: string } {
  if (reads.some((read) => !read.ok)) return { ok: false, reason: 'tool_error' };
  const withheld = reads.find((read) => read.withheld);
  if (withheld?.withheld) return { ok: false, reason: withheld.withheld };
  if (need.scope === 'now') {
    return reads.some((read) => read.ok && read.name === 'get_now_next')
      ? { ok: true }
      : { ok: false, reason: 'missing_now' };
  }
  if (need.scope === 'reminders') {
    return reads.some((read) => read.ok && read.name === 'list_reminders')
      ? { ok: true }
      : { ok: false, reason: 'missing_reminders' };
  }
  if (need.scope === 'gaps') {
    const gap = reads.find((read) => read.name === 'find_free_gaps' && read.ok);
    if (!gap) return { ok: false, reason: 'missing_gaps' };
    if (need.day && gap.day && gap.day !== need.day) return { ok: false, reason: 'wrong_day' };
    return { ok: true };
  }
  if (need.scope === 'named') {
    return reads.some((read) => read.ok && (read.name === 'match_task' || read.name === 'get_task'))
      ? { ok: true }
      : { ok: false, reason: 'missing_task' };
  }
  if (need.scope === 'week') {
    const week = reads.find((read) => read.ok && read.scope === 'week');
    if (!week) return { ok: false, reason: 'today_only' };
    return { ok: true };
  }
  const dayRead = reads.find((read) => read.ok && read.name === 'get_day_agenda' && (!need.day || read.day === need.day));
  return dayRead ? { ok: true } : { ok: false, reason: 'missing_day' };
}
