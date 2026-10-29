/**
 * Pure structured state engine.
 * Not used by runVNextTurn, VoiceSessionStore, or calendar providers.
 * A successful result is a new snapshot. The caller must compare-and-set sessionVersion.
 * This module does not serialize requests across a process or a network.
 */
import type { OperationChangesV1, SemanticActionV1 } from '../contracts/types';
import type {
  EntityOccurrence,
  ExecutionRecord,
  ExecutionState,
  FieldPatch,
  OperationPatch,
  PendingOperation,
  PreviewSnapshot,
  ProposalGroup,
  SchedulingState,
  SeriesScope,
  TemporalProposal,
} from '../contracts/proposal';
import { validateProposalGroup } from '../contracts/proposal-validate';

export type KnownEntity = {
  entityId: string;
  entityType: PendingOperation['entityType'];
  revision: number;
  calendarId: string | null;
  writable: boolean;
  googleEventId?: string | null;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  status?: 'open' | 'completed' | 'canceled';
  recurring?: boolean;
  provider?: 'google' | 'microsoft' | 'apple';
  occurrences?: EntityOccurrence[];
  seriesEventId?: string | null;
  name?: string;
};

export type EntityFingerprint = {
  entityId: string;
  revision: number;
  calendarId: string | null;
  writable: boolean;
  googleEventId: string | null;
  status: 'open' | 'completed' | 'canceled';
  userId: string;
  requiresMoveIdentity: boolean;
  /** Read for a bound, not written: write access is not required, but it must not have changed. */
  reference?: boolean;
};

export type StructuredState = {
  sessionId: string;
  sessionVersion: number;
  operations: PendingOperation[];
  /** Values are backend pending ids. A localRef is never stored. */
  dependencies: Readonly<Record<string, readonly string[]>>;
  preview: PreviewSnapshot | null;
  executions: ExecutionRecord[];
  blocksConfirmation: boolean;
  /** Captured when the open preview was prepared. Confirm re-checks these rows. */
  entityFingerprints: Readonly<Record<string, EntityFingerprint>>;
};

export type IdAllocator = {
  pendingId(): string;
  constraintId(): string;
  executionId(): string;
};

export type StateTransition = {
  ok: boolean;
  code: string;
  detail: string;
  state: StructuredState;
  duplicate: boolean;
};

export type ProviderItemOutcome = 'provider_succeeded' | 'definitive_failure' | 'unknown';

export type RetryProof = 'pre_send' | 'reconciled_absent' | 'provider_idempotent';

type PlannedConstraint = { constraintId: string | null; temporal: TemporalProposal };

const PREREQUISITES = new Set<SemanticActionV1>(['create', 'update', 'move']);

export function createStructuredState(sessionId: string): StructuredState {
  return {
    sessionId,
    sessionVersion: 0,
    operations: [],
    dependencies: {},
    preview: null,
    executions: [],
    blocksConfirmation: false,
    entityFingerprints: {},
  };
}

export function sequenceAllocator(seed = 0): IdAllocator {
  let next = seed;
  const take = (prefix: string) => {
    next += 1;
    return `${prefix}_${next}`;
  };
  return {
    pendingId: () => take('pop'),
    constraintId: () => take('cst'),
    executionId: () => take('exec'),
  };
}

export function commitIfVersion(
  authoritative: StructuredState,
  expectedSessionVersion: number,
  candidate: StructuredState,
): StateTransition {
  if (authoritative.sessionVersion !== expectedSessionVersion || candidate.sessionVersion !== expectedSessionVersion + 1) {
    return fail(authoritative, 'version_conflict', String(authoritative.sessionVersion));
  }
  return pass(candidate, 'committed');
}

export function applyProposalGroup(input: {
  state: StructuredState;
  group: ProposalGroup;
  entities: readonly KnownEntity[];
  ids: IdAllocator;
  expectedSessionVersion: number;
}): StateTransition {
  const { state, ids } = input;
  const version = expectVersion(state, input.expectedSessionVersion);
  if (version) return version;
  if (input.group.control === 'confirm' || input.group.control === 'pause') {
    return fail(state, 'unvalidated_mutation', input.group.control);
  }
  // A dispatched or superseded preview is settled. Its operations are not carried into the next preview,
  // and a patch that names one of them fails validation as an unknown pending id.
  const current: StructuredState = state.preview && state.preview.executionState !== 'open'
    ? { ...state, operations: [], dependencies: {} }
    : state;
  const validated = validateProposalGroup(input.group, contextFrom(current, input.entities));
  if (!validated.ok) return fail(state, validated.errors[0]?.code ?? 'invalid_group', validated.errors[0]?.detail ?? '');
  const group = validated.group;
  const boundary = boundaryFor(current, group);
  if (typeof boundary !== 'string') return fail(state, boundary.code, boundary.detail);

  const removed = removalSet(current, group, boundary);
  const surviving = current.operations.filter((operation) => !removed.has(operation.pendingId));
  const patched = planPatches(surviving, group.patches, input.entities);
  if (!patched.ok) return fail(state, patched.code, patched.detail);
  const drafted = planProposals(group, input.entities, patched.operations);
  if (!drafted.ok) return fail(state, drafted.code, drafted.detail);
  const linked = linkDependencies(current, group, patched.operations, drafted.proposals, removed);
  if (!linked.ok) return fail(state, linked.code, linked.detail);

  const forbidden = new Set<string>([
    ...state.operations.map((operation) => operation.pendingId),
    ...group.proposals.map((proposal) => proposal.localRef),
  ]);
  const pendingIds = new Map<string, string>();
  for (const proposal of drafted.proposals) pendingIds.set(proposal.localRef, takeId(ids.pendingId, forbidden));
  const operations: PendingOperation[] = [
    ...patched.operations.map((operation) => sealOperation(operation, ids, forbidden)),
    ...drafted.proposals.map((proposal) => sealProposal(proposal, pendingIds.get(proposal.localRef)!, ids, forbidden)),
  ];
  const dependencies = sealDependencies(linked.edges, pendingIds);
  return commitPreview(current, operations, dependencies, ids);
}

export function confirmPreview(input: {
  state: StructuredState;
  expectedSessionVersion: number;
  executionId: string;
  previewRevision: number;
}): StateTransition {
  const { state } = input;
  const version = expectVersion(state, input.expectedSessionVersion);
  if (version) return version;
  const identity = matchPreview(state, input.executionId, input.previewRevision);
  if (!identity.ok) return fail(state, identity.code, identity.detail);
  if (state.blocksConfirmation) return fail(state, 'clarification_open', 'confirm');
  if (identity.record.state === 'dispatched') return pass(state, 'duplicate', true);
  if (identity.record.state !== 'open') return fail(state, 'preview_not_open', identity.record.state);
  const next = clone(state);
  next.preview = { ...identity.preview, executionState: 'dispatched' };
  next.executions = next.executions.map((record) =>
    record.executionId === identity.record.executionId ? { ...record, state: 'dispatched' } : record,
  );
  next.sessionVersion += 1;
  const active = next.executions.find((record) => record.executionId === identity.record.executionId);
  if (active) active.sessionVersion = next.sessionVersion;
  return pass(next, 'dispatched');
}

export function cancelPreview(input: {
  state: StructuredState;
  expectedSessionVersion: number;
  executionId: string;
  previewRevision: number;
}): StateTransition {
  const { state } = input;
  const version = expectVersion(state, input.expectedSessionVersion);
  if (version) return version;
  const identity = matchPreview(state, input.executionId, input.previewRevision);
  if (!identity.ok) return fail(state, identity.code, identity.detail);
  if (identity.record.state !== 'open') return fail(state, 'preview_not_open', identity.record.state);
  const next = clone(state);
  next.preview = { ...identity.preview, executionState: 'superseded' };
  next.executions = next.executions.map((record) =>
    record.executionId === identity.record.executionId ? { ...record, state: 'superseded', sessionVersion: state.sessionVersion + 1 } : record,
  );
  next.sessionVersion += 1;
  return pass(next, 'cancelled');
}

export function setConfirmationBlock(input: {
  state: StructuredState;
  expectedSessionVersion: number;
  blocked: boolean;
}): StateTransition {
  const version = expectVersion(input.state, input.expectedSessionVersion);
  if (version) return version;
  const next = clone(input.state);
  next.blocksConfirmation = input.blocked;
  next.sessionVersion += 1;
  return pass(next, 'clarification');
}

export function recordProviderOutcome(input: {
  state: StructuredState;
  expectedSessionVersion: number;
  executionId: string;
  outcomes: ReadonlyArray<{ itemKey: string; outcome: ProviderItemOutcome }>;
}): StateTransition {
  const { state } = input;
  const version = expectVersion(state, input.expectedSessionVersion);
  if (version) return version;
  const record = state.executions.find((item) => item.executionId === input.executionId);
  if (!record) return fail(state, 'unknown_execution', input.executionId);
  if (record.state !== 'dispatched') return fail(state, 'outcome_not_recordable', record.state);
  const itemState = { ...record.itemState };
  for (const outcome of input.outcomes) {
    if (!(outcome.itemKey in itemState)) return fail(state, 'unknown_item', outcome.itemKey);
    if (itemState[outcome.itemKey] === 'provider_succeeded') return fail(state, 'already_succeeded', outcome.itemKey);
    if (itemState[outcome.itemKey] !== 'not_sent') return fail(state, 'item_already_recorded', outcome.itemKey);
    itemState[outcome.itemKey] = outcome.outcome;
  }
  const next = clone(state);
  const stateName = overallState(itemState);
  next.executions = next.executions.map((item) =>
    item.executionId === record.executionId ? { ...item, itemState, state: stateName, sessionVersion: state.sessionVersion + 1 } : item,
  );
  if (next.preview?.executionId === record.executionId) {
    next.preview = { ...next.preview, executionState: stateName };
  }
  next.sessionVersion += 1;
  return pass(next, stateName);
}

export function authorizeRetry(input: {
  state: StructuredState;
  expectedSessionVersion: number;
  executionId: string;
  itemKey: string;
  proof: RetryProof;
}): StateTransition {
  const { state } = input;
  const version = expectVersion(state, input.expectedSessionVersion);
  if (version) return version;
  if (!input.proof) return fail(state, 'retry_not_proven', 'proof');
  const record = state.executions.find((item) => item.executionId === input.executionId);
  if (!record) return fail(state, 'unknown_execution', input.executionId);
  if (record.state === 'unknown') return fail(state, 'unknown_not_retried', input.executionId);
  const current = record.itemState[input.itemKey];
  if (current == null) return fail(state, 'unknown_item', input.itemKey);
  if (current === 'provider_succeeded') return fail(state, 'already_succeeded', input.itemKey);
  if (current === 'unknown') return fail(state, 'unknown_not_retried', input.itemKey);
  if (current !== 'definitive_failure') return fail(state, 'retry_not_applicable', current);
  const itemState = { ...record.itemState, [input.itemKey]: 'not_sent' as const };
  const next = clone(state);
  const stateName = overallState(itemState);
  next.executions = next.executions.map((item) =>
    item.executionId === record.executionId ? { ...item, itemState, state: stateName === 'open' ? 'dispatched' : stateName, sessionVersion: state.sessionVersion + 1 } : item,
  );
  if (next.preview?.executionId === record.executionId) {
    const visible = next.executions.find((item) => item.executionId === record.executionId)!;
    next.preview = { ...next.preview, executionState: visible.state };
  }
  next.sessionVersion += 1;
  return pass(next, 'retry_authorized');
}

type PlannedOperation = {
  operation: PendingOperation;
  constraints: PlannedConstraint[];
  changed: boolean;
};

type PlannedProposal = {
  localRef: string;
  action: SemanticActionV1;
  entityType: PendingOperation['entityType'];
  target: PendingOperation['target'];
  scheduling: SchedulingState;
  changes: OperationChangesV1;
  constraints: PlannedConstraint[];
  known: string[];
  missing: string[];
  sourceText: string;
  seriesScope?: SeriesScope;
  occurrenceDate?: string;
};

function planPatches(
  operations: PendingOperation[],
  patches: OperationPatch[],
  entities: readonly KnownEntity[],
): { ok: true; operations: PlannedOperation[] } | { ok: false; code: string; detail: string } {
  const grouped = new Map<string, OperationPatch[]>();
  for (const patch of patches) {
    const list = grouped.get(patch.pendingId) ?? [];
    list.push(patch);
    grouped.set(patch.pendingId, list);
  }
  const planned: PlannedOperation[] = [];
  for (const operation of operations) {
    const own = grouped.get(operation.pendingId) ?? [];
    if (own.some((patch) => patch.baseRevision !== operation.revision)) {
      return { ok: false, code: 'invalid_revision', detail: operation.pendingId };
    }
    const fields: FieldPatch[] = own.flatMap((patch) => patch.fields);
    const seen = new Map<string, string>();
    for (const field of fields) {
      const encoded = JSON.stringify(field);
      const previous = seen.get(field.field);
      if (previous != null && previous !== encoded) return { ok: false, code: 'conflicting_patch', detail: field.field };
      seen.set(field.field, encoded);
    }
    let changes: OperationChangesV1 = { ...operation.changes };
    let scheduling = operation.scheduling;
    for (const field of fields) {
      if (field.op === 'remove') {
        delete changes[field.field];
        continue;
      }
      if (field.field === 'scheduling') {
        scheduling = field.value;
        continue;
      }
      if (field.field === 'priority') {
        changes = { ...changes, priority: field.value as OperationChangesV1['priority'] };
        continue;
      }
      changes = { ...changes, [field.field]: field.value };
    }
    let constraints: PlannedConstraint[] = operation.constraints.map((constraint) => ({
      constraintId: constraint.constraintId,
      temporal: withoutId(constraint),
    }));
    for (const patch of own) {
      for (const constraintPatch of patch.constraints) {
        if (constraintPatch.op === 'remove') {
          constraints = constraints.filter((constraint) => constraint.constraintId !== constraintPatch.constraintId);
          continue;
        }
        if (constraintPatch.op === 'replace') {
          const index = constraints.findIndex((constraint) => constraint.constraintId === constraintPatch.constraintId);
          if (index < 0) return { ok: false, code: 'unauthorized_constraint', detail: constraintPatch.constraintId };
          constraints[index] = { constraintId: constraintPatch.constraintId, temporal: constraintPatch.constraint };
          continue;
        }
        constraints = [...constraints, { constraintId: null, temporal: withoutLocalRef(constraintPatch.constraint) }];
      }
    }
    const incompatible = incompatibleConstraints(constraints.map((constraint) => constraint.temporal));
    if (incompatible) return { ok: false, code: 'contradictory_constraints', detail: incompatible };
    let target = operation.target;
    for (const patch of own) {
      if (!patch.retarget) continue;
      const entity = entities.find((item) => item.entityId === patch.retarget?.entityId);
      if (!entity || !entity.writable) return { ok: false, code: 'unauthorized_entity', detail: patch.retarget.entityId };
      target = entityReference(entity);
    }
    const changed = JSON.stringify({ changes, scheduling, constraints, target }) !== JSON.stringify({
      changes: operation.changes,
      scheduling: operation.scheduling,
      constraints: operation.constraints.map((constraint) => ({ constraintId: constraint.constraintId, temporal: withoutId(constraint) })),
      target: operation.target,
    });
    planned.push({
      operation: { ...operation, changes, scheduling, target, revision: changed ? operation.revision + 1 : operation.revision },
      constraints,
      changed,
    });
  }
  return { ok: true, operations: planned };
}

function planProposals(
  group: ProposalGroup,
  entities: readonly KnownEntity[],
  operations: PlannedOperation[],
): { ok: true; proposals: PlannedProposal[] } | { ok: false; code: string; detail: string } {
  const proposals: PlannedProposal[] = [];
  for (const proposal of group.proposals) {
    if (proposal.action === 'create' && proposal.target.kind !== 'new') {
      return { ok: false, code: 'unsupported_combination', detail: 'create' };
    }
    if (proposal.action !== 'create' && proposal.action !== 'remind' && proposal.target.kind === 'new') {
      return { ok: false, code: 'unsupported_combination', detail: proposal.action };
    }
    const incompatible = incompatibleConstraints(proposal.constraints);
    if (incompatible) return { ok: false, code: 'contradictory_constraints', detail: incompatible };
    const target = resolveTarget(proposal, entities, operations);
    if (!target.ok) return target;
    proposals.push({
      localRef: proposal.localRef,
      action: proposal.action,
      entityType: proposal.entityType,
      target: target.target,
      scheduling: proposal.scheduling,
      changes: { ...proposal.changes },
      constraints: proposal.constraints.map((constraint) => ({ constraintId: null, temporal: withoutLocalRef(constraint) })),
      known: [...proposal.known],
      missing: [...proposal.missing],
      sourceText: proposal.source.text,
      ...(proposal.seriesScope ? { seriesScope: proposal.seriesScope } : {}),
      ...(proposal.occurrenceDate ? { occurrenceDate: proposal.occurrenceDate } : {}),
    });
  }
  return { ok: true, proposals };
}

function linkDependencies(
  state: StructuredState,
  group: ProposalGroup,
  operations: PlannedOperation[],
  proposals: PlannedProposal[],
  removed: Set<string>,
): { ok: true; edges: Map<string, string[]> } | { ok: false; code: string; detail: string } {
  const surviving = new Set(operations.map((item) => item.operation.pendingId));
  const edges = new Map<string, string[]>();
  for (const operation of operations) {
    const existing = (state.dependencies[operation.operation.pendingId] ?? []).filter((id) => surviving.has(id) || removed.has(id));
    edges.set(operation.operation.pendingId, [...existing]);
  }
  for (const proposal of group.proposals) {
    const deps: string[] = [];
    for (const dependency of proposal.dependsOn) {
      if ('localRef' in dependency) {
        if (!proposals.some((item) => item.localRef === dependency.localRef)) return { ok: false, code: 'missing_dependency', detail: dependency.localRef };
        const prerequisite = group.proposals.find((item) => item.localRef === dependency.localRef);
        if (prerequisite && !PREREQUISITES.has(prerequisite.action)) return { ok: false, code: 'unsupported_dependency', detail: prerequisite.action };
        deps.push(`local:${dependency.localRef}`);
      } else if (!surviving.has(dependency.pendingId)) {
        return { ok: false, code: 'missing_dependency', detail: dependency.pendingId };
      } else {
        const prerequisite = operations.find((item) => item.operation.pendingId === dependency.pendingId);
        if (prerequisite && !PREREQUISITES.has(prerequisite.operation.action)) return { ok: false, code: 'unsupported_dependency', detail: prerequisite.operation.action };
        deps.push(dependency.pendingId);
      }
    }
    edges.set(`local:${proposal.localRef}`, deps);
  }
  for (const [dependent, prerequisites] of edges) {
    if (!surviving.has(dependent) && !dependent.startsWith('local:')) continue;
    for (const prerequisite of prerequisites) {
      if (prerequisite.startsWith('local:')) continue;
      if (removed.has(prerequisite)) return { ok: false, code: 'dependency_removed', detail: prerequisite };
      if (!surviving.has(prerequisite)) return { ok: false, code: 'dangling_dependency', detail: prerequisite };
    }
  }
  if (hasCycle(edges)) return { ok: false, code: 'dependency_cycle', detail: 'group' };
  return { ok: true, edges };
}

function sealOperation(planned: PlannedOperation, ids: IdAllocator, forbidden: Set<string>): PendingOperation {
  const constraints = planned.constraints.map((constraint) => ({
    ...constraint.temporal,
    constraintId: constraint.constraintId ?? takeId(ids.constraintId, forbidden),
  }));
  const localId = planned.operation.target.kind === 'new'
    ? (planned.operation.target.localId || takeId(ids.pendingId, forbidden))
    : undefined;
  return {
    ...planned.operation,
    target: planned.operation.target.kind === 'new' ? { kind: 'new', localId: localId! } : planned.operation.target,
    constraints,
  };
}

function sealProposal(proposal: PlannedProposal, pendingId: string, ids: IdAllocator, forbidden: Set<string>): PendingOperation {
  const localId = proposal.target.kind === 'new' ? (proposal.target.localId || takeId(ids.pendingId, forbidden)) : '';
  return {
    pendingId,
    revision: 1,
    action: proposal.action,
    entityType: proposal.entityType,
    target: proposal.target.kind === 'new' ? { kind: 'new', localId } : proposal.target,
    scheduling: proposal.scheduling,
    changes: proposal.changes,
    constraints: proposal.constraints.map((constraint) => ({
      ...constraint.temporal,
      constraintId: takeId(ids.constraintId, forbidden),
    })),
    known: proposal.known,
    missing: proposal.missing,
    sourceText: proposal.sourceText,
    ...(proposal.seriesScope ? { seriesScope: proposal.seriesScope } : {}),
    ...(proposal.occurrenceDate ? { occurrenceDate: proposal.occurrenceDate } : {}),
  };
}

function sealDependencies(edges: Map<string, string[]>, pendingIds: Map<string, string>): Record<string, readonly string[]> {
  const dependencies: Record<string, string[]> = {};
  for (const [key, prerequisites] of edges) {
    const dependent = key.startsWith('local:') ? pendingIds.get(key.slice(6)) : key;
    if (!dependent) continue;
    dependencies[dependent] = prerequisites.map((prerequisite) =>
      prerequisite.startsWith('local:') ? pendingIds.get(prerequisite.slice(6)) ?? prerequisite : prerequisite,
    );
  }
  return dependencies;
}

function commitPreview(
  state: StructuredState,
  operations: PendingOperation[],
  dependencies: Record<string, readonly string[]>,
  ids: IdAllocator,
): StateTransition {
  const next = clone(state);
  const previous = next.preview;
  if (previous) {
    next.executions = next.executions.map((record) =>
      record.executionId === previous.executionId && record.state === 'open' ? { ...record, state: 'superseded' } : record,
    );
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
  return pass(next, 'preview');
}

function boundaryFor(state: StructuredState, group: ProposalGroup): 'extend' | 'replace' | { code: string; detail: string } {
  const hasExisting = state.operations.length > 0;
  const mixed = group.proposals.length > 0 && group.patches.length > 0;
  const addsToExisting = hasExisting && group.proposals.length > 0;
  if ((mixed || addsToExisting) && group.previewBoundary !== 'extend' && group.previewBoundary !== 'replace') {
    return { code: 'contradictory_group', detail: 'previewBoundary' };
  }
  if (group.previewBoundary === 'replace') return 'replace';
  return 'extend';
}

function removalSet(state: StructuredState, group: ProposalGroup, boundary: 'extend' | 'replace'): Set<string> {
  if (boundary !== 'replace') return new Set();
  const mentioned = new Set(group.patches.map((patch) => patch.pendingId));
  for (const proposal of group.proposals) {
    for (const dependency of proposal.dependsOn) {
      if ('pendingId' in dependency) mentioned.add(dependency.pendingId);
    }
    if (proposal.target.kind === 'pending') mentioned.add(proposal.target.pendingId);
  }
  return new Set(state.operations.map((operation) => operation.pendingId).filter((id) => !mentioned.has(id)));
}

function overallState(itemState: Record<string, 'not_sent' | ProviderItemOutcome>): ExecutionState {
  const values = Object.values(itemState);
  if (values.some((value) => value === 'unknown')) return 'unknown';
  if (values.length > 0 && values.every((value) => value === 'provider_succeeded')) return 'provider_succeeded';
  if (values.some((value) => value === 'definitive_failure') && values.every((value) => value === 'definitive_failure' || value === 'provider_succeeded')) {
    return 'definitive_failure';
  }
  if (values.every((value) => value === 'not_sent')) return 'dispatched';
  return 'dispatched';
}

function matchPreview(state: StructuredState, executionId: string, previewRevision: number):
  | { ok: true; preview: PreviewSnapshot; record: ExecutionRecord }
  | { ok: false; code: string; detail: string } {
  const record = state.executions.find((item) => item.executionId === executionId);
  if (!record) return { ok: false, code: 'stale_execution', detail: executionId };
  if (record.state === 'superseded') return { ok: false, code: 'superseded_preview', detail: executionId };
  if (!state.preview || state.preview.executionId !== executionId) return { ok: false, code: 'stale_execution', detail: executionId };
  if (state.preview.protocol !== 'structured') return { ok: false, code: 'unsupported_protocol', detail: state.preview.protocol };
  if (state.preview.previewRevision !== previewRevision || record.previewRevision !== previewRevision) {
    return { ok: false, code: 'stale_revision', detail: String(previewRevision) };
  }
  return { ok: true, preview: state.preview, record };
}

function expectVersion(state: StructuredState, expectedSessionVersion: number): StateTransition | null {
  if (state.sessionVersion !== expectedSessionVersion) return fail(state, 'version_conflict', String(state.sessionVersion));
  return null;
}

function contextFrom(state: StructuredState, entities: readonly KnownEntity[]) {
  return {
    entityIds: entities.map((entity) => entity.entityId),
    pendingIds: state.operations.map((operation) => operation.pendingId),
    pendingRevisions: Object.fromEntries(state.operations.map((operation) => [operation.pendingId, operation.revision])),
    pendingActions: Object.fromEntries(state.operations.map((operation) => [operation.pendingId, operation.action])),
    constraintIdsByPending: Object.fromEntries(state.operations.map((operation) => [operation.pendingId, operation.constraints.map((constraint) => constraint.constraintId)])),
  };
}

function entityReference(entity: KnownEntity): Extract<PendingOperation['target'], { kind: 'entity' }> {
  return {
    kind: 'entity',
    entityId: entity.entityId,
    entityType: entity.entityType,
    revision: entity.revision,
    calendarId: entity.calendarId,
    writable: entity.writable,
    ...(entity.googleEventId != null ? { googleEventId: entity.googleEventId } : {}),
    ...(entity.scheduledStart != null ? { scheduledStart: entity.scheduledStart } : {}),
    ...(entity.scheduledEnd != null ? { scheduledEnd: entity.scheduledEnd } : {}),
    ...(entity.status ? { status: entity.status } : {}),
    ...(entity.recurring ? { recurring: true } : {}),
    ...(entity.provider ? { provider: entity.provider } : {}),
    ...(entity.occurrences ? { occurrences: entity.occurrences } : {}),
    ...(entity.seriesEventId != null ? { seriesEventId: entity.seriesEventId } : {}),
    ...(entity.name ? { name: entity.name } : {}),
  };
}

function withoutId(constraint: TemporalProposal & { constraintId: string }): TemporalProposal {
  const { constraintId, ...temporal } = constraint;
  void constraintId;
  return temporal;
}

function withoutLocalRef(constraint: TemporalProposal & { localRef?: string }): TemporalProposal {
  const { localRef, ...temporal } = constraint;
  void localRef;
  return temporal as TemporalProposal;
}

function hm(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function incompatibleConstraints(constraints: TemporalProposal[]): string | null {
  const starts = constraints.filter((item): item is Extract<TemporalProposal, { kind: 'clock' }> => item.kind === 'clock' && item.role === 'start');
  if (new Set(starts.map((item) => item.value)).size > 1) return 'start_clock';
  const durations = constraints.filter((item): item is Extract<TemporalProposal, { kind: 'duration' }> => item.kind === 'duration');
  if (new Set(durations.map((item) => item.minutes)).size > 1) return 'duration';
  const intervals = constraints.filter((item): item is Extract<TemporalProposal, { kind: 'interval' }> => item.kind === 'interval');
  for (const clock of starts) {
    for (const interval of intervals) {
      const start = hm(interval.startHm);
      const end = hm(interval.endHm);
      const at = hm(clock.value);
      if (start == null || end == null || at == null || at < start || at > end) return 'clock_outside_interval';
    }
  }
  return null;
}

function hasCycle(edges: Map<string, string[]>): boolean {
  const color = new Map<string, 0 | 1 | 2>();
  const visit = (ref: string): boolean => {
    const state = color.get(ref) ?? 0;
    if (state === 1) return true;
    if (state === 2) return false;
    color.set(ref, 1);
    for (const next of edges.get(ref) ?? []) {
      if (visit(next)) return true;
    }
    color.set(ref, 2);
    return false;
  };
  for (const ref of edges.keys()) {
    if (visit(ref)) return true;
  }
  return false;
}

function takeId(next: () => string, forbidden: Set<string>): string {
  let id = next();
  while (forbidden.has(id)) id = next();
  forbidden.add(id);
  return id;
}

function clone(state: StructuredState): StructuredState {
  return JSON.parse(JSON.stringify(state)) as StructuredState;
}

function fail(state: StructuredState, code: string, detail: string): StateTransition {
  return { ok: false, code, detail, state, duplicate: false };
}

function pass(state: StructuredState, code: string, duplicate = false): StateTransition {
  return { ok: true, code, detail: '', state, duplicate };
}

function resolveTarget(
  proposal: ProposalGroup['proposals'][number],
  entities: readonly KnownEntity[],
  operations: PlannedOperation[],
): { ok: true; target: PendingOperation['target'] } | { ok: false; code: string; detail: string } {
  if (proposal.target.kind === 'new') return { ok: true, target: { kind: 'new', localId: '' } };
  if (proposal.target.kind === 'entity') {
    const entityId = proposal.target.entityId;
    const match = entities.find((item) => item.entityId === entityId);
    if (!match || !match.writable || match.entityType !== proposal.entityType) {
      return { ok: false, code: 'unauthorized_entity', detail: entityId };
    }
    return { ok: true, target: entityReference(match) };
  }
  if (proposal.target.kind === 'pending') {
    const pendingId = proposal.target.pendingId;
    const found = operations.find((item) => item.operation.pendingId === pendingId);
    if (!found || found.operation.target.kind !== 'new') {
      return { ok: false, code: 'unauthorized_pending', detail: pendingId };
    }
    return { ok: true, target: { kind: 'new', localId: found.operation.target.localId } };
  }
  return { ok: false, code: 'invalid_target', detail: proposal.target.reason };
}
