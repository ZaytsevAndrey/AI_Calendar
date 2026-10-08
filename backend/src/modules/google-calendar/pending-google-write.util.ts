/** Pure helpers for the failed-Google-write queue. */

export type GoogleEventTimeFields = {
  summary?: string | null;
  description?: string | null;
  startIso?: string | null;
  endIso?: string | null;
  updatedIso?: string | null;
};

export function googleEventFieldsFromApi(event: {
  summary?: string | null;
  description?: string | null;
  start?: { dateTime?: string | null; date?: string | null } | null;
  end?: { dateTime?: string | null; date?: string | null } | null;
  updated?: string | null;
}): GoogleEventTimeFields {
  return {
    summary: event.summary ?? null,
    description: event.description ?? null,
    startIso: event.start?.dateTime || event.start?.date || null,
    endIso: event.end?.dateTime || event.end?.date || null,
    updatedIso: event.updated ?? null,
  };
}

export function googleContentDiffers(
  local: GoogleEventTimeFields,
  remote: GoogleEventTimeFields,
): boolean {
  const norm = (value: string | null | undefined) => (value ?? '').trim();
  if (norm(local.summary) !== norm(remote.summary)) return true;
  if (norm(local.description) !== norm(remote.description)) return true;
  const localStart = local.startIso ? Date.parse(local.startIso) : NaN;
  const remoteStart = remote.startIso ? Date.parse(remote.startIso) : NaN;
  const localEnd = local.endIso ? Date.parse(local.endIso) : NaN;
  const remoteEnd = remote.endIso ? Date.parse(remote.endIso) : NaN;
  if (
    Number.isFinite(localStart) &&
    Number.isFinite(remoteStart) &&
    Math.abs(localStart - remoteStart) > 1000
  ) {
    return true;
  }
  if (
    Number.isFinite(localEnd) &&
    Number.isFinite(remoteEnd) &&
    Math.abs(localEnd - remoteEnd) > 1000
  ) {
    return true;
  }
  if (!Number.isFinite(localStart) !== !Number.isFinite(remoteStart)) return true;
  if (!Number.isFinite(localEnd) !== !Number.isFinite(remoteEnd)) return true;
  return false;
}

/** True when Google was edited after we enqueued the failed write. */
export function googleEditedAfterEnqueue(
  remoteUpdatedIso: string | null | undefined,
  enqueuedAt: Date,
): boolean {
  if (!remoteUpdatedIso) return false;
  const updatedMs = Date.parse(remoteUpdatedIso);
  if (!Number.isFinite(updatedMs)) return false;
  return updatedMs > enqueuedAt.getTime();
}
