/**
 * Bulk scope for the structured path.
 * Expands scope:all from a trusted search receipt only — no title-similarity expansion.
 */
import type { SemanticOperationProposal } from '../contracts/proposal';
import type { EntityRecord } from '../reference/reference-resolver';
import { bulkBlock, type SearchReceipt } from '../search/receipt';
import { WRITE_CAP } from './adapter';

export type StructuredScopeBlock =
  | ReturnType<typeof bulkBlock>
  | 'empty_scope'
  | 'bulk_limit'
  | 'unresolved_scope'
  | 'scope_mismatch'
  | 'unsupported_bulk';

const EXPANDABLE = new Set(['delete', 'complete', 'cancel', 'move', 'update']);

export type ScopeExpandResult =
  | { ok: true; proposals: SemanticOperationProposal[]; targetIds: string[] }
  | { ok: false; code: NonNullable<StructuredScopeBlock> };

/**
 * When the model marks scope:all, the authoritative target set is the complete receipt.
 * Catalog rows validate authorization and optional calendar filters; titles are not used to invent ids.
 */
export function expandStructuredScope(
  proposals: SemanticOperationProposal[],
  userId: string,
  entities: EntityRecord[],
  receipt?: SearchReceipt,
  catalog?: (query: { name: string; calendarId?: string }) => SearchReceipt,
): ScopeExpandResult {
  const out: SemanticOperationProposal[] = [];
  const targetIds: string[] = [];
  for (const proposal of proposals) {
    if (proposal.scope !== 'all') {
      out.push(proposal);
      continue;
    }
    if (!EXPANDABLE.has(proposal.action)) {
      return { ok: false, code: 'unsupported_bulk' };
    }
    const calendarId = proposal.calendarId;
    const description = proposal.scopeDescription ?? '';
    const active = catalog ? catalog({ name: description, calendarId }) : receipt;
    const blocked = bulkBlock(active);
    if (blocked) return { ok: false, code: blocked };

    const receiptIds = active?.ids ?? [];
    if (!receiptIds.length) {
      const candidates = catalogCandidates(entities, userId, calendarId, description);
      return { ok: false, code: candidates.length ? 'scope_mismatch' : 'empty_scope' };
    }

    const matches: EntityRecord[] = [];
    for (const id of receiptIds) {
      const entity = entities.find((row) => row.id === id);
      if (!entity || entity.userId !== userId || entity.status !== 'open' || entity.type === 'external_event') {
        return { ok: false, code: 'scope_mismatch' };
      }
      if (calendarId && entity.calendarId !== calendarId) {
        return { ok: false, code: 'scope_mismatch' };
      }
      if (description && entity.name.trim().toLocaleLowerCase() !== description.trim().toLocaleLowerCase()) {
        return { ok: false, code: 'scope_mismatch' };
      }
      matches.push(entity);
    }

    if (description) {
      const candidates = catalogCandidates(entities, userId, calendarId, description);
      if (candidates.some((entity) => !receiptIds.includes(entity.id))) {
        return { ok: false, code: 'scope_mismatch' };
      }
    }

    if (!matches.length) return { ok: false, code: 'empty_scope' };
    if (matches.length > WRITE_CAP) return { ok: false, code: 'bulk_limit' };
    const ids = matches.map((entity) => entity.id);
    if (new Set(ids).size !== ids.length) return { ok: false, code: 'duplicate_targets' };

    targetIds.push(...ids);
    matches.forEach((entity, index) => {
      out.push({
        ...proposal,
        localRef: matches.length === 1 ? proposal.localRef : `${proposal.localRef}-${index + 1}`,
        scope: 'one',
        target: { kind: 'entity', entityId: entity.id },
        changes: {
          ...proposal.changes,
          ...(proposal.changes.title == null ? { title: entity.name } : {}),
        },
      });
    });
  }
  return { ok: true, proposals: out, targetIds };
}

function catalogCandidates(
  entities: EntityRecord[],
  userId: string,
  calendarId: string | undefined,
  description: string,
): EntityRecord[] {
  return entities.filter((entity) => {
    if (entity.userId !== userId || entity.status !== 'open' || entity.type === 'external_event') return false;
    if (calendarId && entity.calendarId !== calendarId) return false;
    if (!description) return true;
    return entity.name.trim().toLocaleLowerCase() === description.trim().toLocaleLowerCase();
  });
}
