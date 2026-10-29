import { resolveZonedClock } from '../temporal/resolve-clock';
import type { ProposalGroup } from '../contracts/proposal';
import { normalizeDrafts } from './normalize-drafts';
import { projectApply } from './project-apply';
import { StructuredSessionStore } from './structured-session-store';
import {
  applyProposalGroup,
  cancelPreview,
  confirmPreview,
  createStructuredState,
  sequenceAllocator,
  type IdAllocator,
  type KnownEntity,
  type StructuredState,
} from './structured-state';

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
    scheduling: 'scheduled',
    changes: { title: 'Planning' },
    constraints: [
      { localRef: 'day', kind: 'date', value: '2026-10-22' },
      { localRef: 'clock', kind: 'clock', value: '19:00', role: 'start' },
      { localRef: 'dur', kind: 'duration', minutes: 30 },
    ],
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

function draftOf(state: StructuredState) {
  const draft = state.operations.find((operation) => operation.action === 'create' && operation.target.kind === 'new');
  if (!draft || draft.target.kind !== 'new') throw new Error('draft');
  return draft;
}

function depend(state: StructuredState, ids: IdAllocator, action: string, overrides: Record<string, unknown> = {}) {
  const draft = draftOf(state);
  return apply(state, group({
    previewBoundary: 'extend',
    proposals: [proposal({
      localRef: action,
      action,
      target: { kind: 'pending', pendingId: draft.pendingId },
      dependsOn: [{ pendingId: draft.pendingId }],
      changes: {},
      constraints: [],
      ...overrides,
    })],
  }), ids);
}

describe('draft normalization', () => {
  it('folds a rename and a move into one create and leaves the input snapshot unchanged', () => {
    const ids = sequenceAllocator();
    const created = apply(createStructuredState('session-1'), group(), ids);
    const renamed = depend(created.state, ids, 'update', { changes: { title: 'Review' } });
    const moved = depend(renamed.state, ids, 'move', {
      constraints: [{ localRef: 'next', kind: 'clock', value: '18:00', role: 'start' }],
    });
    const snapshot = JSON.stringify(moved.state);
    const normalized = normalizeDrafts(moved.state, ids);
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    expect(JSON.stringify(moved.state)).toBe(snapshot);
    expect(normalized.state).not.toBe(moved.state);
    expect(normalized.state.operations).toHaveLength(1);
    expect(normalized.state.operations[0].action).toBe('create');
    expect(normalized.state.operations[0].changes.title).toBe('Review');
    expect(normalized.state.operations[0].constraints.find((constraint) => constraint.kind === 'clock')).toMatchObject({ value: '18:00' });
    expect(normalized.state.operations[0].constraints.find((constraint) => constraint.kind === 'duration')).toMatchObject({ minutes: 30 });
    expect(normalized.state.operations.some((operation) => operation.action === 'update' || operation.action === 'move')).toBe(false);
    expect(normalized.state.preview?.executionId).not.toBe(moved.state.preview?.executionId);
    expect(normalized.state.sessionVersion).toBe(moved.state.sessionVersion + 1);
  });

  it('rejects two titles for the same draft without mutating the snapshot', () => {
    const ids = sequenceAllocator();
    const created = apply(createStructuredState('session-1'), group(), ids);
    const first = depend(created.state, ids, 'update', { changes: { title: 'Review' } });
    const second = depend(first.state, ids, 'update', { localRef: 'again', changes: { title: 'Notes' } });
    const result = normalizeDrafts(second.state, ids);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('conflicting_patch');
    expect(result.state).toBe(second.state);
  });

  it('folds a task completion into create status and rejects completion of a non-task draft', () => {
    const ids = sequenceAllocator();
    const created = apply(createStructuredState('session-1'), group(), ids);
    const completed = depend(created.state, ids, 'complete');
    const folded = normalizeDrafts(completed.state, ids);
    expect(folded.ok).toBe(true);
    if (!folded.ok) return;
    expect(folded.state.operations).toHaveLength(1);
    expect(folded.state.operations[0].action).toBe('create');
    expect(folded.state.operations[0].changes.status).toBe('completed');
    const external = apply(createStructuredState('session-1'), group({
      proposals: [proposal({ entityType: 'external_event', changes: { title: 'Flight' }, constraints: [], scheduling: 'unscheduled' })],
    }), sequenceAllocator());
    const externalIds = sequenceAllocator();
    const blocked = depend(external.state, externalIds, 'complete', { entityType: 'external_event' });
    const rejected = normalizeDrafts(blocked.state, externalIds);
    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.code).toBe('unsupported_draft_complete');
    expect(rejected.state).toBe(blocked.state);
  });

  it('removes a draft without emitting a provider delete, and rejects a surviving dependent', () => {
    const ids = sequenceAllocator();
    const created = apply(createStructuredState('session-1'), group(), ids);
    const linked = apply(created.state, group({
      previewBoundary: 'extend',
      proposals: [proposal({
        localRef: 'keep',
        action: 'update',
        target: { kind: 'entity', entityId: 'task-report' },
        changes: { title: 'Quarterly' },
        constraints: [],
        dependsOn: [{ pendingId: draftOf(created.state).pendingId }],
      })],
    }), ids);
    const removed = depend(linked.state, ids, 'delete');
    const blocked = normalizeDrafts(removed.state, ids);
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.code).toBe('dependency_removed');
    expect(blocked.state).toBe(removed.state);
    const draftOnly = depend(created.state, ids, 'delete');
    const gone = normalizeDrafts(draftOnly.state, ids);
    expect(gone.ok).toBe(true);
    if (!gone.ok) return;
    expect(gone.state.operations).toHaveLength(0);
    expect(gone.state.operations.some((operation) => operation.action === 'delete')).toBe(false);
  });

  it('removes a draft together with its draft edits and keeps an unrelated entity update', () => {
    const ids = sequenceAllocator();
    const created = apply(createStructuredState('session-1'), group(), ids);
    const renamed = depend(created.state, ids, 'update', { changes: { title: 'Review' } });
    const unrelated = apply(renamed.state, group({
      previewBoundary: 'extend',
      proposals: [proposal({
        localRef: 'other',
        action: 'update',
        target: { kind: 'entity', entityId: 'task-report' },
        changes: { title: 'Quarterly' },
        constraints: [],
      })],
    }), ids);
    const deleted = depend(unrelated.state, ids, 'delete');
    const result = normalizeDrafts(deleted.state, ids);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.operations.map((operation) => operation.action)).toEqual(['update']);
    expect(result.state.operations[0].target).toMatchObject({ kind: 'entity', entityId: 'task-report' });
  });

  it('does not fold an update of a persisted entity and rejects an unknown draft id', () => {
    const ids = sequenceAllocator();
    const created = apply(createStructuredState('session-1'), group(), ids);
    const separate = apply(created.state, group({
      previewBoundary: 'extend',
      proposals: [proposal({
        localRef: 'entity',
        action: 'update',
        target: { kind: 'entity', entityId: 'task-report' },
        changes: { title: 'Quarterly' },
        constraints: [],
      })],
    }), ids);
    const kept = normalizeDrafts(separate.state, ids);
    expect(kept.ok).toBe(true);
    if (!kept.ok) return;
    expect(kept.folded).toBe(false);
    expect(kept.state).toBe(separate.state);
    expect(kept.state.operations.map((operation) => operation.action)).toEqual(['create', 'update']);
    const copy = JSON.parse(JSON.stringify(separate.state)) as StructuredState;
    const forged = copy.operations[1];
    forged.action = 'update';
    forged.target = { kind: 'new', localId: 'missing' };
    const rejected = normalizeDrafts(copy, ids);
    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.code).toBe('invalid_draft_reference');
    expect(rejected.state).toBe(copy);
  });
});

describe('apply projection', () => {
  it('projects the folded Planning draft as one create without a provider id', () => {
    const ids = sequenceAllocator();
    const created = apply(createStructuredState('session-1'), group(), ids);
    const draft = draftOf(created.state);
    const renamed = depend(created.state, ids, 'update', { changes: { title: 'Review' } });
    const moved = depend(renamed.state, ids, 'move', {
      constraints: [{ localRef: 'next', kind: 'clock', value: '18:00', role: 'start' }],
    });
    const normalized = normalizeDrafts(moved.state, ids);
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    const projected = projectApply({ state: normalized.state, timeZone: 'Europe/Kyiv', catalogEntityIds: ['task-report'] });
    expect(projected.ok).toBe(true);
    if (!projected.ok) return;
    expect(projected.intents).toHaveLength(1);
    expect(projected.intents[0]).toMatchObject({ type: 'create', summary: 'Review' });
    if (projected.intents[0].type !== 'create') return;
    expect(projected.intents[0].task.name).toBe('Review');
    expect(projected.intents[0].task.taskId).toBeUndefined();
    const zoned = resolveZonedClock('2026-10-22', '18:00', 'Europe/Kyiv');
    expect(zoned.status).toBe('ok');
    if (zoned.status !== 'ok') return;
    expect(projected.intents[0].task.scheduledStartTime).toBe(zoned.iso);
    expect(projected.intents[0].task.estimatedTimeInMinutes).toBe(30);
    const encoded = JSON.stringify(projected);
    expect(encoded).not.toContain(draft.pendingId);
    expect(draft.target.kind === 'new' ? encoded.includes(draft.target.localId) : false).toBe(false);
  });

  it('projects a persisted update with the catalog id and keeps an independent create', () => {
    const ids = sequenceAllocator();
    const created = apply(createStructuredState('session-1'), group({
      proposals: [proposal({ scheduling: 'unscheduled', constraints: [] })],
    }), ids);
    const updated = apply(created.state, group({
      previewBoundary: 'extend',
      proposals: [proposal({
        localRef: 'entity',
        action: 'update',
        target: { kind: 'entity', entityId: 'task-report' },
        changes: { title: 'Quarterly' },
        constraints: [],
        scheduling: 'unscheduled',
      })],
    }), ids);
    const projected = projectApply({ state: updated.state, timeZone: 'Europe/Kyiv', catalogEntityIds: ['task-report'] });
    expect(projected.ok).toBe(true);
    if (!projected.ok) return;
    expect(projected.intents.map((intent) => intent.type)).toEqual(['create', 'command']);
    const command = projected.intents[1];
    expect(command.type === 'command' && command.command.taskId).toBe('task-report');
    expect(command.type === 'command' && command.command.kind).toBe('update');
    expect(JSON.stringify(projected.intents[0])).not.toContain('task-report');
    expect(projected.items[1].dependsOn).toBeUndefined();
  });

  it('rejects a draft command, a stored move, a read-only target, and an id outside the catalog', () => {
    const ids = sequenceAllocator();
    const created = apply(createStructuredState('session-1'), group({
      proposals: [proposal({ scheduling: 'unscheduled', constraints: [] })],
    }), ids);
    const renamed = depend(created.state, ids, 'update', { changes: { title: 'Review' }, scheduling: 'unscheduled', constraints: [] });
    const unsafe = projectApply({ state: renamed.state, timeZone: 'Europe/Kyiv', catalogEntityIds: ['task-report'] });
    expect(unsafe.ok).toBe(false);
    if (unsafe.ok) return;
    expect(unsafe.code).toBe('draft_command');
    expect('intents' in unsafe).toBe(false);
    const moved = apply(createStructuredState('session-1'), group({
      proposals: [proposal({
        action: 'move',
        target: { kind: 'entity', entityId: 'task-report' },
        changes: {},
        constraints: [{ localRef: 'clock', kind: 'clock', value: '18:00', role: 'start' }],
      })],
    }), sequenceAllocator());
    const move = projectApply({ state: moved.state, timeZone: 'Europe/Kyiv', catalogEntityIds: ['task-report'] });
    expect(move.ok).toBe(false);
    if (move.ok) return;
    expect(move.code).toBe('unrepresentable_move');
    const updated = apply(createStructuredState('session-1'), group({
      proposals: [proposal({
        action: 'update',
        target: { kind: 'entity', entityId: 'task-report' },
        changes: { title: 'Quarterly' },
        constraints: [],
        scheduling: 'unscheduled',
      })],
    }), sequenceAllocator());
    const locked = JSON.parse(JSON.stringify(updated.state)) as StructuredState;
    const target = locked.operations[0].target;
    if (target.kind === 'entity') target.writable = false;
    const readonly = projectApply({ state: locked, timeZone: 'Europe/Kyiv', catalogEntityIds: ['task-report'] });
    expect(readonly.ok).toBe(false);
    if (readonly.ok) return;
    expect(readonly.code).toBe('unauthorized_entity');
    const unknown = projectApply({ state: updated.state, timeZone: 'Europe/Kyiv', catalogEntityIds: [] });
    expect(unknown.ok).toBe(false);
    if (unknown.ok) return;
    expect(unknown.code).toBe('unauthorized_entity');
    expect('intents' in unknown).toBe(false);
  });
});

describe('structured session store', () => {
  const user = 'user-1';
  const session = 'session-1';

  function preview() {
    const ids = sequenceAllocator();
    const store = new StructuredSessionStore();
    const opened = store.open(user, session);
    const created = apply(opened, group({ proposals: [proposal({ scheduling: 'unscheduled', constraints: [] })] }), ids);
    return { ids, store, created };
  }

  it('isolates users, returns copies, and commits one version', async () => {
    const { store, created } = preview();
    const committed = await store.commit(user, session, 0, created.state);
    expect(committed.ok).toBe(true);
    const first = store.read(user, session);
    const other = store.open('user-2', session);
    expect(other.sessionVersion).toBe(0);
    expect(other.operations).toHaveLength(0);
    if (!first) throw new Error('missing');
    first.sessionVersion = 99;
    expect(store.read(user, session)?.sessionVersion).toBe(created.state.sessionVersion);
    const stale = await store.commit(user, session, 0, created.state);
    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.code).toBe('version_conflict');
    expect(store.read(user, session)?.sessionVersion).toBe(created.state.sessionVersion);
  });

  it('lets one of two concurrent confirmations and corrections commit', async () => {
    const { ids, store, created } = preview();
    await store.commit(user, session, 0, created.state);
    const base = store.read(user, session);
    if (!base?.preview) throw new Error('preview');
    const confirmed = confirmPreview({
      state: base,
      expectedSessionVersion: base.sessionVersion,
      executionId: base.preview.executionId,
      previewRevision: base.preview.previewRevision,
    });
    const corrected = apply(base, group({
      proposals: [],
      patches: [{ pendingId: base.operations[0].pendingId, baseRevision: 1, fields: [{ op: 'replace', field: 'title', value: 'Review' }], constraints: [] }],
    }), ids);
    const [left, right] = await Promise.all([
      store.commit(user, session, base.sessionVersion, confirmed.state),
      store.commit(user, session, base.sessionVersion, corrected.state),
    ]);
    const winner = left.ok ? left : right;
    const loser = left.ok ? right : left;
    expect(winner.ok).toBe(true);
    expect(loser.ok).toBe(false);
    if (loser.ok) return;
    expect(loser.code).toBe('version_conflict');
    expect(loser.state.sessionVersion).toBe(base.sessionVersion + 1);
    expect(JSON.stringify(store.read(user, session))).toBe(JSON.stringify(winner.state));
    expect(store.read(user, session)?.sessionVersion).toBe(base.sessionVersion + 1);
  });

  it('does not dispatch a second confirm or apply both corrections', async () => {
    const { ids, store, created } = preview();
    await store.commit(user, session, 0, created.state);
    const base = store.read(user, session);
    if (!base?.preview) throw new Error('preview');
    const claim = {
      state: base,
      expectedSessionVersion: base.sessionVersion,
      executionId: base.preview.executionId,
      previewRevision: base.preview.previewRevision,
    };
    const first = confirmPreview(claim);
    const second = confirmPreview(claim);
    const [one, two] = await Promise.all([
      store.commit(user, session, base.sessionVersion, first.state),
      store.commit(user, session, base.sessionVersion, second.state),
    ]);
    expect([one.ok, two.ok].filter(Boolean)).toHaveLength(1);
    const stored = store.read(user, session);
    expect(stored?.preview?.executionState).toBe('dispatched');
    expect(stored?.sessionVersion).toBe(base.sessionVersion + 1);
    expect(stored?.executions.filter((record) => record.state === 'dispatched')).toHaveLength(1);
    const again = store.read(user, session);
    if (!again) throw new Error('missing');
    const alpha = apply(again, group({
      proposals: [],
      patches: [{ pendingId: again.operations[0].pendingId, baseRevision: 1, fields: [{ op: 'replace', field: 'title', value: 'Alpha' }], constraints: [] }],
    }), ids);
    expect(alpha.ok).toBe(false);
    const open = preview();
    await open.store.commit(user, session, 0, open.created.state);
    const current = open.store.read(user, session);
    if (!current) throw new Error('missing');
    const left = apply(current, group({
      proposals: [],
      patches: [{ pendingId: current.operations[0].pendingId, baseRevision: 1, fields: [{ op: 'replace', field: 'title', value: 'Alpha' }], constraints: [] }],
    }), open.ids);
    const right = apply(current, group({
      proposals: [],
      patches: [{ pendingId: current.operations[0].pendingId, baseRevision: 1, fields: [{ op: 'replace', field: 'title', value: 'Beta' }], constraints: [] }],
    }), open.ids);
    const raced = await Promise.all([
      open.store.commit(user, session, current.sessionVersion, left.state),
      open.store.commit(user, session, current.sessionVersion, right.state),
    ]);
    expect(raced.filter((result) => result.ok)).toHaveLength(1);
    const title = open.store.read(user, session)?.operations[0].changes.title;
    expect(title === 'Alpha' || title === 'Beta').toBe(true);
    expect(open.store.read(user, session)?.sessionVersion).toBe(current.sessionVersion + 1);
  });

  it('commits either cancellation or confirmation, and drops expired sessions with their queues', async () => {
    let now = 0;
    const store = new StructuredSessionStore(10, () => now);
    const ids = sequenceAllocator();
    const opened = store.open(user, session);
    const created = apply(opened, group({ proposals: [proposal({ scheduling: 'unscheduled', constraints: [] })] }), ids);
    await store.commit(user, session, 0, created.state);
    const base = store.read(user, session);
    if (!base?.preview) throw new Error('preview');
    const claim = {
      state: base,
      expectedSessionVersion: base.sessionVersion,
      executionId: base.preview.executionId,
      previewRevision: base.preview.previewRevision,
    };
    const raced = await Promise.all([
      store.commit(user, session, base.sessionVersion, confirmPreview(claim).state),
      store.commit(user, session, base.sessionVersion, cancelPreview(claim).state),
    ]);
    expect(raced.filter((result) => result.ok)).toHaveLength(1);
    const state = raced.find((result) => result.ok)?.state.preview?.executionState;
    expect(state === 'dispatched' || state === 'superseded').toBe(true);
    expect(store.read(user, session)?.preview?.executionState).toBe(state);
    await Promise.resolve();
    now = 20;
    expect(store.purgeExpired()).toBe(1);
    expect(store.read(user, session)).toBeUndefined();
    expect(store.serializationHandleCount()).toBe(0);
  });
});
