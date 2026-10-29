/**
 * Mechanical V1 envelope → ProposalGroup bridge for the structured cutover.
 * Maps shapes only. It does not recover clocks, titles, targets, or weekdays from language.
 * Weekday numbers are preserved for the deterministic temporal normalizer / projectApply.
 */
import type { SemanticConstraintV1, SemanticEnvelopeV1, SemanticOperationV1 } from './types';
import type { ProposalConstraint, ProposalGroup, ProposalTarget, SemanticOperationProposal, TemporalProposal } from './proposal';

export type EnvelopeMapClock = {
  nowIso: string;
  timeZone: string;
};

export function envelopeToProposalGroup(envelope: SemanticEnvelopeV1, _clock?: EnvelopeMapClock): ProposalGroup | null {
  if (envelope.kind === 'control') {
    if (envelope.control === 'confirm_pending') {
      return { version: '1', control: 'confirm', proposals: [], patches: [] };
    }
    if (envelope.control === 'cancel_pending') {
      return { version: '1', control: 'cancel', proposals: [], patches: [] };
    }
    return null;
  }
  if (envelope.kind !== 'operations') return null;
  const byOp = new Map(envelope.operations.map((operation) => [operation.opId, operation]));
  const folded = new Set<string>();
  const proposals: SemanticOperationProposal[] = [];
  for (const operation of envelope.operations) {
    if (folded.has(operation.opId)) continue;
    if (operation.target.kind === 'operation_result') {
      const base = byOp.get(operation.target.opId);
      if (base?.action === 'create' && base.target.kind === 'new') {
        const merged = mapOperation({
          ...base,
          changes: { ...base.changes, ...operation.changes },
          constraints: [...base.constraints, ...operation.constraints],
          source: operation.source.text ? operation.source : base.source,
        });
        if (!merged) return null;
        const index = proposals.findIndex((item) => item.localRef === base.opId);
        if (index >= 0) proposals[index] = { ...merged, localRef: base.opId };
        else proposals.push({ ...merged, localRef: base.opId });
        folded.add(operation.opId);
        continue;
      }
      return null;
    }
    const mapped = mapOperation(operation);
    if (!mapped) return null;
    proposals.push(mapped);
  }
  return {
    version: '1',
    control: 'none',
    proposals,
    patches: [],
  };
}

function mapOperation(operation: SemanticOperationV1): SemanticOperationProposal | null {
  const target = mapTarget(operation);
  if (!target) return null;
  const constraints: ProposalConstraint[] = [];
  for (let index = 0; index < operation.constraints.length; index += 1) {
    const temporal = mapConstraint(operation.constraints[index]);
    if (!temporal) continue;
    constraints.push({ ...temporal, localRef: `${operation.opId}-c${index}` });
  }
  const hasSchedule = constraints.some((constraint) =>
    constraint.kind === 'clock' || constraint.kind === 'date' || constraint.kind === 'interval' || constraint.kind === 'weekday');
  const description = operation.target.kind === 'existing'
    ? operation.target.description
    : operation.target.kind === 'unresolved'
      ? operation.target.phrase
      : undefined;
  const calendarId = operation.target.kind === 'existing' ? operation.target.calendarId : undefined;
  return {
    localRef: operation.opId,
    action: operation.action,
    entityType: operation.action === 'remind' ? 'reminder' : 'task',
    target,
    scheduling: hasSchedule ? 'scheduled' : 'unscheduled',
    changes: { ...operation.changes },
    constraints,
    dependsOn: operation.dependsOn.map((localRef) => ({ localRef })),
    known: Object.keys(operation.changes),
    missing: [],
    source: { text: operation.source.text },
    ...(operation.scope ? { scope: operation.scope } : {}),
    ...(description ? { scopeDescription: description } : {}),
    ...(calendarId ? { calendarId } : {}),
  };
}

function mapTarget(operation: SemanticOperationV1): ProposalTarget | null {
  const target = operation.target;
  if (target.kind === 'new') return { kind: 'new' };
  if (target.kind === 'existing') {
    if (operation.scope === 'all') {
      return { kind: 'unresolved', reason: 'ambiguous' };
    }
    if (typeof target.proposedId === 'string' && target.proposedId.trim()) {
      return { kind: 'entity', entityId: target.proposedId.trim() };
    }
    return { kind: 'unresolved', reason: 'ambiguous' };
  }
  if (target.kind === 'unresolved') return { kind: 'unresolved', reason: 'not_found' };
  return null;
}

function mapConstraint(constraint: SemanticConstraintV1): TemporalProposal | null {
  if (constraint.kind === 'date') return { kind: 'date', value: constraint.value };
  if (constraint.kind === 'clock' && (constraint.role === 'start' || constraint.role === 'end')) {
    return { kind: 'clock', value: constraint.value, role: constraint.role };
  }
  if (constraint.kind === 'duration') return { kind: 'duration', minutes: constraint.minutes };
  if (constraint.kind === 'ordering' && constraint.target.kind === 'existing' && constraint.target.proposedId) {
    return { kind: 'ordering', relation: constraint.relation, entityId: constraint.target.proposedId };
  }
  if (constraint.kind === 'weekday' && typeof constraint.weekday === 'number') {
    return {
      kind: 'weekday',
      weekday: constraint.weekday,
      ...(constraint.which === 'this' || constraint.which === 'next' ? { which: constraint.which } : {}),
    };
  }
  if (constraint.kind === 'time_of_day' || constraint.kind === 'relative_time') return { kind: 'unresolved' };
  return null;
}
