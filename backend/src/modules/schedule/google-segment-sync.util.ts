export type GoogleEventRef = {
  eventId: string;
  calendarId: string;
};

export function uniqueGoogleEventRefs(
  refs: Array<GoogleEventRef | null | undefined>,
): GoogleEventRef[] {
  const seen = new Set<string>();
  const out: GoogleEventRef[] = [];
  for (const r of refs) {
    if (!r?.eventId || seen.has(r.eventId)) continue;
    seen.add(r.eventId);
    out.push({
      eventId: r.eventId,
      calendarId: r.calendarId || 'primary',
    });
  }
  return out;
}

export type GoogleSegmentSyncPlan = {
  reuse: GoogleEventRef[];
  createCount: number;
  deleteRefs: GoogleEventRef[];
};

/**
 * Pair existing Google events with desired segment count.
 * A single leftover event (typical old RRULE master) is deleted rather than
 * reused when we need more than one instance — updating a series in place
 * would keep recurrence and lie about skipped/shifted days.
 */
export function planGoogleSegmentSync(
  desiredCount: number,
  existing: GoogleEventRef[],
): GoogleSegmentSyncPlan {
  const ids = uniqueGoogleEventRefs(existing);
  const n = Math.max(0, desiredCount);
  if (n === 0) {
    return { reuse: [], createCount: 0, deleteRefs: ids };
  }
  if (ids.length === 1 && n > 1) {
    return { reuse: [], createCount: n, deleteRefs: ids };
  }
  return {
    reuse: ids.slice(0, n),
    createCount: Math.max(0, n - ids.length),
    deleteRefs: ids.slice(n),
  };
}

/** Recurring tasks use one Google master event, not one event per occurrence. */
export function planGoogleMasterEventSync(
  desiredCount: number,
  existing: GoogleEventRef[],
): GoogleSegmentSyncPlan {
  const ids = uniqueGoogleEventRefs(existing);
  if (desiredCount <= 0) {
    return { reuse: [], createCount: 0, deleteRefs: ids };
  }
  if (ids.length === 1) {
    return { reuse: ids, createCount: 0, deleteRefs: [] };
  }
  return { reuse: [], createCount: 1, deleteRefs: ids };
}
