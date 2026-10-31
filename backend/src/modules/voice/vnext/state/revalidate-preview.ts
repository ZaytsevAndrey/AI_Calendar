/**
 * Re-check persisted entities before a structured confirm becomes dispatched.
 * A matching execution id is not enough if the calendar row moved underneath.
 */
import type { PendingOperation } from '../contracts/proposal';
import type { EntityFingerprint, StructuredState } from './structured-state';

export type EntityReadResult = {
  exists: boolean;
  revision?: number;
  calendarId?: string | null;
  writable?: boolean;
  googleEventId?: string | null;
  status?: 'open' | 'completed' | 'canceled';
  userId?: string;
};

export type Revalidation =
  | { ok: true }
  | { ok: false; code: string; detail: string };

export type CatalogFingerprintSource = {
  entityId: string;
  revision: number;
  calendarId: string | null;
  writable: boolean;
  googleEventId?: string | null;
  status?: 'open' | 'completed' | 'canceled';
  userId: string;
};

export function fingerprintsForOperations(
  operations: readonly PendingOperation[],
  catalog: readonly CatalogFingerprintSource[],
): Record<string, EntityFingerprint> {
  const byId = new Map(catalog.map((row) => [row.entityId, row]));
  const fingerprints: Record<string, EntityFingerprint> = {};
  for (const operation of operations) {
    if (operation.target.kind !== 'entity') continue;
    const target = operation.target;
    const row = byId.get(target.entityId);
    const previous = fingerprints[target.entityId];
    fingerprints[target.entityId] = {
      entityId: target.entityId,
      revision: target.revision,
      calendarId: target.calendarId,
      writable: target.writable,
      googleEventId: target.googleEventId ?? null,
      status: target.status ?? row?.status ?? 'open',
      // An empty owner never verifies: compareEntityFingerprint fails closed on it.
      userId: row?.userId ?? '',
      // A series move is anchored on an occurrence; the row revision already covers every slot.
      // A slot move without a calendar event id is covered by the revision too (slot id and times are in it).
      requiresMoveIdentity: (previous?.requiresMoveIdentity ?? false) || (operation.action === 'move' && !target.recurring && target.googleEventId != null),
    };
  }
  return fingerprints;
}

/**
 * Compare a fresh authorized read with what the preview captured.
 * A field the read cannot vouch for fails closed. Nothing is re-resolved by title.
 */
export function compareEntityFingerprint(expected: EntityFingerprint, current: EntityReadResult, userId: string): Revalidation {
  if (!current.exists) return { ok: false, code: 'stale_deleted', detail: expected.entityId };
  if (!expected.userId || expected.userId !== userId) return { ok: false, code: 'unauthorized_entity', detail: expected.entityId };
  if (current.userId == null || current.revision == null || current.status == null || current.writable == null || current.calendarId === undefined) {
    return { ok: false, code: 'revalidation_incomplete', detail: expected.entityId };
  }
  if (current.userId !== userId) return { ok: false, code: 'unauthorized_entity', detail: expected.entityId };
  if (current.writable === false && !expected.reference) return { ok: false, code: 'unauthorized_entity', detail: expected.entityId };
  if (current.status !== expected.status) return { ok: false, code: 'stale_ineligible', detail: expected.entityId };
  if (current.revision !== expected.revision) return { ok: false, code: 'stale_preview', detail: expected.entityId };
  if ((current.calendarId ?? null) !== expected.calendarId) return { ok: false, code: 'stale_preview', detail: expected.entityId };
  if (expected.requiresMoveIdentity) {
    const currentEvent = current.googleEventId ?? null;
    if (!expected.googleEventId || currentEvent !== expected.googleEventId) {
      return { ok: false, code: 'stale_event_identity', detail: expected.entityId };
    }
  }
  return { ok: true };
}

export function revalidateFingerprints(
  fingerprints: Readonly<Record<string, EntityFingerprint>>,
  reads: Readonly<Record<string, EntityReadResult>>,
  userId: string,
): Revalidation {
  for (const [entityId, expected] of Object.entries(fingerprints)) {
    const current = reads[entityId];
    if (!current) return { ok: false, code: 'revalidation_incomplete', detail: entityId };
    const compared = compareEntityFingerprint(expected, current, userId);
    if (!compared.ok) return compared;
  }
  return { ok: true };
}

export async function readPreviewEntities(
  fingerprints: Readonly<Record<string, EntityFingerprint>>,
  readEntity: ((id: string) => Promise<EntityReadResult>) | undefined,
  fallback: ReadonlyArray<EntityReadResult & { entityId: string }>,
): Promise<{ ok: true; reads: Record<string, EntityReadResult> } | { ok: false; code: string; detail: string }> {
  const reads: Record<string, EntityReadResult> = {};
  const fallbackById = new Map(fallback.map((row) => [row.entityId, row]));
  for (const entityId of Object.keys(fingerprints)) {
    try {
      if (readEntity) {
        reads[entityId] = await readEntity(entityId);
      } else {
        const row = fallbackById.get(entityId);
        if (!row) return { ok: false, code: 'revalidation_incomplete', detail: entityId };
        reads[entityId] = row;
      }
    } catch {
      return { ok: false, code: 'revalidation_failed', detail: entityId };
    }
  }
  return { ok: true, reads };
}

export function withFingerprints(state: StructuredState, fingerprints: Record<string, EntityFingerprint>): StructuredState {
  return { ...state, entityFingerprints: fingerprints };
}
