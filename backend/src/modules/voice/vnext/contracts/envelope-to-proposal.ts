/**
 * Mechanical V1 envelope → ProposalGroup bridge for the structured cutover.
 * Maps shapes only. It does not recover clocks, titles, targets, or weekdays from language.
 * Weekday numbers and the model's `which` are preserved for projectApply's documented calendar arithmetic.
 * A V1 field the proposal contract cannot carry becomes an explicit `unresolved` constraint or rejects
 * the group. It is never dropped.
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
    // "Wait, not yet": the preview stays as it is, nothing is applied or withdrawn (V7, g-a-46).
    if (envelope.control === 'answer_pending') {
      return { version: '1', control: 'pause', proposals: [], patches: [] };
    }
    return null;
  }
  if (envelope.kind !== 'operations') return null;
  // Same-envelope edits of a new object are folded into that create here, because a proposal can
  // address a draft only across turns. The dependent's action decides the fold:
  // update/move add their fields and constraints, complete sets the status, delete/cancel drop the
  // create, remind becomes its own reminder named after the create (a reminder holds no task id),
  // and anything else rejects the group. A later op on a dropped create also rejects it.
  const creates = new Map<string, SemanticOperationV1>();
  const dropped = new Set<string>();
  const reminders = new Map<string, SemanticOperationV1>();
  const reminderBase = new Map<string, string>();
  for (const operation of envelope.operations) {
    if (operation.action === 'create' && operation.target.kind === 'new') creates.set(operation.opId, operation);
  }
  // An operation_result whose opId is not a create of this envelope points at a pending operation
  // of the open preview (the prompt lists them by that id). It becomes a pending-target proposal
  // below; the state machine validates the id and folds it into that draft (VR-03 / VR-38).
  const crossTurn = new Set<string>();
  for (const operation of envelope.operations) {
    if (operation.target.kind !== 'operation_result') continue;
    const baseId = operation.target.opId;
    const base = creates.get(baseId);
    if (!base) {
      if (dropped.has(baseId)) return null;
      if (!CORRECTION_ACTIONS.has(operation.action)) return null;
      crossTurn.add(operation.opId);
      continue;
    }
    if (dropped.has(baseId)) return null;
    if (operation.action === 'delete' || operation.action === 'cancel') {
      dropped.add(baseId);
      continue;
    }
    if (operation.action === 'remind') {
      const reminder = operation.changes.reminder;
      if (reminder && reminder.op !== 'create') return null;
      reminderBase.set(operation.opId, baseId);
      reminders.set(operation.opId, {
        ...operation,
        target: { kind: 'new', localId: operation.opId },
        changes: { ...operation.changes, reminder: { ...reminder, op: 'create', name: reminder?.name || base.changes.title } },
        dependsOn: operation.dependsOn.filter((opId) => opId !== baseId),
      });
      continue;
    }
    if (operation.action !== 'update' && operation.action !== 'move' && operation.action !== 'complete') return null;
    creates.set(baseId, {
      ...base,
      changes: {
        ...base.changes,
        ...operation.changes,
        ...(operation.action === 'complete' ? { status: 'completed' as const } : {}),
      },
      constraints: [...base.constraints, ...operation.constraints],
    });
  }
  // A reminder about a create the same utterance withdrew has nothing to be about.
  if ([...reminderBase.values()].some((baseId) => dropped.has(baseId))) return null;
  // Waiting on a cancel or a delete orders nothing: the model writes it to say "after dropping that" (V7, g-b-22).
  const withdrawals = new Set(envelope.operations.filter((operation) => operation.action === 'cancel' || operation.action === 'delete').map((operation) => operation.opId));
  const proposals: SemanticOperationProposal[] = [];
  for (const operation of envelope.operations) {
    const standalone = reminders.get(operation.opId);
    if ((operation.target.kind === 'operation_result' && !standalone && !crossTurn.has(operation.opId)) || dropped.has(operation.opId)) continue;
    const source = standalone ?? creates.get(operation.opId) ?? operation;
    const mapped = mapOperation(withdrawals.size ? { ...source, dependsOn: source.dependsOn.filter((opId) => !withdrawals.has(opId)) } : source);
    if (!mapped) return null;
    proposals.push(mapped);
  }
  // A restatement replaces the open preview (extending would keep a corrected item next to its
  // correction). An envelope made only of corrections that address pending operations by id
  // extends it instead: the unmentioned operations of the preview are what the user did not
  // change and must stay (Stage 3: two creates, correct one, the other was lost).
  const correctionsOnly = crossTurn.size > 0 && proposals.every((proposal) => proposal.target.kind === 'pending');
  return {
    version: '1',
    control: 'none',
    previewBoundary: correctionsOnly ? 'extend' : 'replace',
    proposals,
    patches: [],
  };
}

/**
 * A stored reminder addressed with a task verb and `changes.reminder` is a reminder operation: the verb
 * becomes the reminder op (V7, live g-d-11 / en-d-06), so the established `remind` path handles it.
 */
function asReminderOperation(operation: SemanticOperationV1): SemanticOperationV1 {
  const reminder = operation.changes.reminder;
  if (!reminder || operation.action === 'remind' || operation.action === 'create' || operation.target.kind === 'new') return operation;
  const op = reminder.op ?? (operation.action === 'delete' || operation.action === 'cancel' ? 'delete' : operation.action === 'complete' ? 'resolve' : 'update');
  return { ...operation, action: 'remind', changes: { ...operation.changes, reminder: { ...reminder, op } } };
}

function mapOperation(given: SemanticOperationV1): SemanticOperationProposal | null {
  const operation = asReminderOperation(given);
  const target = mapTarget(operation);
  if (!target) return null;
  const constraints: ProposalConstraint[] = operation.constraints.map((constraint, index) => ({
    ...mapConstraint(constraint),
    localRef: `${operation.opId}-c${index}`,
  }));
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
    // A reminder is named by `remind`, or by `changes.reminder` on an update / complete / delete of a stored one (V7).
    entityType: operation.action === 'remind' || operation.changes.reminder ? 'reminder' : 'task',
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
    ...(operation.seriesScope ? { seriesScope: operation.seriesScope } : {}),
    ...(operation.occurrence ? { occurrenceDate: operation.occurrence } : {}),
    ...(operation.replaces ? { replaces: { pendingId: operation.replaces } } : {}),
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
  if (target.kind === 'operation_result') {
    // The validator normalises proposedId / id to opId; an envelope that skipped it is read the same way.
    const loose = target as { opId?: string; proposedId?: string; id?: string };
    const pendingId = loose.opId ?? loose.proposedId ?? loose.id;
    return pendingId ? { kind: 'pending', pendingId } : null;
  }
  return null;
}

/** Actions that may address a pending operation of the open preview across turns. */
const CORRECTION_ACTIONS = new Set(['update', 'move', 'complete', 'delete', 'cancel']);

/** Field-for-field. Anything without a proposal equivalent is `unresolved`, which projection refuses to preview. */
function mapConstraint(constraint: SemanticConstraintV1): TemporalProposal {
  if (constraint.kind === 'date') return { kind: 'date', value: constraint.value };
  // `preferred` is carried: a create projects it as a flexible preferred start;
  // every other action refuses it (projectApply).
  if (constraint.kind === 'clock') {
    return { kind: 'clock', value: constraint.value, role: constraint.role };
  }
  if (constraint.kind === 'all_day') return { kind: 'all_day' };
  if (constraint.kind === 'day_bound') return { kind: 'day_bound', edge: constraint.edge, role: constraint.role };
  // Only a delay from now is arithmetic on the model's numbers. Other anchors stay unresolved.
  if (
    constraint.kind === 'relative_time' && constraint.anchor === 'now' && constraint.direction === 'after'
    && typeof constraint.amount === 'number' && Number.isInteger(constraint.amount) && constraint.amount > 0 && constraint.unit
  ) {
    return { kind: 'relative', direction: 'after', amount: constraint.amount, unit: constraint.unit };
  }
  // "An hour later / earlier" for the task the operation addresses: a delay from its own start (V7, h-05).
  if (
    constraint.kind === 'relative_time' && constraint.anchor === 'referenced_task' && (constraint.direction === 'after' || constraint.direction === 'before')
    && typeof constraint.amount === 'number' && Number.isInteger(constraint.amount) && constraint.amount > 0 && constraint.unit
  ) {
    return { kind: 'relative', direction: constraint.direction, amount: constraint.amount, unit: constraint.unit, anchor: 'target' };
  }
  if (constraint.kind === 'duration') return { kind: 'duration', minutes: constraint.minutes };
  if (constraint.kind === 'ordering' && constraint.target.kind === 'existing' && constraint.target.proposedId) {
    return { kind: 'ordering', relation: constraint.relation, entityId: constraint.target.proposedId };
  }
  // Before or after an object this utterance creates: `op:` names that operation until it has a pending id.
  if (constraint.kind === 'ordering' && constraint.target.kind === 'operation_result' && constraint.target.opId) {
    return { kind: 'ordering', relation: constraint.relation, entityId: `op:${constraint.target.opId}` };
  }
  if (constraint.kind === 'weekday' && typeof constraint.weekday === 'number') {
    return {
      kind: 'weekday',
      weekday: constraint.weekday,
      ...(constraint.which === 'this' || constraint.which === 'next' ? { which: constraint.which } : {}),
    };
  }
  // The expression stays the user's words; only the model's structured pattern is carried.
  if (constraint.kind === 'recurrence' && constraint.pattern) {
    return { kind: 'recurrence', pattern: constraint.pattern, ...(constraint.weekDays ? { weekDays: constraint.weekDays } : {}) };
  }
  if (constraint.kind === 'time_of_day' && (constraint.bound === undefined || constraint.bound === 'at')) {
    return { kind: 'unresolved', label: constraint.label };
  }
  return { kind: 'unresolved' };
}
