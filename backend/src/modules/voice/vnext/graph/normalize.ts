import type { OperationChangesV1, SemanticOperationV1 } from '../contracts/types';

export type GraphIssue = { code: string; opId?: string; detail: string };

export type NormalizedOperation = SemanticOperationV1 & {
  sourceTexts: string[];
  canceled: boolean;
  blockedBy?: string;
};

export type NormalizedGraph = {
  operations: NormalizedOperation[];
  issues: GraphIssue[];
};

function sameNewObject(left: SemanticOperationV1, right: SemanticOperationV1): boolean {
  if (left.target.kind !== 'new') return false;
  const localId = left.target.localId;
  if (right.target.kind === 'new' && right.target.localId === localId) return true;
  if (right.target.kind === 'operation_result' && right.target.opId === left.opId) return true;
  return false;
}

function mergeChanges(base: OperationChangesV1, next: OperationChangesV1): OperationChangesV1 {
  const reminder = next.reminder?.op ? { ...base.reminder, ...next.reminder, op: next.reminder.op } : base.reminder;
  return {
    ...base,
    ...next,
    ...(reminder ? { reminder } : {}),
  };
}

function hasCycle(operations: SemanticOperationV1[]): boolean {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(operations.map((operation) => [operation.opId, operation]));
  const walk = (opId: string): boolean => {
    if (visiting.has(opId)) return true;
    if (visited.has(opId)) return false;
    visiting.add(opId);
    const operation = byId.get(opId);
    for (const dep of operation?.dependsOn ?? []) {
      if (byId.has(dep) && walk(dep)) return true;
    }
    visiting.delete(opId);
    visited.add(opId);
    return false;
  };
  return operations.some((operation) => walk(operation.opId));
}

function topo(operations: NormalizedOperation[]): NormalizedOperation[] {
  const incoming = new Map(operations.map((operation) => [operation.opId, new Set(operation.dependsOn)]));
  const pending = [...operations];
  const ordered: NormalizedOperation[] = [];
  while (pending.length) {
    const index = pending.findIndex((operation) => [...(incoming.get(operation.opId) ?? [])].every((dep) => ordered.some((row) => row.opId === dep) || !operations.some((row) => row.opId === dep)));
    if (index < 0) return operations;
    const [next] = pending.splice(index, 1);
    ordered.push(next);
  }
  return ordered;
}

/** Merge compatible edits of one new object. Keep a DAG. Do not merge similar names. */
export function normalizeOperations(operations: SemanticOperationV1[]): NormalizedGraph {
  const issues: GraphIssue[] = [];
  const seen = new Set<string>();
  for (const operation of operations) {
    if (seen.has(operation.opId)) issues.push({ code: 'duplicate_op', opId: operation.opId, detail: operation.opId });
    seen.add(operation.opId);
    for (const dep of operation.dependsOn) {
      if (!seen.has(dep) && !operations.some((row) => row.opId === dep)) {
        issues.push({ code: 'missing_dependency', opId: operation.opId, detail: dep });
      }
    }
  }
  if (hasCycle(operations)) issues.push({ code: 'cycle', detail: 'dependency cycle' });

  const canceled = new Set<string>();
  const origins = operations.filter(
    (operation) => (operation.action === 'create' || operation.action === 'remind') && operation.target.kind === 'new',
  );
  for (const create of origins) {
    const withdrawal = operations.find(
      (operation) =>
        (operation.action === 'delete' || operation.action === 'cancel') && sameNewObject(create, operation),
    );
    if (!withdrawal) continue;
    const others = operations.filter(
      (operation) =>
        operation.opId !== withdrawal.opId &&
        (operation.action === 'delete' || operation.action === 'cancel') &&
        sameNewObject(create, operation),
    );
    if (others.length) {
      issues.push({ code: 'ambiguous_withdrawal', opId: create.opId, detail: create.opId });
      continue;
    }
    canceled.add(create.opId);
    canceled.add(withdrawal.opId);
  }

  const consumed = new Set<string>();
  const folded: NormalizedOperation[] = [];
  const creates = origins.filter((operation) => operation.action === 'create');
  for (const create of creates) {
    if (canceled.has(create.opId)) {
      folded.push({ ...create, sourceTexts: [create.source.text], canceled: true });
      continue;
    }
    const edits = operations.filter(
      (operation) =>
        operation.opId !== create.opId &&
        !canceled.has(operation.opId) &&
        sameNewObject(create, operation) &&
        (operation.action === 'update' || operation.action === 'move' || operation.action === 'remind'),
    );
    let changes = { ...create.changes };
    const constraints = [...create.constraints];
    const sourceTexts = [create.source.text];
    const dependsOn = new Set(create.dependsOn);
    for (const edit of edits) {
      if (edit.action === 'remind') continue;
      changes = mergeChanges(changes, edit.changes);
      constraints.push(...edit.constraints);
      sourceTexts.push(edit.source.text);
      edit.dependsOn.forEach((dep) => dependsOn.add(dep));
      consumed.add(edit.opId);
    }
    const reminder = edits.find((edit) => edit.action === 'remind');
    folded.push({
      ...create,
      changes,
      constraints,
      dependsOn: [...dependsOn].filter((dep) => dep !== create.opId),
      sourceTexts,
      canceled: false,
    });
    if (reminder) {
      consumed.add(reminder.opId);
      folded.push({
        ...reminder,
        dependsOn: [...new Set([create.opId, ...reminder.dependsOn])],
        sourceTexts: [reminder.source.text],
        canceled: false,
      });
    }
  }

  for (const operation of operations) {
    if (creates.some((create) => create.opId === operation.opId)) continue;
    if (consumed.has(operation.opId)) continue;
    const canceledOp = canceled.has(operation.opId);
    folded.push({ ...operation, sourceTexts: [operation.source.text], canceled: canceledOp });
  }

  const deleteCounts = new Map<string, number>();
  for (const operation of folded) {
    if (operation.canceled || operation.action !== 'delete' || operation.target.kind !== 'existing') continue;
    const key = operation.target.proposedId || operation.target.description || operation.opId;
    deleteCounts.set(key, (deleteCounts.get(key) ?? 0) + 1);
  }
  for (const [key, count] of deleteCounts) {
    if (count > 1) issues.push({ code: 'double_delete', detail: key });
  }

  for (const operation of folded) {
    if (operation.canceled) continue;
    for (const dep of operation.dependsOn) {
      const prerequisite = folded.find((row) => row.opId === dep);
      if (prerequisite?.canceled) {
        operation.blockedBy = 'prerequisite_canceled';
        issues.push({ code: 'prerequisite_canceled', opId: operation.opId, detail: dep });
      }
    }
  }

  return { operations: topo(folded), issues };
}
