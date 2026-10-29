import type { SemanticEnvelopeV1, SemanticOperationV1 } from '../contracts/types';

/** Stable across providers. Does not look at scenario ids or the transcript. */
export function specialistReason(operation: SemanticOperationV1): string | null {
  if (operation.constraints.some((constraint) => constraint.kind === 'recurrence')) return 'recurrence_grammar';
  const start = operation.constraints.some((constraint) => constraint.kind === 'clock' && constraint.role === 'start');
  const end = operation.constraints.some((constraint) => constraint.kind === 'clock' && constraint.role === 'end');
  if (start && end && !operation.changes.spanRole) return 'event_window_ambiguity';
  return null;
}

export function envelopeSpecialistReason(envelope: SemanticEnvelopeV1): string | null {
  for (const operation of envelope.operations) {
    const reason = specialistReason(operation);
    if (reason) return reason;
  }
  return null;
}

export function mergeSpecialistFragment(
  base: SemanticEnvelopeV1,
  fragment: SemanticEnvelopeV1,
): { ok: true; envelope: SemanticEnvelopeV1 } | { ok: false; reason: string } {
  if (fragment.operations.length === 0) return { ok: false, reason: 'empty_fragment' };
  const merged = base.operations.map((operation) => ({ ...operation, changes: { ...operation.changes } }));
  for (const patch of fragment.operations) {
    const target = merged.find((operation) => operation.opId === patch.opId);
    if (!target) return { ok: false, reason: 'unknown_op' };
    if (patch.action !== target.action) return { ok: false, reason: 'action_changed' };
    if (patch.target.kind !== target.target.kind) return { ok: false, reason: 'target_changed' };
    if (patch.changes.spanRole) target.changes.spanRole = patch.changes.spanRole;
    if (patch.changes.reminder && target.changes.reminder) {
      target.changes.reminder = { ...target.changes.reminder, ...patch.changes.reminder };
    }
  }
  return { ok: true, envelope: { ...base, operations: merged } };
}
