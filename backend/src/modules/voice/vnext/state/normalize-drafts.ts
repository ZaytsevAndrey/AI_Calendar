/**
 * Fold operations that target a not-yet-created draft into that create.
 * Does not write a provider command and does not mutate the input snapshot.
 */
import type { OperationChangesV1 } from '../contracts/types';
import type { ExecutionRecord, PendingOperation, PreviewSnapshot, TemporalProposal } from '../contracts/proposal';
import { type IdAllocator, type StructuredState } from './structured-state';

export type DraftNormalization =
  | { ok: true; state: StructuredState; folded: boolean }
  | { ok: false; code: string; detail: string; state: StructuredState };

const CHANGE_FIELDS = ['title', 'notes', 'priority', 'location', 'status'] as const;

export function normalizeDrafts(state: StructuredState, ids: IdAllocator): DraftNormalization {
  const creates = state.operations.filter((operation): operation is PendingOperation & { target: { kind: 'new'; localId: string } } =>
    operation.action === 'create' && operation.target.kind === 'new');
  const byLocalId = new Map<string, PendingOperation[]>();
  for (const create of creates) {
    const list = byLocalId.get(create.target.localId) ?? [];
    list.push(create);
    byLocalId.set(create.target.localId, list);
  }
  const removals = new Set<string>();
  const folds = new Map<string, PendingOperation[]>();
  for (const operation of state.operations) {
    if (operation.target.kind !== 'new' || operation.action === 'create') continue;
    if (standaloneReminder(operation, byLocalId)) continue;
    const matches = byLocalId.get(operation.target.localId) ?? [];
    if (matches.length !== 1) return fail(state, matches.length === 0 ? 'invalid_draft_reference' : 'ambiguous_draft', operation.target.localId);
    const create = matches[0];
    const prerequisites = state.dependencies[operation.pendingId] ?? [];
    if (prerequisites.some((id) => id !== create.pendingId && !state.operations.some((item) => item.pendingId === id))) {
      return fail(state, 'invalid_draft_reference', operation.pendingId);
    }
    if (operation.action === 'delete' || operation.action === 'cancel') {
      if (folds.get(create.pendingId)?.some((item) => item.action === 'complete')) return fail(state, 'contradictory_draft', create.pendingId);
      removals.add(create.pendingId);
      continue;
    }
    if (removals.has(create.pendingId)) return fail(state, 'contradictory_draft', create.pendingId);
    if (operation.action === 'complete' && create.entityType !== 'task') return fail(state, 'unsupported_draft_complete', create.entityType);
    if (operation.action !== 'update' && operation.action !== 'move' && operation.action !== 'complete') {
      return fail(state, 'unsupported_draft_action', operation.action);
    }
    const list = folds.get(create.pendingId) ?? [];
    list.push(operation);
    folds.set(create.pendingId, list);
  }
  for (const pendingId of removals) {
    const surviving = state.operations.filter((operation) => {
      if (operation.pendingId === pendingId || operation.target.kind === 'new') return false;
      return true;
    });
    for (const operation of surviving) {
      if ((state.dependencies[operation.pendingId] ?? []).includes(pendingId)) return fail(state, 'dependency_removed', pendingId);
    }
  }
  if (removals.size === 0 && folds.size === 0) return { ok: true, state, folded: false };
  if (state.preview && state.preview.executionState !== 'open') return fail(state, 'preview_not_open', state.preview.executionState);
  const nextOperations: PendingOperation[] = [];
  const removedIds = new Set<string>(removals);
  for (const create of state.operations) {
    if (create.action !== 'create' || create.target.kind !== 'new') continue;
    if (removals.has(create.pendingId)) {
      for (const child of state.operations) {
        if (child.target.kind === 'new' && child.action !== 'create' && child.target.localId === create.target.localId) removedIds.add(child.pendingId);
      }
      continue;
    }
    const ordered = orderDrafts(folds.get(create.pendingId) ?? [], state.dependencies);
    if (!ordered.ok) return fail(state, ordered.code, ordered.detail);
    const folded = applyFolds(create, ordered.operations);
    if (!folded.ok) return fail(state, folded.code, folded.detail);
    nextOperations.push(folded.operation);
    for (const child of ordered.operations) removedIds.add(child.pendingId);
  }
  for (const operation of state.operations) {
    if (removedIds.has(operation.pendingId) || (operation.action === 'create' && operation.target.kind === 'new')) continue;
    if (standaloneReminder(operation, byLocalId)) {
      nextOperations.push(operation);
      continue;
    }
    if (operation.target.kind === 'new') return fail(state, 'invalid_draft_reference', operation.target.localId);
    nextOperations.push(operation);
  }
  const dependencies: Record<string, readonly string[]> = {};
  for (const [dependent, prerequisites] of Object.entries(state.dependencies)) {
    if (removedIds.has(dependent)) continue;
    if (prerequisites.some((id) => removedIds.has(id))) return fail(state, 'dependency_removed', dependent);
    dependencies[dependent] = prerequisites;
  }
  return { ok: true, state: publish(state, nextOperations, dependencies, ids), folded: true };
}

function applyFolds(create: PendingOperation, dependents: PendingOperation[]): { ok: true; operation: PendingOperation } | { ok: false; code: string; detail: string } {
  let changes: OperationChangesV1 = { ...create.changes };
  let scheduling = create.scheduling;
  let constraints = create.constraints.map((constraint) => ({ ...constraint }));
  const written = new Map<string, string>();
  for (const dependent of dependents) {
    if (dependent.action === 'complete') {
      const conflict = claim(written, 'status', 'completed');
      if (conflict) return { ok: false, code: 'conflicting_patch', detail: 'status' };
      changes = { ...changes, status: 'completed' };
      continue;
    }
    for (const field of CHANGE_FIELDS) {
      if (dependent.changes[field] === undefined) continue;
      const conflict = claim(written, field, JSON.stringify(dependent.changes[field]));
      if (conflict) return { ok: false, code: 'conflicting_patch', detail: field };
      changes = { ...changes, [field]: dependent.changes[field] };
    }
    if (dependent.scheduling !== create.scheduling) {
      const conflict = claim(written, 'scheduling', dependent.scheduling);
      if (conflict) return { ok: false, code: 'conflicting_patch', detail: 'scheduling' };
      scheduling = dependent.scheduling;
    }
    for (const constraint of dependent.constraints) {
      const key = constraintKey(constraint);
      const body = JSON.stringify(withoutConstraintId(constraint));
      const conflict = claim(written, key, body);
      if (conflict) return { ok: false, code: 'conflicting_patch', detail: key };
      const temporal = withoutConstraintId(constraint);
      const index = constraints.findIndex((item) => constraintKey(item) === key);
      if (index >= 0) constraints[index] = { ...temporal, constraintId: constraints[index].constraintId };
      else constraints = [...constraints, { ...temporal, constraintId: constraint.constraintId }];
    }
  }
  const incompatible = incompatibleConstraints(constraints);
  if (incompatible) return { ok: false, code: 'contradictory_constraints', detail: incompatible };
  const changed = JSON.stringify({ changes, scheduling, constraints }) !== JSON.stringify({
    changes: create.changes,
    scheduling: create.scheduling,
    constraints: create.constraints,
  });
  return {
    ok: true,
    operation: { ...create, changes, scheduling, constraints, revision: changed ? create.revision + 1 : create.revision },
  };
}

/** A remind on a fresh draft id with no create behind it is its own reminder, not a draft reference. */
function standaloneReminder(operation: PendingOperation, creates: Map<string, PendingOperation[]>): boolean {
  return operation.action === 'remind' && operation.target.kind === 'new' && !creates.has(operation.target.localId);
}

function claim(written: Map<string, string>, key: string, value: string): boolean {
  const previous = written.get(key);
  if (previous != null && previous !== value) return true;
  written.set(key, value);
  return false;
}

function orderDrafts(operations: PendingOperation[], dependencies: StructuredState['dependencies']): { ok: true; operations: PendingOperation[] } | { ok: false; code: string; detail: string } {
  const ids = new Set(operations.map((operation) => operation.pendingId));
  const pending = [...operations];
  const ordered: PendingOperation[] = [];
  while (pending.length) {
    const next = pending.findIndex((operation) => (dependencies[operation.pendingId] ?? []).every((id) => !ids.has(id) || ordered.some((item) => item.pendingId === id)));
    if (next < 0) return { ok: false, code: 'dependency_cycle', detail: 'draft' };
    const [operation] = pending.splice(next, 1);
    ordered.push(operation);
  }
  return { ok: true, operations: ordered };
}

function publish(state: StructuredState, operations: PendingOperation[], dependencies: Record<string, readonly string[]>, ids: IdAllocator): StructuredState {
  const next = clone(state);
  const previous = next.preview;
  if (previous && previous.executionState === 'open') {
    next.executions = next.executions.map((record) => record.executionId === previous.executionId ? { ...record, state: 'superseded' } : record);
  }
  const executionId = ids.executionId();
  const previewRevision = (previous?.previewRevision ?? 0) + 1;
  const preview: PreviewSnapshot = {
    protocol: 'structured',
    previewRevision,
    executionId,
    executionState: 'open',
    items: operations.map((operation) => ({ pendingId: operation.pendingId, revision: operation.revision })),
  };
  const record: ExecutionRecord = {
    executionId,
    sessionId: state.sessionId,
    previewRevision,
    state: 'open',
    itemKeys: operations.map((operation) => operation.pendingId),
    itemState: Object.fromEntries(operations.map((operation) => [operation.pendingId, 'not_sent' as const])),
    sessionVersion: state.sessionVersion + 1,
  };
  next.operations = operations;
  next.dependencies = dependencies;
  next.preview = preview;
  next.executions = [...next.executions, record];
  next.sessionVersion += 1;
  return next;
}

function constraintKey(constraint: TemporalProposal): string {
  if (constraint.kind === 'clock') return `clock:${constraint.role}`;
  return constraint.kind;
}

function withoutConstraintId(constraint: TemporalProposal & { constraintId: string }): TemporalProposal {
  const copy = { ...constraint } as TemporalProposal & { constraintId?: string };
  delete copy.constraintId;
  return copy;
}

function incompatibleConstraints(constraints: Array<TemporalProposal & { constraintId: string }>): string | null {
  const starts = constraints.filter((item): item is Extract<TemporalProposal, { kind: 'clock' }> & { constraintId: string } => item.kind === 'clock' && item.role === 'start');
  if (new Set(starts.map((item) => item.value)).size > 1) return 'start_clock';
  const durations = constraints.filter((item) => item.kind === 'duration');
  if (new Set(durations.map((item) => item.kind === 'duration' ? item.minutes : 0)).size > 1) return 'duration';
  const intervals = constraints.filter((item): item is Extract<TemporalProposal, { kind: 'interval' }> & { constraintId: string } => item.kind === 'interval');
  for (const clock of starts) {
    for (const interval of intervals) {
      const start = minutes(interval.startHm);
      const end = minutes(interval.endHm);
      const at = minutes(clock.value);
      if (start == null || end == null || at == null || at < start || at > end) return 'clock_outside_interval';
    }
  }
  return null;
}

function minutes(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function fail(state: StructuredState, code: string, detail: string): DraftNormalization {
  return { ok: false, code, detail, state };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
