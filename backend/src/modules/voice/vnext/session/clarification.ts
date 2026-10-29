import type { SemanticConstraintV1, SemanticOperationV1, OperationChangesV1, TargetRefV1 } from '../contracts/types';
import { relatedName } from '../reference/reference-resolver';
import { supersedeConstraints } from './corrections';

export type BlockedOperation = {
  operation: SemanticOperationV1;
  code: string;
};

/**
 * Merge an answer envelope into the operations that were blocked.
 * Known fields stay. A field the answer restates replaces that field.
 * An operation id that was not blocked is ignored, so the answer cannot add a write.
 */
function subjectOf(operation: SemanticOperationV1): string {
  if (operation.target.kind === 'existing' && operation.target.description) return operation.target.description;
  return operation.changes.title ?? '';
}

/** A clock or date for the same task is a correction, even when the model calls it a create. */
function sameTaskCorrection(blocked: BlockedOperation[], patches: SemanticOperationV1[]): SemanticOperationV1[] {
  if (blocked.length !== 1 || patches.length !== 1) return patches;
  const base = blocked[0].operation;
  const patch = patches[0];
  const temporal = (action: string) => action === 'create' || action === 'update' || action === 'move';
  if (!temporal(base.action) || !temporal(patch.action)) return patches;
  if (!patch.constraints.some((constraint) => constraint.kind === 'clock' || constraint.kind === 'date' || constraint.kind === 'weekday')) return patches;
  const pending = subjectOf(base);
  const incoming = subjectOf(patch);
  if (incoming && pending && !relatedName(incoming, pending) && !relatedName(pending, incoming)) return patches;
  if (incoming && !pending) return patches;
  const target = patch.target.kind === 'existing' && patch.target.proposedId ? patch.target : base.target;
  return [{ ...patch, opId: base.opId, action: base.action, target }];
}

export function mergeAnswer(
  blocked: BlockedOperation[],
  patches: SemanticOperationV1[],
): { ok: true; operations: SemanticOperationV1[] } | { ok: false; code: 'unrelated_answer' | 'ambiguous_patch' } {
  const aligned = sameTaskCorrection(blocked, patches);
  const matched = aligned.filter((patch) => blocked.some((row) => row.operation.opId === patch.opId));
  if (!matched.length) return { ok: false, code: 'unrelated_answer' };
  if (matched.some((patch) => patch.action !== blocked.find((row) => row.operation.opId === patch.opId)?.operation.action)) {
    return { ok: false, code: 'unrelated_answer' };
  }
  const operations: SemanticOperationV1[] = [];
  for (const row of blocked) {
    const patch = matched.find((item) => item.opId === row.operation.opId);
    if (!patch) {
      operations.push(row.operation);
      continue;
    }
    const merged = mergeOperation(row.operation, patch);
    if (!merged.ok) return merged;
    operations.push(merged.operation);
  }
  return { ok: true, operations };
}

function mergeOperation(
  original: SemanticOperationV1,
  patch: SemanticOperationV1,
): { ok: true; operation: SemanticOperationV1 } | { ok: false; code: 'ambiguous_patch' } {
  const constraints = mergeConstraints(original.constraints, patch.constraints);
  if (!constraints.ok) return constraints;
  return {
    ok: true,
    operation: {
      ...original,
      target: mergeTarget(original.target, patch.target),
      changes: mergeChanges(original.changes, patch.changes),
      constraints: constraints.constraints,
      dependsOn: mergeDepends(original.dependsOn, patch.dependsOn),
      source: patch.source.text.trim() ? patch.source : original.source,
    },
  };
}

function mergeDepends(original: string[], patch: string[]): string[] {
  if (!patch.length) return original;
  return [...new Set([...original, ...patch])];
}

function mergeTarget(original: TargetRefV1, patch: TargetRefV1): TargetRefV1 {
  if (original.kind === 'unresolved' || original.kind === 'context') return patch;
  if (original.kind === 'existing' && patch.kind === 'existing') {
    if (!original.proposedId && patch.proposedId) return patch;
    if (patch.proposedId && patch.proposedId !== original.proposedId) return patch;
    if (patch.description && patch.description !== original.description) return { ...original, description: patch.description };
  }
  return original;
}

function mergeChanges(original: OperationChangesV1, patch: OperationChangesV1): OperationChangesV1 {
  const next: OperationChangesV1 = { ...original };
  if (patch.title !== undefined) next.title = patch.title;
  if (patch.notes !== undefined) next.notes = patch.notes;
  if (patch.priority !== undefined) next.priority = patch.priority;
  if (patch.status !== undefined) next.status = patch.status;
  if (patch.spanRole !== undefined) next.spanRole = patch.spanRole;
  if (patch.location !== undefined) next.location = patch.location;
  if (patch.reminder !== undefined) next.reminder = { ...original.reminder, ...patch.reminder };
  return next;
}

function targetKey(target: TargetRefV1): string {
  if (target.kind === 'new') return `new:${target.localId}`;
  if (target.kind === 'existing') return `existing:${target.proposedId ?? ''}:${target.description ?? ''}`;
  if (target.kind === 'operation_result') return `operation_result:${target.opId}`;
  if (target.kind === 'context') return `context:${target.referentKey}`;
  return `unresolved:${target.phrase}`;
}

function constraintKey(constraint: SemanticConstraintV1): string {
  if (constraint.kind === 'clock') return `clock:${constraint.role}`;
  if (constraint.kind === 'time_of_day') return `time_of_day:${constraint.label}:${constraint.bound ?? 'at'}`;
  if (constraint.kind === 'day_bound') return `day_bound:${constraint.edge}:${constraint.role}`;
  if (constraint.kind === 'relative_time') {
    return `relative_time:${constraint.anchor}:${constraint.direction}:${constraint.unit ?? ''}:${constraint.amount ?? ''}`;
  }
  if (constraint.kind === 'date') return `date:${constraint.precision}:${constraint.value}`;
  if (constraint.kind === 'weekday') return `weekday:${constraint.weekday}:${constraint.which}`;
  if (constraint.kind === 'duration') return `duration:${constraint.minutes}`;
  if (constraint.kind === 'recurrence') return `recurrence:${constraint.expression}`;
  if (constraint.kind === 'ordering') return `ordering:${constraint.relation}:${targetKey(constraint.target)}`;
  return 'constraint';
}

function constraintFamily(constraint: SemanticConstraintV1): string | null {
  if (constraint.kind === 'date' || constraint.kind === 'weekday' || constraint.kind === 'duration' || constraint.kind === 'recurrence' || constraint.kind === 'relative_time') {
    return constraint.kind;
  }
  return null;
}

function mergeConstraints(
  original: SemanticConstraintV1[],
  patch: SemanticConstraintV1[],
): { ok: true; constraints: SemanticConstraintV1[] } | { ok: false; code: 'ambiguous_patch' } {
  const merged = [...original];
  for (const constraint of patch) {
    const key = constraintKey(constraint);
    const exact = merged.map((item, index) => ({ item, index })).filter(({ item }) => constraintKey(item) === key);
    if (exact.length > 1) return { ok: false, code: 'ambiguous_patch' };
    if (exact.length === 1) {
      merged[exact[0].index] = constraint;
      continue;
    }
    const family = constraintFamily(constraint);
    if (!family) {
      merged.push(constraint);
      continue;
    }
    const sameFamily = merged.map((item, index) => ({ item, index })).filter(({ item }) => constraintFamily(item) === family);
    if (sameFamily.length > 1) return { ok: false, code: 'ambiguous_patch' };
    if (sameFamily.length === 1) merged[sameFamily[0].index] = constraint;
    else merged.push(constraint);
  }
  return { ok: true, constraints: supersedeConstraints(merged) };
}
