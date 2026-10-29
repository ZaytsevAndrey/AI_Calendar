/**
 * Pure checks for a proposal group. Does not assign ids and does not touch a session.
 */
import type { SemanticActionV1 } from './types';
import type { ValidationIssue } from './types';
import {
  PROPOSAL_CONTROLS,
  PROPOSAL_ENTITY_TYPES,
  SCHEDULING_STATES,
  type ConstraintPatch,
  type FieldPatch,
  type ProposalConstraint,
  type ProposalContext,
  type ProposalGroup,
  type SemanticOperationProposal,
  type TemporalProposal,
} from './proposal';

const ACTIONS = new Set<SemanticActionV1>(['create', 'update', 'delete', 'complete', 'skip', 'cancel', 'move', 'remind']);
const PREREQUISITE_ACTIONS = new Set<SemanticActionV1>(['create', 'update', 'move']);
const FIELD_NAMES = new Set(['title', 'notes', 'priority', 'location', 'scheduling']);
const PRIORITIES = new Set(['low', 'medium', 'high', 'urgent']);

export type ProposalValidation =
  | { ok: true; group: ProposalGroup }
  | { ok: false; errors: ValidationIssue[] };

function issue(errors: ValidationIssue[], code: string, path: string, detail: string): void {
  errors.push({ code, path, detail });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hm(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function contains(interval: { startHm: string; endHm: string }, clock: string): boolean | null {
  const start = hm(interval.startHm);
  const end = hm(interval.endHm);
  const at = hm(clock);
  if (start == null || end == null || at == null || start > end) return null;
  return at >= start && at <= end;
}

function parseTemporal(value: unknown, path: string, errors: ValidationIssue[]): TemporalProposal | null {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    issue(errors, 'invalid_type', path, 'temporal');
    return null;
  }
  if (value.kind === 'date' && typeof value.value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.value)) {
    return { kind: 'date', value: value.value };
  }
  if (value.kind === 'clock' && typeof value.value === 'string' && hm(value.value) != null && (value.role === 'start' || value.role === 'end')) {
    return { kind: 'clock', value: value.value, role: value.role };
  }
  if (value.kind === 'interval' && typeof value.startHm === 'string' && typeof value.endHm === 'string' && hm(value.startHm) != null && hm(value.endHm) != null && hm(value.startHm)! <= hm(value.endHm)!) {
    return { kind: 'interval', startHm: value.startHm, endHm: value.endHm };
  }
  if (value.kind === 'duration' && typeof value.minutes === 'number' && Number.isInteger(value.minutes) && value.minutes > 0) {
    return { kind: 'duration', minutes: value.minutes };
  }
  if (value.kind === 'ordering' && (value.relation === 'before' || value.relation === 'after') && typeof value.entityId === 'string' && value.entityId.trim()) {
    return { kind: 'ordering', relation: value.relation, entityId: value.entityId.trim() };
  }
  if (
    value.kind === 'weekday'
    && typeof value.weekday === 'number'
    && Number.isInteger(value.weekday)
    && value.weekday >= 0
    && value.weekday <= 6
    && (value.which === undefined || value.which === 'this' || value.which === 'next')
  ) {
    return {
      kind: 'weekday',
      weekday: value.weekday,
      ...(value.which === 'this' || value.which === 'next' ? { which: value.which } : {}),
    };
  }
  if (value.kind === 'unresolved' && Object.keys(value).every((key) => key === 'kind' || key === 'localRef')) {
    return { kind: 'unresolved' };
  }
  issue(errors, 'invalid_temporal', path, String(value.kind));
  return null;
}

function contradictoryTimes(constraints: TemporalProposal[], path: string, errors: ValidationIssue[]): void {
  const starts = constraints.filter((item): item is Extract<TemporalProposal, { kind: 'clock' }> => item.kind === 'clock' && item.role === 'start');
  if (new Set(starts.map((item) => item.value)).size > 1) issue(errors, 'contradictory_constraints', path, 'start_clock');
  const durations = constraints.filter((item): item is Extract<TemporalProposal, { kind: 'duration' }> => item.kind === 'duration');
  if (new Set(durations.map((item) => item.minutes)).size > 1) issue(errors, 'contradictory_constraints', path, 'duration');
  const intervals = constraints.filter((item): item is Extract<TemporalProposal, { kind: 'interval' }> => item.kind === 'interval');
  for (const clock of starts) {
    for (const interval of intervals) {
      const inside = contains(interval, clock.value);
      if (inside === false) issue(errors, 'contradictory_constraints', path, 'clock_outside_interval');
    }
  }
  for (let index = 0; index < intervals.length; index += 1) {
    for (const other of intervals.slice(index + 1)) {
      const left = intervals[index];
      if (hm(left.startHm)! > hm(other.endHm)! || hm(other.startHm)! > hm(left.endHm)!) {
        issue(errors, 'contradictory_constraints', path, 'disjoint_intervals');
      }
    }
  }
}

function parseProposal(value: unknown, path: string, context: ProposalContext, errors: ValidationIssue[]): SemanticOperationProposal | null {
  if (!isRecord(value)) {
    issue(errors, 'invalid_type', path, 'proposal');
    return null;
  }
  if ('pendingId' in value || 'opId' in value || 'constraintId' in value) {
    issue(errors, 'untrusted_identity', path, 'proposal');
  }
  const localRef = typeof value.localRef === 'string' ? value.localRef.trim() : '';
  if (!localRef) issue(errors, 'missing_local_ref', path, 'localRef');
  const action = value.action;
  if (typeof action !== 'string' || !ACTIONS.has(action as SemanticActionV1)) {
    issue(errors, 'unsupported_action', path, String(action));
    return null;
  }
  const entityType = value.entityType;
  if (typeof entityType !== 'string' || !PROPOSAL_ENTITY_TYPES.includes(entityType as typeof PROPOSAL_ENTITY_TYPES[number])) {
    issue(errors, 'invalid_entity_type', path, String(entityType));
    return null;
  }
  if (!isRecord(value.target) || typeof value.target.kind !== 'string') {
    issue(errors, 'invalid_type', `${path}.target`, 'target');
    return null;
  }
  let target: SemanticOperationProposal['target'] | null = null;
  if (value.target.kind === 'new' && Object.keys(value.target).length === 1) target = { kind: 'new' };
  else if (value.target.kind === 'entity' && typeof value.target.entityId === 'string' && value.target.entityId.trim()) {
    const entityId = value.target.entityId.trim();
    if (!context.entityIds.includes(entityId)) issue(errors, 'unauthorized_entity', `${path}.target`, entityId);
    target = { kind: 'entity', entityId };
  } else if (value.target.kind === 'pending' && typeof value.target.pendingId === 'string' && value.target.pendingId.trim()) {
    const pendingId = value.target.pendingId.trim();
    if (!context.pendingIds.includes(pendingId)) issue(errors, 'unauthorized_pending', `${path}.target`, pendingId);
    target = { kind: 'pending', pendingId };
  } else if (value.target.kind === 'unresolved' && (value.target.reason === 'not_found' || value.target.reason === 'search_incomplete' || value.target.reason === 'ambiguous')) {
    target = { kind: 'unresolved', reason: value.target.reason };
  }
  if (!target) issue(errors, 'invalid_target', `${path}.target`, String(value.target.kind));
  if (target?.kind === 'new' && action !== 'create') issue(errors, 'unsupported_combination', path, `${action}:new`);
  if (target && target.kind !== 'new' && target.kind !== 'unresolved' && action === 'create') issue(errors, 'unsupported_combination', path, 'create:existing');
  if (action === 'remind' && entityType !== 'reminder') issue(errors, 'unsupported_combination', path, 'remind');
  if (action !== 'remind' && action !== 'create' && entityType === 'reminder') issue(errors, 'unsupported_combination', path, `${action}:reminder`);
  const scheduling = value.scheduling;
  if (typeof scheduling !== 'string' || !SCHEDULING_STATES.includes(scheduling as typeof SCHEDULING_STATES[number])) {
    issue(errors, 'invalid_scheduling', path, String(scheduling));
    return null;
  }
  const constraints: ProposalConstraint[] = [];
  if (!Array.isArray(value.constraints)) issue(errors, 'invalid_type', `${path}.constraints`, 'array');
  else {
    const seen = new Set<string>();
    value.constraints.forEach((item, index) => {
      if (!isRecord(item) || typeof item.localRef !== 'string' || !item.localRef.trim()) {
        issue(errors, 'missing_local_ref', `${path}.constraints.${index}`, 'localRef');
        return;
      }
      if (seen.has(item.localRef)) issue(errors, 'duplicate_local_ref', `${path}.constraints.${index}`, item.localRef);
      seen.add(item.localRef);
      const temporal = parseTemporal(item, `${path}.constraints.${index}`, errors);
      if (!temporal) return;
      if (temporal.kind === 'ordering' && !context.entityIds.includes(temporal.entityId)) {
        issue(errors, 'unauthorized_entity', `${path}.constraints.${index}`, temporal.entityId);
      }
      constraints.push({ ...temporal, localRef: item.localRef.trim() });
    });
    contradictoryTimes(constraints, `${path}.constraints`, errors);
  }
  const dependsOn: SemanticOperationProposal['dependsOn'] = [];
  if (!Array.isArray(value.dependsOn)) issue(errors, 'invalid_type', `${path}.dependsOn`, 'array');
  else {
    value.dependsOn.forEach((item, index) => {
      if (!isRecord(item)) {
        issue(errors, 'invalid_dependency', `${path}.dependsOn.${index}`, 'shape');
        return;
      }
      if (typeof item.localRef === 'string' && item.localRef.trim() && !('pendingId' in item)) {
        dependsOn.push({ localRef: item.localRef.trim() });
        return;
      }
      if (typeof item.pendingId === 'string' && item.pendingId.trim() && !('localRef' in item)) {
        const pendingId = item.pendingId.trim();
        if (!context.pendingIds.includes(pendingId)) issue(errors, 'missing_dependency', `${path}.dependsOn.${index}`, pendingId);
        else if (!PREREQUISITE_ACTIONS.has(context.pendingActions[pendingId])) issue(errors, 'unsupported_dependency', `${path}.dependsOn.${index}`, context.pendingActions[pendingId] ?? 'unknown');
        dependsOn.push({ pendingId });
        return;
      }
      issue(errors, 'invalid_dependency', `${path}.dependsOn.${index}`, 'ambiguous');
    });
  }
  if (!isRecord(value.source) || typeof value.source.text !== 'string') issue(errors, 'invalid_type', `${path}.source`, 'source');
  if (!target || !localRef) return null;
  return {
    localRef,
    action: action as SemanticActionV1,
    entityType: entityType as SemanticOperationProposal['entityType'],
    target,
    scheduling: scheduling as SemanticOperationProposal['scheduling'],
    changes: isRecord(value.changes) ? value.changes as SemanticOperationProposal['changes'] : {},
    constraints,
    dependsOn,
    known: Array.isArray(value.known) ? value.known.filter((item): item is string => typeof item === 'string') : [],
    missing: Array.isArray(value.missing) ? value.missing.filter((item): item is string => typeof item === 'string') : [],
    source: { text: isRecord(value.source) && typeof value.source.text === 'string' ? value.source.text : '' },
  };
}

function parseField(value: unknown, path: string, errors: ValidationIssue[]): FieldPatch | null {
  if (!isRecord(value) || (value.op !== 'add' && value.op !== 'replace' && value.op !== 'remove')) {
    issue(errors, 'invalid_patch', path, 'field');
    return null;
  }
  if (typeof value.field !== 'string' || !FIELD_NAMES.has(value.field)) {
    issue(errors, 'invalid_patch', path, 'field_name');
    return null;
  }
  if (value.op === 'remove') {
    if (value.field === 'scheduling') issue(errors, 'invalid_patch', path, 'remove_scheduling');
    return { op: 'remove', field: value.field as 'title' };
  }
  if (value.field === 'scheduling') {
    if (typeof value.value !== 'string' || !SCHEDULING_STATES.includes(value.value as typeof SCHEDULING_STATES[number])) {
      issue(errors, 'invalid_patch', path, 'scheduling');
      return null;
    }
    return { op: 'replace', field: 'scheduling', value: value.value as FieldPatch extends { field: 'scheduling' } ? FieldPatch['value'] : never };
  }
  if (value.field === 'priority' && value.value != null && !PRIORITIES.has(String(value.value))) {
    issue(errors, 'invalid_patch', path, 'priority');
    return null;
  }
  if (value.value != null && typeof value.value !== 'string') {
    issue(errors, 'invalid_patch', path, 'value');
    return null;
  }
  return { op: value.op, field: value.field, value: value.value ?? null } as FieldPatch;
}

function parseConstraintPatch(value: unknown, path: string, errors: ValidationIssue[]): ConstraintPatch | null {
  if (!isRecord(value) || (value.op !== 'add' && value.op !== 'replace' && value.op !== 'remove')) {
    issue(errors, 'invalid_patch', path, 'constraint');
    return null;
  }
  if (value.op === 'remove') {
    if (typeof value.constraintId !== 'string' || !value.constraintId.trim()) {
      issue(errors, 'invalid_patch', path, 'constraintId');
      return null;
    }
    return { op: 'remove', constraintId: value.constraintId.trim() };
  }
  if (value.op === 'replace') {
    if (typeof value.constraintId !== 'string' || !value.constraintId.trim()) {
      issue(errors, 'invalid_patch', path, 'constraintId');
      return null;
    }
    const constraint = parseTemporal(value.constraint, `${path}.constraint`, errors);
    if (!constraint) return null;
    return { op: 'replace', constraintId: value.constraintId.trim(), constraint };
  }
  if (!isRecord(value.constraint) || typeof value.constraint.localRef !== 'string' || !value.constraint.localRef.trim()) {
    issue(errors, 'missing_local_ref', path, 'constraint');
    return null;
  }
  const constraint = parseTemporal(value.constraint, `${path}.constraint`, errors);
  if (!constraint) return null;
  return { op: 'add', constraint: { ...constraint, localRef: value.constraint.localRef.trim() } };
}

function sameField(left: FieldPatch, right: FieldPatch): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function validateProposalGroup(input: unknown, context: ProposalContext): ProposalValidation {
  const errors: ValidationIssue[] = [];
  if (!isRecord(input)) return { ok: false, errors: [{ code: 'invalid_type', path: '', detail: 'group' }] };
  if ('previewExecutionId' in input || 'executionId' in input || 'sessionVersion' in input) {
    issue(errors, 'untrusted_identity', '', 'backend_identity');
  }
  if (input.version !== '1') issue(errors, 'invalid_version', 'version', String(input.version));
  if (typeof input.control !== 'string' || !PROPOSAL_CONTROLS.includes(input.control as typeof PROPOSAL_CONTROLS[number])) {
    issue(errors, 'invalid_control', 'control', String(input.control));
  }
  const proposals: SemanticOperationProposal[] = [];
  if (!Array.isArray(input.proposals)) issue(errors, 'invalid_type', 'proposals', 'array');
  else input.proposals.forEach((item, index) => {
    const parsed = parseProposal(item, `proposals.${index}`, context, errors);
    if (parsed) proposals.push(parsed);
  });
  const seen = new Map<string, number>();
  proposals.forEach((proposal) => seen.set(proposal.localRef, (seen.get(proposal.localRef) ?? 0) + 1));
  for (const [ref, count] of seen) {
    if (count > 1) issue(errors, 'duplicate_local_ref', 'proposals', ref);
  }
  const refs = new Set(proposals.map((proposal) => proposal.localRef));
  proposals.forEach((proposal, index) => {
    proposal.dependsOn.forEach((dependency, dependencyIndex) => {
      if (!('localRef' in dependency)) return;
      if (!refs.has(dependency.localRef)) issue(errors, 'missing_dependency', `proposals.${index}.dependsOn.${dependencyIndex}`, dependency.localRef);
      const prerequisite = proposals.find((item) => item.localRef === dependency.localRef);
      if (prerequisite && !PREREQUISITE_ACTIONS.has(prerequisite.action)) {
        issue(errors, 'unsupported_dependency', `proposals.${index}.dependsOn.${dependencyIndex}`, prerequisite.action);
      }
    });
  });
  const color = new Map<string, 0 | 1 | 2>();
  const visit = (ref: string): boolean => {
    const state = color.get(ref) ?? 0;
    if (state === 1) return true;
    if (state === 2) return false;
    color.set(ref, 1);
    const proposal = proposals.find((item) => item.localRef === ref);
    for (const dependency of proposal?.dependsOn ?? []) {
      if ('localRef' in dependency && refs.has(dependency.localRef) && visit(dependency.localRef)) return true;
    }
    color.set(ref, 2);
    return false;
  };
  for (const ref of refs) {
    if (visit(ref)) {
      issue(errors, 'dependency_cycle', 'proposals', ref);
      break;
    }
  }
  const patches: ProposalGroup['patches'] = [];
  if (!Array.isArray(input.patches)) issue(errors, 'invalid_type', 'patches', 'array');
  else input.patches.forEach((item, index) => {
    if (!isRecord(item) || typeof item.pendingId !== 'string' || !item.pendingId.trim()) {
      issue(errors, 'invalid_patch', `patches.${index}`, 'pendingId');
      return;
    }
    const pendingId = item.pendingId.trim();
    if (!context.pendingIds.includes(pendingId)) issue(errors, 'unauthorized_pending', `patches.${index}`, pendingId);
    if (typeof item.baseRevision !== 'number' || !Number.isInteger(item.baseRevision) || item.baseRevision < 1) {
      issue(errors, 'invalid_revision', `patches.${index}`, String(item.baseRevision));
    } else if (context.pendingRevisions[pendingId] !== item.baseRevision) {
      issue(errors, 'invalid_revision', `patches.${index}`, String(item.baseRevision));
    }
    const fields: FieldPatch[] = [];
    const constraints: ConstraintPatch[] = [];
    if (!Array.isArray(item.fields)) issue(errors, 'invalid_patch', `patches.${index}.fields`, 'array');
    else item.fields.forEach((field, fieldIndex) => {
      const parsed = parseField(field, `patches.${index}.fields.${fieldIndex}`, errors);
      if (parsed) fields.push(parsed);
    });
    if (!Array.isArray(item.constraints)) issue(errors, 'invalid_patch', `patches.${index}.constraints`, 'array');
    else item.constraints.forEach((constraint, constraintIndex) => {
      const parsed = parseConstraintPatch(constraint, `patches.${index}.constraints.${constraintIndex}`, errors);
      if (!parsed) return;
      if ((parsed.op === 'replace' || parsed.op === 'remove') && !(context.constraintIdsByPending[pendingId] ?? []).includes(parsed.constraintId)) {
        issue(errors, 'unauthorized_constraint', `patches.${index}.constraints.${constraintIndex}`, parsed.constraintId);
      }
      constraints.push(parsed);
    });
    const names = new Map<string, FieldPatch>();
    for (const field of fields) {
      const previous = names.get(field.field);
      if (previous && !sameField(previous, field)) issue(errors, 'conflicting_patch', `patches.${index}`, field.field);
      names.set(field.field, field);
    }
    let retarget: { entityId: string } | undefined;
    if (item.retarget != null) {
      if (!isRecord(item.retarget) || typeof item.retarget.entityId !== 'string' || !context.entityIds.includes(item.retarget.entityId)) {
        issue(errors, 'unauthorized_entity', `patches.${index}.retarget`, 'entityId');
      } else retarget = { entityId: item.retarget.entityId };
    }
    patches.push({ pendingId, baseRevision: Number(item.baseRevision), fields, constraints, ...(retarget ? { retarget } : {}) });
  });
  const revisions = new Map<string, number>();
  for (const patch of patches) {
    const seenRevision = revisions.get(patch.pendingId);
    if (seenRevision != null && seenRevision !== patch.baseRevision) issue(errors, 'invalid_revision', 'patches', patch.pendingId);
    revisions.set(patch.pendingId, patch.baseRevision);
  }
  const control = input.control;
  const boundary = input.previewBoundary;
  if (control === 'confirm' && (proposals.length > 0 || patches.length > 0)) issue(errors, 'contradictory_group', 'control', 'confirm');
  if (control === 'cancel' && patches.length > 0) issue(errors, 'contradictory_group', 'control', 'cancel');
  if (control === 'cancel' && proposals.length > 0 && boundary !== 'replace') issue(errors, 'contradictory_group', 'control', 'cancel_boundary');
  if (control === 'pause' && (proposals.length > 0 || patches.length > 0)) issue(errors, 'contradictory_group', 'control', 'pause');
  if ((control === 'none' || control === 'new_command') && proposals.length === 0 && patches.length === 0) {
    issue(errors, 'contradictory_group', 'control', 'empty');
  }
  if (proposals.length > 0 && patches.length > 0 && boundary !== 'extend' && boundary !== 'replace') {
    issue(errors, 'contradictory_group', 'previewBoundary', 'missing');
  }
  if (errors.length) return { ok: false, errors };
  const group: ProposalGroup = {
    version: '1',
    control: control as ProposalGroup['control'],
    ...(boundary === 'extend' || boundary === 'replace' ? { previewBoundary: boundary } : {}),
    proposals,
    patches,
  };
  return { ok: true, group };
}
