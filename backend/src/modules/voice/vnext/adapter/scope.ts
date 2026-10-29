import type { SemanticOperationV1 } from '../contracts/types';
import type { EntityRecord } from '../reference/reference-resolver';
import { bulkBlock, type BulkBlock, type SearchReceipt } from '../search/receipt';
import { WRITE_CAP } from './adapter';

function sameName(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
}

function described(operation: SemanticOperationV1): string {
  if (operation.target.kind === 'existing') return operation.target.description ?? '';
  if (operation.target.kind === 'unresolved') return operation.target.phrase;
  return '';
}

export type ScopeBlock = BulkBlock | 'empty_scope' | 'bulk_limit' | 'unresolved_scope' | 'scope_mismatch';

const EXPANDABLE = new Set(['delete', 'complete', 'cancel', 'move', 'update']);

/**
 * Scope `all` expands only when a trusted receipt lists the whole set.
 * A missing or partial receipt does not fall back to one proposed id.
 */
export function expandScope(
  operations: SemanticOperationV1[],
  userId: string,
  entities: EntityRecord[],
  receipt?: SearchReceipt,
  catalog?: (query: { name: string; calendarId?: string }) => SearchReceipt,
): { operations: SemanticOperationV1[]; unresolved: boolean; code?: ScopeBlock; targetIds: string[] } {
  const expanded: SemanticOperationV1[] = [];
  const targetIds: string[] = [];
  for (const operation of operations) {
    if (operation.scope !== 'all') {
      expanded.push(operation);
      continue;
    }
    const calendarId = operation.target.kind === 'existing' ? operation.target.calendarId : undefined;
    const active = catalog ? catalog({ name: described(operation), calendarId }) : receipt;
    const blocked = bulkBlock(active);
    if (blocked) return { operations: [], unresolved: true, code: blocked, targetIds: [] };
    if (!EXPANDABLE.has(operation.action)) return { operations: [], unresolved: true, code: 'unresolved_scope', targetIds: [] };
    const name = described(operation);
    const named = entities.filter((entity) => {
      if (entity.userId !== userId || entity.status !== 'open' || entity.type === 'external_event') return false;
      if (!name || !sameName(entity.name, name)) return false;
      if (calendarId && entity.calendarId !== calendarId) return false;
      return true;
    });
    const allowed = new Set(active?.ids ?? []);
    const matches = named.filter((entity) => allowed.has(entity.id));
    if (named.some((entity) => !allowed.has(entity.id)) || (active?.ids ?? []).some((id) => !matches.some((entity) => entity.id === id))) {
      return { operations: [], unresolved: true, code: 'scope_mismatch', targetIds: [] };
    }
    if (!matches.length) return { operations: [], unresolved: true, code: 'empty_scope', targetIds: [] };
    if (matches.length > WRITE_CAP) return { operations: [], unresolved: true, code: 'bulk_limit', targetIds: [] };
    const ids = matches.map((entity) => entity.id);
    if (new Set(ids).size !== ids.length) return { operations: [], unresolved: true, code: 'duplicate_targets', targetIds: [] };
    targetIds.push(...ids);
    matches.forEach((entity, index) => {
      expanded.push({
        ...operation,
        opId: matches.length === 1 ? operation.opId : `${operation.opId}-${index + 1}`,
        scope: 'one',
        target: {
          kind: 'existing',
          proposedId: entity.id,
          description: entity.name,
          ...(entity.calendarId ? { calendarId: entity.calendarId } : {}),
        },
        trustedSetMember: true,
      });
    });
  }
  return { operations: expanded, unresolved: false, targetIds };
}
