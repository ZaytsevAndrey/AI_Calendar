import { validateProposalGroup } from './proposal-validate';
import type { ProposalContext } from './proposal';

const context: ProposalContext = {
  entityIds: ['task-report', 'task-meet'],
  pendingIds: ['pop-1'],
  pendingRevisions: { 'pop-1': 2 },
  pendingActions: { 'pop-1': 'create' },
  constraintIdsByPending: { 'pop-1': ['cst-day'] },
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

function group(overrides: Record<string, unknown> = {}) {
  return { version: '1', control: 'none', proposals: [proposal()], patches: [], ...overrides };
}

describe('proposal group validation', () => {
  it('accepts a create and a dependent update without an entity id on the create', () => {
    const result = validateProposalGroup(group({
      previewBoundary: 'extend',
      proposals: [
        proposal(),
        proposal({
          localRef: 'b',
          action: 'update',
          target: { kind: 'entity', entityId: 'task-report' },
          scheduling: 'scheduled',
          dependsOn: [{ localRef: 'a' }],
          constraints: [{ localRef: 'c1', kind: 'duration', minutes: 45 }],
        }),
      ],
    }), context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.group.proposals[0].target).toEqual({ kind: 'new' });
      expect(result.group.proposals[1].dependsOn).toEqual([{ localRef: 'a' }]);
    }
  });

  it('rejects a duplicate localRef', () => {
    const result = validateProposalGroup(group({ proposals: [proposal(), proposal({ source: { text: 'again' } })] }), context);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((error) => error.code === 'duplicate_local_ref')).toBe(true);
  });

  it('rejects a missing dependency', () => {
    const result = validateProposalGroup(group({
      proposals: [proposal({ dependsOn: [{ localRef: 'missing' }] })],
    }), context);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((error) => error.code === 'missing_dependency')).toBe(true);
  });

  it('rejects a dependency cycle', () => {
    const result = validateProposalGroup(group({
      proposals: [
        proposal({ dependsOn: [{ localRef: 'b' }] }),
        proposal({ localRef: 'b', action: 'update', target: { kind: 'entity', entityId: 'task-report' }, dependsOn: [{ localRef: 'a' }] }),
      ],
    }), context);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((error) => error.code === 'dependency_cycle')).toBe(true);
  });

  it('rejects an entity id that was not authorized', () => {
    const result = validateProposalGroup(group({
      proposals: [proposal({ action: 'update', target: { kind: 'entity', entityId: 'task-forged' } })],
    }), context);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((error) => error.code === 'unauthorized_entity')).toBe(true);
  });

  it('rejects a create aimed at an existing entity', () => {
    const result = validateProposalGroup(group({
      proposals: [proposal({ target: { kind: 'entity', entityId: 'task-report' } })],
    }), context);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((error) => error.code === 'unsupported_combination')).toBe(true);
  });

  it('rejects a proposal that carries a pending id as its own identity', () => {
    const result = validateProposalGroup(group({
      proposals: [proposal({ pendingId: 'pop-1' })],
    }), context);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((error) => error.code === 'untrusted_identity')).toBe(true);
  });

  it('rejects a patch with a bad shape and a patch whose revision is stale', () => {
    const malformed = validateProposalGroup(group({
      control: 'none',
      proposals: [],
      patches: [{ pendingId: 'pop-1', baseRevision: 2, fields: [{ op: 'replace' }], constraints: [] }],
    }), context);
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.errors.some((error) => error.code === 'invalid_patch')).toBe(true);
    const stale = validateProposalGroup(group({
      proposals: [],
      patches: [{ pendingId: 'pop-1', baseRevision: 1, fields: [{ op: 'replace', field: 'title', value: 'Planning' }], constraints: [] }],
    }), context);
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.errors.some((error) => error.code === 'invalid_revision')).toBe(true);
  });

  it('rejects two title values in one patch group', () => {
    const result = validateProposalGroup(group({
      proposals: [],
      patches: [{
        pendingId: 'pop-1',
        baseRevision: 2,
        fields: [
          { op: 'replace', field: 'title', value: 'Planning' },
          { op: 'replace', field: 'title', value: 'Review' },
        ],
        constraints: [],
      }],
    }), context);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((error) => error.code === 'conflicting_patch')).toBe(true);
  });

  it('rejects a clock that sits outside the model interval', () => {
    const result = validateProposalGroup(group({
      proposals: [proposal({
        scheduling: 'scheduled',
        constraints: [
          { localRef: 'c1', kind: 'clock', value: '09:00', role: 'start' },
          { localRef: 'c2', kind: 'interval', startHm: '17:00', endHm: '22:59' },
        ],
      })],
    }), context);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((error) => error.code === 'contradictory_constraints')).toBe(true);
  });

  it('keeps a clock that sits inside the model interval', () => {
    const result = validateProposalGroup(group({
      proposals: [proposal({
        scheduling: 'scheduled',
        constraints: [
          { localRef: 'c1', kind: 'clock', value: '19:00', role: 'start' },
          { localRef: 'c2', kind: 'interval', startHm: '17:00', endHm: '22:59' },
        ],
      })],
    }), context);
    expect(result.ok).toBe(true);
  });

  it('rejects confirm combined with a mutation', () => {
    const result = validateProposalGroup(group({ control: 'confirm' }), context);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((error) => error.code === 'contradictory_group')).toBe(true);
  });

  it('accepts a confirm with no mutations', () => {
    const result = validateProposalGroup({
      version: '1',
      control: 'confirm',
      proposals: [],
      patches: [],
    }, context);
    expect(result.ok).toBe(true);
  });

  it('rejects a model-copied preview execution id', () => {
    const result = validateProposalGroup({
      version: '1',
      control: 'confirm',
      previewExecutionId: 'exec-1',
      proposals: [],
      patches: [],
    }, context);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((error) => error.code === 'untrusted_identity')).toBe(true);
  });
});
