import {
  applyProposalGroup,
  authorizeRetry,
  cancelPreview,
  commitIfVersion,
  confirmPreview,
  createStructuredState,
  recordProviderOutcome,
  sequenceAllocator,
  setConfirmationBlock,
  type IdAllocator,
  type KnownEntity,
  type StructuredState,
} from './structured-state';
import type { ProposalGroup } from '../contracts/proposal';

const report: KnownEntity = {
  entityId: 'task-report',
  entityType: 'task',
  revision: 4,
  calendarId: 'cal',
  writable: true,
};

function proposal(overrides: Record<string, unknown> = {}) {
  return {
    localRef: 'a',
    action: 'create',
    entityType: 'task',
    target: { kind: 'new' },
    scheduling: 'unscheduled',
    changes: { title: 'Planning' },
    constraints: [],
    dependsOn: [],
    known: ['title'],
    missing: [],
    source: { text: 'add Planning' },
    ...overrides,
  };
}

function group(overrides: Record<string, unknown> = {}): ProposalGroup {
  return { version: '1', control: 'none', proposals: [proposal()], patches: [], ...overrides } as ProposalGroup;
}

function apply(state: StructuredState, body: ProposalGroup, ids: IdAllocator, entities: KnownEntity[] = [report]) {
  return applyProposalGroup({ state, group: body, entities, ids, expectedSessionVersion: state.sessionVersion });
}

function openPreview() {
  const ids = sequenceAllocator();
  const created = apply(createStructuredState('session-1'), group(), ids);
  if (!created.ok || !created.state.preview) throw new Error('preview');
  return { ids, created, state: created.state };
}

describe('structured state engine', () => {
  it('materializes one create without binding an existing entity', () => {
    const { state } = openPreview();
    expect(state.operations).toHaveLength(1);
    expect(state.operations[0].action).toBe('create');
    expect(state.operations[0].target).toEqual({ kind: 'new', localId: expect.any(String) });
    expect(JSON.stringify(state.operations)).not.toContain('task-report');
    expect(state.operations[0].pendingId).not.toBe('a');
    expect(state.operations[0].sourceText).toBe('add Planning');
    expect(state.preview).toMatchObject({ protocol: 'structured', previewRevision: 1, executionState: 'open' });
  });

  it('materializes a dependent pair and keeps local refs out of stored ids', () => {
    const ids = sequenceAllocator();
    const result = apply(createStructuredState('session-1'), group({
      proposals: [
        proposal({ localRef: 'pop_1' }),
        proposal({ localRef: 'b', changes: { title: 'Follow up' }, dependsOn: [{ localRef: 'pop_1' }] }),
      ],
    }), ids);
    expect(result.ok).toBe(true);
    const [first, second] = result.state.operations;
    expect(first.action).toBe('create');
    expect(second.action).toBe('create');
    expect(first.pendingId).not.toBe('pop_1');
    expect(result.state.dependencies[second.pendingId]).toEqual([first.pendingId]);
    expect(JSON.stringify(result.state.dependencies)).not.toContain('local:');
  });

  it('rejects an unauthorized entity and leaves the snapshot untouched', () => {
    const state = createStructuredState('session-1');
    const snapshot = JSON.stringify(state);
    const result = apply(state, group({
      proposals: [proposal({ action: 'update', target: { kind: 'entity', entityId: 'task-forged' }, changes: { title: 'Report' } })],
    }), sequenceAllocator());
    expect(result.ok).toBe(false);
    expect(result.code).toBe('unauthorized_entity');
    expect(result.state).toBe(state);
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('rejects a duplicate local ref and a dependency cycle without mutation', () => {
    const state = createStructuredState('session-1');
    const duplicate = apply(state, group({ proposals: [proposal(), proposal()] }), sequenceAllocator());
    expect(duplicate.code).toBe('duplicate_local_ref');
    expect(duplicate.state).toBe(state);
    const cycle = apply(state, group({
      proposals: [
        proposal({ action: 'update', target: { kind: 'entity', entityId: 'task-report' }, dependsOn: [{ localRef: 'b' }] }),
        proposal({ localRef: 'b', action: 'update', target: { kind: 'entity', entityId: 'task-report' }, dependsOn: [{ localRef: 'a' }] }),
      ],
    }), sequenceAllocator());
    expect(cycle.code).toBe('dependency_cycle');
    expect(cycle.state.operations).toHaveLength(0);
  });

  it('does not rewrite create or move', () => {
    const ids = sequenceAllocator();
    const created = apply(createStructuredState('session-1'), group({
      proposals: [proposal({ changes: { title: 'Report' } })],
    }), ids);
    expect(created.state.operations[0].action).toBe('create');
    expect(created.state.operations[0].target.kind).toBe('new');
    const moved = apply(createStructuredState('session-1'), group({
      proposals: [proposal({ action: 'move', target: { kind: 'entity', entityId: 'task-report' }, scheduling: 'scheduled' })],
    }), sequenceAllocator());
    expect(moved.state.operations[0].action).toBe('move');
    expect(moved.state.operations[0].target).toMatchObject({ kind: 'entity', entityId: 'task-report' });
  });

  it('renames and reschedules one pending operation in a single revision step', () => {
    const { ids, state } = openPreview();
    const pendingId = state.operations[0].pendingId;
    const clock = state.operations[0].constraints;
    expect(clock).toEqual([]);
    const result = apply(state, group({
      proposals: [],
      patches: [
        { pendingId, baseRevision: 1, fields: [{ op: 'replace', field: 'title', value: 'Review' }], constraints: [] },
        {
          pendingId,
          baseRevision: 1,
          fields: [{ op: 'replace', field: 'scheduling', value: 'scheduled' }],
          constraints: [{ op: 'add', constraint: { localRef: 'c1', kind: 'clock', value: '19:00', role: 'start' } }],
        },
      ],
    }), ids);
    expect(result.ok).toBe(true);
    expect(result.state.operations).toHaveLength(1);
    expect(result.state.operations[0].pendingId).toBe(pendingId);
    expect(result.state.operations[0].revision).toBe(2);
    expect(result.state.operations[0].changes.title).toBe('Review');
    expect(result.state.operations[0].scheduling).toBe('scheduled');
    expect(result.state.operations[0].constraints.map((constraint) => constraint.kind)).toEqual(['clock']);
    expect(result.state.preview?.previewRevision).toBe(2);
    expect(result.state.sessionVersion).toBe(state.sessionVersion + 1);
    expect(result.state.executions[0].state).toBe('superseded');
    expect(result.state.preview?.executionId).not.toBe(state.preview?.executionId);
  });

  it('patches two pending operations once and keeps an extended sibling', () => {
    const ids = sequenceAllocator();
    const created = apply(createStructuredState('session-1'), group({
      proposals: [proposal(), proposal({ localRef: 'b', changes: { title: 'Follow up' } })],
    }), ids);
    const [first, second] = created.state.operations;
    const result = apply(created.state, group({
      proposals: [],
      previewBoundary: 'extend',
      patches: [
        { pendingId: first.pendingId, baseRevision: 1, fields: [{ op: 'replace', field: 'title', value: 'Alpha' }], constraints: [] },
        { pendingId: second.pendingId, baseRevision: 1, fields: [{ op: 'replace', field: 'title', value: 'Beta' }], constraints: [] },
      ],
    }), ids);
    expect(result.state.operations.map((operation) => [operation.pendingId, operation.revision, operation.changes.title])).toEqual([
      [first.pendingId, 2, 'Alpha'],
      [second.pendingId, 2, 'Beta'],
    ]);
    expect(result.state.preview?.previewRevision).toBe(2);
    expect(result.state.sessionVersion).toBe(2);
  });

  it('rejects conflicting titles and a stale revision without changing the preview', () => {
    const { ids, state } = openPreview();
    const pendingId = state.operations[0].pendingId;
    const conflict = apply(state, group({
      proposals: [],
      patches: [
        { pendingId, baseRevision: 1, fields: [{ op: 'replace', field: 'title', value: 'Alpha' }], constraints: [] },
        { pendingId, baseRevision: 1, fields: [{ op: 'replace', field: 'title', value: 'Beta' }], constraints: [] },
      ],
    }), ids);
    expect(conflict.ok).toBe(false);
    expect(conflict.code).toBe('conflicting_patch');
    expect(conflict.state).toBe(state);
    expect(state.preview?.executionState).toBe('open');
    const stale = apply(state, group({
      proposals: [],
      patches: [{ pendingId, baseRevision: 9, fields: [{ op: 'replace', field: 'title', value: 'Alpha' }], constraints: [] }],
    }), ids);
    expect(stale.code).toBe('invalid_revision');
    expect(stale.state.preview?.executionId).toBe(state.preview?.executionId);
  });

  it('extends unrelated operations and replace drops unmentioned drafts without a provider delete', () => {
    const ids = sequenceAllocator();
    const created = apply(createStructuredState('session-1'), group({
      proposals: [proposal(), proposal({ localRef: 'b', changes: { title: 'Follow up' } })],
    }), ids);
    const [first, second] = created.state.operations;
    const extended = apply(created.state, group({
      proposals: [],
      previewBoundary: 'extend',
      patches: [{ pendingId: first.pendingId, baseRevision: 1, fields: [{ op: 'replace', field: 'title', value: 'Alpha' }], constraints: [] }],
    }), ids);
    expect(extended.state.operations.map((operation) => operation.pendingId)).toEqual([first.pendingId, second.pendingId]);
    expect(extended.state.operations[1].revision).toBe(1);
    const replaced = apply(created.state, group({
      proposals: [proposal({ localRef: 'c', changes: { title: 'Fresh' } })],
      previewBoundary: 'replace',
      patches: [],
    }), ids);
    expect(replaced.ok).toBe(true);
    expect(replaced.state.operations).toHaveLength(1);
    expect(replaced.state.operations[0].action).toBe('create');
    expect(replaced.state.operations.map((operation) => operation.action)).not.toContain('delete');
    expect(replaced.state.operations.map((operation) => operation.pendingId)).not.toContain(first.pendingId);
  });

  it('keeps a clock inside a supplied interval and rejects one outside it', () => {
    const ids = sequenceAllocator();
    const accepted = apply(createStructuredState('session-1'), group({
      proposals: [proposal({
        scheduling: 'scheduled',
        constraints: [
          { localRef: 'c1', kind: 'clock', value: '19:00', role: 'start' },
          { localRef: 'c2', kind: 'interval', startHm: '17:00', endHm: '22:59' },
        ],
      })],
    }), ids);
    expect(accepted.ok).toBe(true);
    const pendingId = accepted.state.operations[0].pendingId;
    const rejected = apply(accepted.state, group({
      proposals: [],
      patches: [{
        pendingId,
        baseRevision: 1,
        fields: [],
        constraints: [{ op: 'replace', constraintId: accepted.state.operations[0].constraints[0].constraintId, constraint: { kind: 'clock', value: '09:00', role: 'start' } }],
      }],
    }), ids);
    expect(rejected.ok).toBe(false);
    expect(rejected.state).toBe(accepted.state);
  });

  it('preserves ordering, duration, date, and unresolved constraints when the clock changes', () => {
    const ids = sequenceAllocator();
    const created = apply(createStructuredState('session-1'), group({
      proposals: [proposal({
        scheduling: 'scheduled',
        constraints: [
          { localRef: 'c1', kind: 'clock', value: '19:00', role: 'start' },
          { localRef: 'c2', kind: 'ordering', relation: 'after', entityId: 'task-report' },
          { localRef: 'c3', kind: 'duration', minutes: 30 },
          { localRef: 'c4', kind: 'date', value: '2026-10-22' },
          { localRef: 'c5', kind: 'unresolved' },
        ],
      })],
    }), ids);
    const operation = created.state.operations[0];
    const clock = operation.constraints.find((constraint) => constraint.kind === 'clock');
    const result = apply(created.state, group({
      proposals: [],
      patches: [{
        pendingId: operation.pendingId,
        baseRevision: 1,
        fields: [],
        constraints: [{ op: 'replace', constraintId: clock?.constraintId, constraint: { kind: 'clock', value: '18:00', role: 'start' } }],
      }],
    }), ids);
    const kinds = result.state.operations[0].constraints.map((constraint) => constraint.kind).sort();
    expect(kinds).toEqual(['clock', 'date', 'duration', 'ordering', 'unresolved']);
    expect(result.state.operations[0].constraints.find((constraint) => constraint.kind === 'clock')).toMatchObject({ value: '18:00' });
    expect(result.state.operations[0].constraints.find((constraint) => constraint.kind === 'ordering')).toMatchObject({ entityId: 'task-report' });
    expect(result.state.operations[0].constraints.find((constraint) => constraint.kind === 'duration')).toMatchObject({ minutes: 30 });
    expect(result.state.operations[0].constraints.some((constraint) => constraint.kind === 'clock' && 'value' in constraint && constraint.value === '17:00')).toBe(false);
  });

  it('stores a create-then-update dependency on the draft and removes linked drafts together', () => {
    const ids = sequenceAllocator();
    const created = apply(createStructuredState('session-1'), group({
      proposals: [
        proposal(),
        proposal({ localRef: 'b', changes: { title: 'Follow up' }, dependsOn: [{ localRef: 'a' }] }),
      ],
    }), ids);
    const [draft, dependent] = created.state.operations;
    const updated = apply(created.state, group({
      previewBoundary: 'extend',
      proposals: [proposal({
        localRef: 'u',
        action: 'update',
        target: { kind: 'pending', pendingId: draft.pendingId },
        scheduling: 'scheduled',
        dependsOn: [{ pendingId: draft.pendingId }],
        changes: { title: 'Planning' },
      })],
    }), ids);
    const update = updated.state.operations.find((operation) => operation.action === 'update');
    expect(update?.target).toEqual(draft.target);
    expect(updated.state.dependencies[update!.pendingId]).toEqual([draft.pendingId]);
    expect(updated.state.operations.find((operation) => operation.pendingId === draft.pendingId)?.action).toBe('create');
    expect(JSON.stringify(update)).not.toContain('task-report');
    const blocked = apply(created.state, group({
      previewBoundary: 'replace',
      proposals: [],
      patches: [{ pendingId: dependent.pendingId, baseRevision: 1, fields: [{ op: 'replace', field: 'title', value: 'Kept' }], constraints: [] }],
    }), ids);
    expect(blocked.code).toBe('dependency_removed');
    expect(blocked.state).toBe(created.state);
    const removed = apply(created.state, group({
      previewBoundary: 'replace',
      proposals: [proposal({ localRef: 'c', changes: { title: 'Fresh' } })],
    }), ids);
    expect(removed.ok).toBe(true);
    expect(removed.state.operations.map((operation) => operation.pendingId)).toEqual([expect.any(String)]);
    expect(removed.state.operations[0].pendingId).not.toBe(draft.pendingId);
    expect(removed.state.operations[0].pendingId).not.toBe(dependent.pendingId);
    expect(removed.state.operations.every((operation) => operation.action !== 'delete')).toBe(true);
  });

  it('rejects a dangling dependency', () => {
    const state = createStructuredState('session-1');
    const result = apply(state, group({
      proposals: [proposal({ action: 'update', target: { kind: 'entity', entityId: 'task-report' }, dependsOn: [{ pendingId: 'pop-missing' }] })],
    }), sequenceAllocator());
    expect(result.code).toBe('missing_dependency');
    expect(result.state).toBe(state);
  });

  it('confirms an open structured preview and ignores a second confirm', () => {
    const { state } = openPreview();
    const preview = state.preview!;
    const confirmed = confirmPreview({
      state,
      expectedSessionVersion: state.sessionVersion,
      executionId: preview.executionId,
      previewRevision: preview.previewRevision,
    });
    expect(confirmed.ok).toBe(true);
    expect(confirmed.state.preview?.executionState).toBe('dispatched');
    expect(confirmed.state.executions.at(-1)?.state).toBe('dispatched');
    expect(confirmed.state.executions.at(-1)?.itemState[state.operations[0].pendingId]).toBe('not_sent');
    expect(JSON.stringify(confirmed.state.executions)).not.toContain('provider_succeeded');
    const again = confirmPreview({
      state: confirmed.state,
      expectedSessionVersion: confirmed.state.sessionVersion,
      executionId: preview.executionId,
      previewRevision: preview.previewRevision,
    });
    expect(again.ok).toBe(true);
    expect(again.duplicate).toBe(true);
    expect(again.state).toBe(confirmed.state);
    expect(again.state.sessionVersion).toBe(confirmed.state.sessionVersion);
  });

  it('rejects a stale id, a stale revision, and a superseded preview', () => {
    const { ids, state } = openPreview();
    const preview = state.preview!;
    const wrongId = confirmPreview({
      state,
      expectedSessionVersion: state.sessionVersion,
      executionId: 'exec_missing',
      previewRevision: preview.previewRevision,
    });
    expect(wrongId.code).toBe('stale_execution');
    expect(wrongId.state).toBe(state);
    const wrongRevision = confirmPreview({
      state,
      expectedSessionVersion: state.sessionVersion,
      executionId: preview.executionId,
      previewRevision: preview.previewRevision + 1,
    });
    expect(wrongRevision.code).toBe('stale_revision');
    const corrected = apply(state, group({
      proposals: [],
      patches: [{ pendingId: state.operations[0].pendingId, baseRevision: 1, fields: [{ op: 'replace', field: 'title', value: 'Review' }], constraints: [] }],
    }), ids);
    const stale = confirmPreview({
      state: corrected.state,
      expectedSessionVersion: corrected.state.sessionVersion,
      executionId: preview.executionId,
      previewRevision: preview.previewRevision,
    });
    expect(stale.code).toBe('superseded_preview');
    expect(stale.state.preview?.executionId).toBe(corrected.state.preview?.executionId);
    expect(stale.state).toBe(corrected.state);
  });

  it('lets only one of a competing confirm and correction commit', () => {
    const { ids, state } = openPreview();
    const preview = state.preview!;
    const confirmed = confirmPreview({
      state,
      expectedSessionVersion: state.sessionVersion,
      executionId: preview.executionId,
      previewRevision: preview.previewRevision,
    });
    const corrected = apply(state, group({
      proposals: [],
      patches: [{ pendingId: state.operations[0].pendingId, baseRevision: 1, fields: [{ op: 'replace', field: 'title', value: 'Review' }], constraints: [] }],
    }), ids);
    expect(confirmed.ok && corrected.ok).toBe(true);
    expect(state.preview?.executionState).toBe('open');
    const landed = commitIfVersion(state, state.sessionVersion, confirmed.state);
    const lost = commitIfVersion(landed.state, state.sessionVersion, corrected.state);
    expect(landed.ok).toBe(true);
    expect(lost.ok).toBe(false);
    expect(lost.code).toBe('version_conflict');
    expect(lost.state).toBe(landed.state);
    expect(lost.state.preview?.executionState).toBe('dispatched');
    const otherWay = commitIfVersion(state, state.sessionVersion, corrected.state);
    const lateConfirm = confirmPreview({
      state: otherWay.state,
      expectedSessionVersion: otherWay.state.sessionVersion,
      executionId: preview.executionId,
      previewRevision: preview.previewRevision,
    });
    expect(lateConfirm.ok).toBe(false);
    expect(lateConfirm.state.preview?.executionId).not.toBe(preview.executionId);
  });

  it('does not confirm while a clarification is open and does not dispatch a cancellation', () => {
    const { state } = openPreview();
    const blocked = setConfirmationBlock({ state, expectedSessionVersion: state.sessionVersion, blocked: true });
    const preview = blocked.state.preview!;
    const confirmed = confirmPreview({
      state: blocked.state,
      expectedSessionVersion: blocked.state.sessionVersion,
      executionId: preview.executionId,
      previewRevision: preview.previewRevision,
    });
    expect(confirmed.code).toBe('clarification_open');
    expect(confirmed.state.preview?.executionState).toBe('open');
    const cancelled = cancelPreview({
      state,
      expectedSessionVersion: state.sessionVersion,
      executionId: state.preview!.executionId,
      previewRevision: state.preview!.previewRevision,
    });
    expect(cancelled.ok).toBe(true);
    expect(cancelled.state.preview?.executionState).toBe('superseded');
    expect(cancelled.code).toBe('cancelled');
    expect(JSON.stringify(cancelled.state.executions)).not.toContain('dispatched');
  });

  it('records provider success separately and refuses to retry an unknown outcome', () => {
    const ids = sequenceAllocator();
    const created = apply(createStructuredState('session-1'), group({
      proposals: [proposal(), proposal({ localRef: 'b', changes: { title: 'Follow up' } })],
    }), ids);
    const confirmed = confirmPreview({
      state: created.state,
      expectedSessionVersion: created.state.sessionVersion,
      executionId: created.state.preview!.executionId,
      previewRevision: created.state.preview!.previewRevision,
    });
    const [first, second] = created.state.operations;
    const recorded = recordProviderOutcome({
      state: confirmed.state,
      expectedSessionVersion: confirmed.state.sessionVersion,
      executionId: confirmed.state.preview!.executionId,
      outcomes: [
        { itemKey: first.pendingId, outcome: 'provider_succeeded' },
        { itemKey: second.pendingId, outcome: 'unknown' },
      ],
    });
    expect(confirmed.state.preview?.executionState).toBe('dispatched');
    expect(recorded.state.preview?.executionState).toBe('unknown');
    expect(recorded.state.executions.at(-1)?.itemState[first.pendingId]).toBe('provider_succeeded');
    expect(recorded.state.executions.at(-1)?.itemState[second.pendingId]).toBe('unknown');
    const retried = authorizeRetry({
      state: recorded.state,
      expectedSessionVersion: recorded.state.sessionVersion,
      executionId: recorded.state.preview!.executionId,
      itemKey: second.pendingId,
      proof: 'reconciled_absent',
    });
    expect(retried.ok).toBe(false);
    expect(retried.code).toBe('unknown_not_retried');
    expect(retried.state).toBe(recorded.state);
  });

  it('keeps a succeeded item when another item failed and a retry is authorized', () => {
    const { state } = openPreview();
    const confirmed = confirmPreview({
      state,
      expectedSessionVersion: state.sessionVersion,
      executionId: state.preview!.executionId,
      previewRevision: state.preview!.previewRevision,
    });
    const pendingId = state.operations[0].pendingId;
    const failed = recordProviderOutcome({
      state: confirmed.state,
      expectedSessionVersion: confirmed.state.sessionVersion,
      executionId: state.preview!.executionId,
      outcomes: [{ itemKey: pendingId, outcome: 'definitive_failure' }],
    });
    expect(failed.state.preview?.executionState).toBe('definitive_failure');
    const authorized = authorizeRetry({
      state: failed.state,
      expectedSessionVersion: failed.state.sessionVersion,
      executionId: state.preview!.executionId,
      itemKey: pendingId,
      proof: 'pre_send',
    });
    expect(authorized.ok).toBe(true);
    expect(authorized.state.executions.at(-1)?.itemState[pendingId]).toBe('not_sent');
    const pair = apply(createStructuredState('session-1'), group({
      proposals: [proposal(), proposal({ localRef: 'b', changes: { title: 'Follow up' } })],
    }), sequenceAllocator());
    const dispatched = confirmPreview({
      state: pair.state,
      expectedSessionVersion: pair.state.sessionVersion,
      executionId: pair.state.preview!.executionId,
      previewRevision: pair.state.preview!.previewRevision,
    });
    const [kept, dropped] = pair.state.operations;
    const partial = recordProviderOutcome({
      state: dispatched.state,
      expectedSessionVersion: dispatched.state.sessionVersion,
      executionId: pair.state.preview!.executionId,
      outcomes: [
        { itemKey: kept.pendingId, outcome: 'provider_succeeded' },
        { itemKey: dropped.pendingId, outcome: 'definitive_failure' },
      ],
    });
    const retry = authorizeRetry({
      state: partial.state,
      expectedSessionVersion: partial.state.sessionVersion,
      executionId: pair.state.preview!.executionId,
      itemKey: dropped.pendingId,
      proof: 'provider_idempotent',
    });
    expect(retry.state.executions.at(-1)?.itemState[kept.pendingId]).toBe('provider_succeeded');
    expect(retry.state.executions.at(-1)?.itemState[dropped.pendingId]).toBe('not_sent');
    expect(retry.state.preview?.executionState).toBe('dispatched');
  });
});
