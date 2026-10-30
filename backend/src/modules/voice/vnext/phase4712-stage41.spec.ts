/**
 * Stage 4.1: functional parity and safety recovery on the structured path.
 * Mocked interpreter output and deterministic reads only. No live model or provider call.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { DayPlanProposal, PlanDraft } from '../voice-agent.types';
import type { PlanDraftContext } from '../voice-agent.plan-draft';
import { createSession, intentKey } from './session/session';
import { runVNextTurn, type InterpretOutput, type TurnInput, type VNextInterpreter } from './pipeline';
import type { ProposalGroup, SemanticOperationProposal } from './contracts/proposal';
import type { SemanticEnvelopeV1, SemanticOperationV1 } from './contracts/types';
import { envelopeToProposalGroup } from './contracts/envelope-to-proposal';
import type { EntityRecord } from './reference/reference-resolver';
import * as corrections from './session/corrections';
import * as repair from './repair/repair';
import * as temporalResolver from './temporal/temporal-resolver';
import * as referenceResolver from './reference/reference-resolver';
import * as legacyAdapter from './adapter/adapter';
import * as legacyScope from './adapter/scope';
import * as clarification from './session/clarification';
import * as utterancePolicy from './session/utterance-policy';
import * as graphNormalize from './graph/normalize';

const USER = 'user-1';
const NOW = '2026-10-18T06:00:00.000Z'; // Sunday 09:00 in Kyiv
const TZ = 'Europe/Kyiv';

type Session = ReturnType<typeof createSession>;

function entity(overrides: Partial<EntityRecord> = {}): EntityRecord {
  return {
    id: 'task-report',
    userId: USER,
    type: 'task',
    name: 'Report',
    status: 'open',
    revision: 3,
    calendarId: 'cal',
    scheduledStart: '2026-10-21T08:00:00.000Z',
    scheduledEnd: '2026-10-21T09:00:00.000Z',
    googleEventId: 'g-report',
    writable: true,
    ...overrides,
  };
}

function fresh(row: EntityRecord): Awaited<ReturnType<NonNullable<TurnInput['readEntity']>>> {
  return {
    exists: true,
    revision: row.revision,
    calendarId: row.calendarId ?? null,
    writable: row.writable !== false,
    googleEventId: row.googleEventId ?? null,
    status: row.status,
    userId: row.userId,
  };
}

function proposal(overrides: Partial<SemanticOperationProposal> = {}): SemanticOperationProposal {
  return {
    localRef: 'a',
    action: 'update',
    entityType: 'task',
    target: { kind: 'entity', entityId: 'task-report' },
    scheduling: 'unscheduled',
    changes: { title: 'Quarterly' },
    constraints: [],
    dependsOn: [],
    known: ['title'],
    missing: [],
    source: { text: 'rename report' },
    ...overrides,
  };
}

function group(proposals: SemanticOperationProposal[], extra: Partial<ProposalGroup> = {}): ProposalGroup {
  return { version: '1', control: 'none', proposals, patches: [], ...extra };
}

const CONFIRM: ProposalGroup = { version: '1', control: 'confirm', proposals: [], patches: [] };

function interpreter(output: ProposalGroup | SemanticEnvelopeV1): VNextInterpreter {
  const isGroup = 'control' in output && 'proposals' in output;
  return {
    arm: 'A',
    async interpret(): Promise<InterpretOutput> {
      return {
        ok: true,
        specialist: 'test',
        promptHash: 'stage41',
        usage: { calls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 },
        reads: [],
        ...(isGroup ? { group: output as ProposalGroup } : { envelope: output as SemanticEnvelopeV1 }),
      };
    },
  };
}

function base(session: Session, entities: EntityRecord[] = [entity()], extra: Partial<TurnInput> = {}): TurnInput {
  return {
    transcript: 'turn',
    userId: USER,
    session,
    nowIso: NOW,
    timeZone: TZ,
    wakeHm: '08:00',
    sleepHm: '23:00',
    defaultDurationMinutes: 30,
    defaultReminderTime: '09:00',
    language: 'en',
    entities,
    arm: 'A',
    ...extra,
  };
}

function claimOf(session: Session): { executionId: string; previewRevision: number } {
  return {
    executionId: session.structured!.preview!.executionId,
    previewRevision: session.structured!.preview!.previewRevision,
  };
}

function operation(partial: Partial<SemanticOperationV1> & Pick<SemanticOperationV1, 'opId' | 'action' | 'target'>): SemanticOperationV1 {
  return { changes: {}, constraints: [], dependsOn: [], source: { text: partial.opId }, ...partial };
}

function operations(list: SemanticOperationV1[]): SemanticEnvelopeV1 {
  return { version: '1', kind: 'operations', operations: list };
}

function commandOf(result: Awaited<ReturnType<typeof runVNextTurn>>, index = 0): Record<string, unknown> {
  const intent = result.response.intents[index];
  if (!intent || intent.type !== 'command') throw new Error('expected a command intent');
  return intent.command as Record<string, unknown>;
}

describe('stage 4.1 confirmation freshness', () => {
  async function previewThenConfirm(input: {
    previewEntities?: EntityRecord[];
    confirmEntities?: EntityRecord[];
    readEntity?: TurnInput['readEntity'];
  }) {
    const session = createSession(USER, 'fresh');
    const preview = await runVNextTurn(base(session, input.previewEntities ?? [entity()]), interpreter(group([proposal()])));
    expect(preview.response.outcome).toBe('confirm');
    const claim = claimOf(session);
    const confirmed = await runVNextTurn(
      base(session, input.confirmEntities ?? input.previewEntities ?? [entity()], { transcript: 'yes', confirmation: claim, readEntity: input.readEntity }),
      interpreter(CONFIRM),
    );
    return { session, claim, confirmed };
  }

  it('blocks the confirm when the task was completed after preview', async () => {
    const { confirmed, session } = await previewThenConfirm({
      readEntity: async () => fresh(entity({ status: 'completed' })),
    });
    expect(confirmed.response.outcome).toBe('clarify');
    expect(confirmed.blocked).toContain('stale_ineligible');
    expect(confirmed.response.intents).toEqual([]);
    expect(session.structured?.preview?.executionState).toBe('superseded');
  });

  it('fails closed when the fresh read cannot vouch for the owner', async () => {
    const { confirmed } = await previewThenConfirm({
      readEntity: async () => ({ ...fresh(entity()), userId: undefined }),
    });
    expect(confirmed.blocked).toContain('revalidation_incomplete');
    expect(confirmed.response.intents).toEqual([]);
  });

  it('uses the confirm turn catalog when no reader is wired, and fails closed when the row is gone', async () => {
    const gone = await previewThenConfirm({ confirmEntities: [] });
    expect(gone.confirmed.blocked).toContain('revalidation_incomplete');
    expect(gone.confirmed.response.intents).toEqual([]);

    const changed = await previewThenConfirm({ confirmEntities: [entity({ revision: 4 })] });
    expect(changed.confirmed.blocked).toContain('stale_preview');

    const unchanged = await previewThenConfirm({});
    expect(unchanged.confirmed.response.outcome).toBe('act');
    expect(unchanged.confirmed.response.intents).toHaveLength(1);
  });

  it('a stale confirm that fails revalidation does not retire the newer preview from a concurrent correction', async () => {
    const session = createSession(USER, 'race-stale');
    const entities = [entity()];
    await runVNextTurn(base(session, entities), interpreter(group([proposal()])));
    const claim = claimOf(session);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const confirming = runVNextTurn(base(session, entities, {
      transcript: 'yes',
      confirmation: claim,
      readEntity: async () => {
        await gate;
        return fresh(entity({ revision: 4 }));
      },
    }), interpreter(CONFIRM));
    const operation0 = session.structured!.operations[0];
    const corrected = await runVNextTurn(base(session, entities, { transcript: 'call it Review' }), interpreter(group([], {
      patches: [{ pendingId: operation0.pendingId, baseRevision: operation0.revision, fields: [{ op: 'replace', field: 'title', value: 'Review' }], constraints: [] }],
    })));
    expect(corrected.response.outcome).toBe('confirm');
    const newer = claimOf(session);
    release();
    const result = await confirming;
    expect(result.response.outcome).toBe('clarify');
    expect(result.blocked).toEqual(expect.arrayContaining(['stale_preview', 'version_conflict']));
    expect(result.response.intents).toEqual([]);
    expect(session.structured?.preview?.executionState).toBe('open');
    expect(claimOf(session)).toEqual(newer);
    expect(session.pendingIntents).toHaveLength(1);
  });

  it('does not resend a write whose earlier outcome is unknown, and does resend a definitive failure', async () => {
    const unknown = createSession(USER, 'unknown');
    const preview = await runVNextTurn(base(unknown), interpreter(group([proposal()])));
    unknown.applyLedger = [{ key: intentKey(preview.response.intents[0]), status: 'unknown', error: 'interrupted' }];
    const held = await runVNextTurn(base(unknown, [entity()], { transcript: 'yes', confirmation: claimOf(unknown) }), interpreter(CONFIRM));
    expect(held.response.outcome).toBe('answer');
    expect(held.blocked).toContain('unknown_apply');
    expect(held.response.intents).toEqual([]);
    expect(unknown.structured?.preview?.executionState).toBe('open');

    const failed = createSession(USER, 'failed');
    const again = await runVNextTurn(base(failed), interpreter(group([proposal()])));
    failed.applyLedger = [{ key: intentKey(again.response.intents[0]), status: 'failed', error: 'provider_unavailable' }];
    const reissued = await runVNextTurn(base(failed, [entity()], { transcript: 'yes', confirmation: claimOf(failed) }), interpreter(CONFIRM));
    expect(reissued.response.outcome).toBe('act');
    expect(reissued.serverWrites).toBe(0);
  });

  it('keys the apply ledger per task, so two same-title deletes stay distinct', async () => {
    const session = createSession(USER, 'ledger');
    const rows = [entity({ id: 'm1', name: 'Sync' }), entity({ id: 'm2', name: 'Sync' })];
    await runVNextTurn(base(session, rows), interpreter(group([
      proposal({ localRef: 'a', action: 'delete', target: { kind: 'entity', entityId: 'm1' }, changes: { title: 'Sync' } }),
      proposal({ localRef: 'b', action: 'delete', target: { kind: 'entity', entityId: 'm2' }, changes: { title: 'Sync' } }),
    ])));
    const confirmed = await runVNextTurn(base(session, rows, { transcript: 'yes', confirmation: claimOf(session) }), interpreter(CONFIRM));
    expect(confirmed.response.outcome).toBe('act');
    expect(new Set(session.applyLedger.map((row) => row.key)).size).toBe(2);
  });
});

describe('stage 4.1 session lifecycle after a closed preview', () => {
  const create = (title: string) => group([proposal({ action: 'create', target: { kind: 'new' }, changes: { title } })]);
  const titles = (result: Awaited<ReturnType<typeof runVNextTurn>>) => result.response.intents.map((intent) => intent.summary);

  it('previews the next request after a confirm, without carrying the dispatched operation', async () => {
    const session = createSession(USER, 'after-confirm');
    await runVNextTurn(base(session, []), interpreter(create('Tea')));
    const first = claimOf(session);
    await runVNextTurn(base(session, [], { confirmation: first }), interpreter(CONFIRM));
    const next = await runVNextTurn(base(session, []), interpreter(create('Bread')));
    expect(next.response.outcome).toBe('confirm');
    expect(titles(next)).toEqual(['Bread']);

    const replay = await runVNextTurn(base(session, [], { confirmation: first }), interpreter(CONFIRM));
    expect(replay.response.outcome).toBe('answer');
    expect(replay.blocked).toContain('duplicate_confirm');
    expect(replay.response.intents).toEqual([]);
    expect(session.structured?.preview?.executionState).toBe('open');
  });

  it('retires the preview on a spoken cancel without a claim, so it cannot return', async () => {
    const session = createSession(USER, 'bare-cancel');
    await runVNextTurn(base(session, []), interpreter(create('Tea')));
    const canceledClaim = claimOf(session);
    const canceled = await runVNextTurn(base(session, []), interpreter({ version: '1', control: 'cancel', proposals: [], patches: [] }));
    expect(canceled.response.outcome).toBe('answer');
    expect(session.structured?.preview?.executionState).toBe('superseded');

    const late = await runVNextTurn(base(session, [], { confirmation: canceledClaim }), interpreter(CONFIRM));
    expect(late.response.outcome).not.toBe('act');
    expect(late.response.intents).toEqual([]);

    const next = await runVNextTurn(base(session, []), interpreter(create('Bread')));
    expect(titles(next)).toEqual(['Bread']);
  });

  it('does not cancel a newer preview with a claim for an older one', async () => {
    const session = createSession(USER, 'stale-cancel');
    await runVNextTurn(base(session, []), interpreter(create('Tea')));
    const old = claimOf(session);
    const op = session.structured!.operations[0];
    await runVNextTurn(base(session, []), interpreter(group([], {
      patches: [{ pendingId: op.pendingId, baseRevision: op.revision, fields: [{ op: 'replace', field: 'title', value: 'Green tea' }], constraints: [] }],
    })));
    const newer = claimOf(session);
    const result = await runVNextTurn(base(session, [], { confirmation: old }), interpreter({ version: '1', control: 'cancel', proposals: [], patches: [] }));
    expect(result.response.outcome).toBe('clarify');
    expect(claimOf(session)).toEqual(newer);
    expect(session.structured?.preview?.executionState).toBe('open');
  });
});

describe('stage 4.1 preview eligibility', () => {
  it('does not preview a write to a completed task', async () => {
    const session = createSession(USER, 'done');
    const result = await runVNextTurn(base(session, [entity({ status: 'completed' })]), interpreter(group([proposal({ action: 'complete', changes: {} })])));
    expect(result.response.outcome).toBe('clarify');
    expect(result.blocked).toContain('ineligible');
    expect(result.response.intents).toEqual([]);
    expect(session.structured?.preview ?? null).toBeNull();
  });

  it('does not delete a task on a calendar other than the one named', async () => {
    const session = createSession(USER, 'calendar');
    const result = await runVNextTurn(base(session), interpreter(group([proposal({ action: 'delete', changes: {}, calendarId: 'work' })])));
    expect(result.blocked).toContain('wrong_calendar');
    expect(result.response.intents).toEqual([]);
  });

  it('asks for a series scope instead of writing to a recurring task', async () => {
    const session = createSession(USER, 'series');
    const result = await runVNextTurn(base(session, [entity({ recurring: true })]), interpreter(group([proposal({ action: 'delete', changes: {} })])));
    expect(result.response.outcome).toBe('clarify');
    expect(result.blocked).toContain('missing_series_scope');
    expect(result.response.intents).toEqual([]);
  });

  it('does not widen an occurrence scope to the series when the occurrence is not named', async () => {
    const session = createSession(USER, 'series-v1');
    const result = await runVNextTurn(base(session, [entity({ recurring: true })]), interpreter(operations([
      operation({ opId: 'op-1', action: 'delete', target: { kind: 'existing', proposedId: 'task-report' }, seriesScope: 'occurrence' }),
    ])));
    expect(result.response.outcome).toBe('clarify');
    expect(result.blocked).toContain('missing_occurrence');
    expect(result.response.intents).toEqual([]);
  });
});

describe('stage 4.1 projection carries a change or rejects it', () => {
  async function preview(proposals: SemanticOperationProposal[], entities: EntityRecord[] = [entity()]) {
    return runVNextTurn(base(createSession(USER, 'project'), entities), interpreter(group(proposals)));
  }

  it('carries a new date and clock on an update', async () => {
    const result = await preview([proposal({
      changes: {},
      scheduling: 'scheduled',
      constraints: [{ kind: 'date', value: '2026-10-21', localRef: 'd' }, { kind: 'clock', value: '15:00', role: 'start', localRef: 'c' }],
    })]);
    expect(result.response.outcome).toBe('confirm');
    expect(commandOf(result).patch).toEqual({ scheduledStartTime: '2026-10-21T12:00:00.000Z' });
  });

  it('rejects an update that would change nothing', async () => {
    const result = await preview([proposal({ changes: {} })]);
    expect(result.blocked).toContain('empty_patch');
    expect(result.response.intents).toEqual([]);
  });

  it('rejects a constraint that a delete or a move cannot carry', async () => {
    const del = await preview([proposal({ action: 'delete', changes: {}, constraints: [{ kind: 'date', value: '2026-10-21', localRef: 'd' }] })]);
    expect(del.blocked).toContain('unrepresented_constraint');
    const move = await preview([proposal({
      action: 'move',
      changes: { notes: 'bring slides' },
      scheduling: 'scheduled',
      constraints: [{ kind: 'date', value: '2026-10-22', localRef: 'd' }, { kind: 'clock', value: '10:00', role: 'start', localRef: 'c' }],
    })]);
    expect(move.blocked).toContain('unrepresented_constraint');
    expect(move.response.intents).toEqual([]);
  });

  it('rejects unresolved time on an update instead of dropping it', async () => {
    const labelled = await preview([proposal({ changes: {}, constraints: [{ kind: 'unresolved', label: 'evening', localRef: 'u' }] })]);
    expect(labelled.blocked).toContain('unmapped_time');
    expect(labelled.preservedLabels).toEqual(['evening']);
    expect(labelled.response.intents).toEqual([]);
    const unlabelled = await preview([proposal({ changes: { title: 'x' }, constraints: [{ kind: 'unresolved', localRef: 'u' }] })]);
    expect(unlabelled.blocked).toContain('unrepresented_constraint');
    expect(unlabelled.response.intents).toEqual([]);
  });

  it('keeps a time-of-day label visible on an unplaced create and invents no clock', async () => {
    const result = await preview([proposal({
      action: 'create',
      target: { kind: 'new' },
      changes: { title: 'Walk' },
      constraints: [{ kind: 'unresolved', label: 'evening', localRef: 'u' }],
    })]);
    expect(result.response.outcome).toBe('confirm');
    expect(result.preservedLabels).toEqual(['evening']);
    const intent = result.response.intents[0];
    expect(intent.type === 'create' ? intent.task.isUnscheduled : null).toBe(true);
    expect(JSON.stringify(intent)).not.toContain('scheduledStartTime');
    expect(intent.summary).toContain('evening');
  });

  it('previews a reminder with an explicit clock, and leaves the clock null for the user default', async () => {
    const explicit = await preview([proposal({
      action: 'remind',
      entityType: 'reminder',
      target: { kind: 'new' },
      changes: { reminder: { op: 'create', name: 'call', dueYmd: '2026-10-19', notificationTime: '10:30' } },
    })], []);
    expect(explicit.response.outcome).toBe('confirm');
    expect(commandOf(explicit)).toMatchObject({ kind: 'remind_create', name: 'call', dueYmd: '2026-10-19', notificationTime: '10:30' });

    const defaulted = await preview([proposal({
      action: 'remind',
      entityType: 'reminder',
      target: { kind: 'new' },
      changes: { reminder: { op: 'create', name: 'call', dueYmd: '2026-10-19' } },
    })], []);
    expect(commandOf(defaulted).notificationTime).toBeNull();

    const daily = await preview([proposal({
      action: 'remind',
      entityType: 'reminder',
      target: { kind: 'new' },
      changes: { reminder: { op: 'create', name: 'pills', dueYmd: '2026-10-19', recurrencePattern: 'DAILY' } },
    })], []);
    expect(commandOf(daily)).toMatchObject({ kind: 'remind_create', recurrencePattern: 'DAILY' });

    const undated = await preview([proposal({
      action: 'remind',
      entityType: 'reminder',
      target: { kind: 'new' },
      changes: { reminder: { op: 'create', name: 'call' } },
    })], []);
    expect(undated.blocked).toContain('missing_day');
  });

  it('does not fold a reminder into a pending create, where it would be lost', async () => {
    const session = createSession(USER, 'fold');
    await runVNextTurn(base(session, []), interpreter(group([proposal({ action: 'create', target: { kind: 'new' }, changes: { title: 'Report' } })])));
    const pendingId = session.structured!.operations[0].pendingId;
    const before = claimOf(session);
    const result = await runVNextTurn(base(session, []), interpreter(group([proposal({
      action: 'remind',
      entityType: 'reminder',
      target: { kind: 'pending', pendingId },
      changes: { reminder: { op: 'create', name: 'Report', dueYmd: '2026-10-19' } },
    })])));
    expect(result.blocked).toContain('unsupported_draft_action');
    expect(claimOf(session)).toEqual(before);
  });

  it('does not preview a skip the client cannot execute without an occurrence', async () => {
    const result = await preview([proposal({ action: 'skip', changes: {} })]);
    expect(result.blocked).toContain('unsupported_action');
    expect(result.response.intents).toEqual([]);
  });

  it('applies the documented weekday contract and refuses a weekday without the model choosing which', async () => {
    const at = (which?: 'this' | 'next') => preview([proposal({
      action: 'create',
      target: { kind: 'new' },
      changes: { title: 'Gym' },
      scheduling: 'scheduled',
      constraints: [
        { kind: 'weekday', weekday: 0, ...(which ? { which } : {}), localRef: 'w' },
        { kind: 'clock', value: '10:00', role: 'start', localRef: 'c' },
      ],
    })], []);
    const next = await at('next');
    expect(JSON.stringify(next.response.intents)).toContain('2026-10-25T08:00:00.000Z');
    const thisWeek = await at('this');
    expect(JSON.stringify(thisWeek.response.intents)).toContain('2026-10-18T07:00:00.000Z');
    const missing = await at(undefined);
    expect(missing.blocked).toContain('ambiguous_weekday');
  });
});

describe('stage 4.1 bulk scope', () => {
  const MEMBERS = [
    entity({ id: 'm1', name: 'Planning sync', googleEventId: null }),
    entity({ id: 'm2', name: 'Standup', googleEventId: null }),
  ];
  const bulkComplete = operations([operation({
    opId: 'op-1',
    action: 'complete',
    target: { kind: 'existing', description: 'work meetings' },
    scope: 'all',
  })]);

  it('completes every member of a complete trusted search, whatever the titles say', async () => {
    const session = createSession(USER, 'bulk-complete');
    const result = await runVNextTurn(base(session, MEMBERS, { searchReceipt: { complete: true, ids: ['m1', 'm2'] } }), interpreter(bulkComplete));
    expect(result.response.outcome).toBe('confirm');
    expect(result.response.intents.map((intent) => (intent.type === 'command' ? intent.command.taskId : null))).toEqual(['m1', 'm2']);
    expect([...session.previewTargetIds].sort()).toEqual(['m1', 'm2']);
  });

  it('refuses a search set that includes a member the user may not write', async () => {
    const result = await runVNextTurn(
      base(createSession(USER, 'bulk-done'), [...MEMBERS, entity({ id: 'm3', status: 'completed' })], { searchReceipt: { complete: true, ids: ['m1', 'm2', 'm3'] } }),
      interpreter(bulkComplete),
    );
    expect(result.blocked).toContain('scope_mismatch');
    expect(result.response.intents).toEqual([]);
  });

  it('updates several explicitly named tasks in one preview', async () => {
    const result = await runVNextTurn(base(createSession(USER, 'bulk-update'), MEMBERS), interpreter(group([
      proposal({ localRef: 'a', target: { kind: 'entity', entityId: 'm1' }, changes: { priority: 'high' } }),
      proposal({ localRef: 'b', target: { kind: 'entity', entityId: 'm2' }, changes: { priority: 'high' } }),
    ])));
    expect(result.response.outcome).toBe('confirm');
    expect(result.response.intents).toHaveLength(2);
  });

  it('rejects the whole set when one id is forged, and keeps the earlier preview', async () => {
    const session = createSession(USER, 'bulk-forged');
    await runVNextTurn(base(session, MEMBERS), interpreter(group([proposal({ target: { kind: 'entity', entityId: 'm1' }, changes: { priority: 'low' } })])));
    const before = claimOf(session);
    const intentsBefore = session.pendingIntents;
    const result = await runVNextTurn(base(session, MEMBERS), interpreter(group([
      proposal({ localRef: 'a', action: 'delete', target: { kind: 'entity', entityId: 'm2' }, changes: {} }),
      proposal({ localRef: 'b', action: 'delete', target: { kind: 'entity', entityId: 'someone-elses' }, changes: {} }),
    ])));
    expect(result.response.outcome).toBe('refuse');
    expect(result.blocked).toContain('unauthorized_entity');
    expect(result.response.intents).toEqual([]);
    expect(claimOf(session)).toEqual(before);
    expect(session.pendingIntents).toBe(intentsBefore);
  });

  it('asks when the scope is ambiguous instead of choosing members', async () => {
    const result = await runVNextTurn(base(createSession(USER, 'bulk-ambiguous'), MEMBERS), interpreter(group([
      proposal({ action: 'delete', target: { kind: 'unresolved', reason: 'ambiguous' }, changes: {} }),
    ])));
    expect(result.response.outcome).toBe('clarify');
    expect(result.blocked).toContain('ambiguous');
    expect(result.response.intents).toEqual([]);
  });

  it('applies one correction to several pending operations atomically', async () => {
    const session = createSession(USER, 'bulk-patch');
    await runVNextTurn(base(session, []), interpreter(group([
      proposal({ localRef: 'a', action: 'create', target: { kind: 'new' }, changes: { title: 'Tea' } }),
      proposal({ localRef: 'b', action: 'create', target: { kind: 'new' }, changes: { title: 'Bread' } }),
    ])));
    const [first, second] = session.structured!.operations;
    const highPriority = (op: typeof first, baseRevision = op.revision) => ({
      pendingId: op.pendingId,
      baseRevision,
      fields: [{ op: 'replace' as const, field: 'priority' as const, value: 'high' }],
      constraints: [],
    });
    const before = session.pendingIntents;
    const rejected = await runVNextTurn(base(session, []), interpreter(group([], { patches: [highPriority(first), highPriority(second, second.revision + 5)] })));
    expect(rejected.response.outcome).not.toBe('confirm');
    expect(session.pendingIntents).toBe(before);

    const applied = await runVNextTurn(base(session, []), interpreter(group([], { patches: [highPriority(first), highPriority(second)] })));
    expect(applied.response.outcome).toBe('confirm');
    expect(applied.response.intents.map((intent) => (intent.type === 'create' ? intent.task.priority : null))).toEqual(['high', 'high']);
  });
});

describe('stage 4.1 structured day plan', () => {
  const DAY = '2026-10-19';
  const WRITE = entity({ id: 'task-write', name: 'Write', revision: 2, scheduledStart: null, scheduledEnd: null, googleEventId: null });
  const CONTEXT: PlanDraftContext = {
    tasks: [{
      id: 'task-write',
      userId: USER,
      name: 'Write',
      status: 'pending',
      isUnscheduled: true,
      isRecurring: false,
      estimatedTimeInMinutes: 60,
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
    } as unknown as PlanDraftContext['tasks'][number]],
    // An existing event on the agenda: 10:00-11:00 Kyiv.
    slots: [{
      id: 'slot-meet',
      taskId: 'task-meet',
      scheduledStartTime: new Date('2026-10-19T07:00:00.000Z'),
      scheduledEndTime: new Date('2026-10-19T08:00:00.000Z'),
      googleEventId: null,
    } as unknown as PlanDraftContext['slots'][number]],
    timeZone: TZ,
    nowIso: NOW,
    defaultDurationMinutes: 30,
  };
  const dayPlan = (phase: 'start' | 'apply'): SemanticEnvelopeV1 => ({
    version: '1',
    kind: 'day_plan',
    operations: [],
    dayPlan: phase === 'start' ? { phase, day: DAY } : { phase },
  });
  const planner = (start: string, end: string, unplaced = false) => async (_userId: string, draft: PlanDraft): Promise<DayPlanProposal> => ({
    day: draft.day,
    stage: 'review',
    revision: draft.revision,
    items: unplaced ? [] : draft.items.map((item) => ({
      itemId: item.id,
      taskId: item.taskId,
      source: item.source,
      name: item.name,
      start,
      end,
      durationMinutes: item.durationMinutes,
    })),
    unplaced: unplaced ? draft.items.map((item) => ({ itemId: item.id, name: item.name, reason: 'no_room' as const })) : [],
    changedItemIds: draft.items.map((item) => item.id),
  });

  const include: SemanticEnvelopeV1 = {
    version: '1',
    kind: 'day_plan',
    operations: [],
    dayPlan: { phase: 'edit', edits: [{ op: 'include_task', taskId: 'task-write' }] },
  };

  async function plan(proposeDay: TurnInput['proposeDay'], entities: EntityRecord[] = [WRITE]) {
    const session = createSession(USER, 'plan');
    const started = await runVNextTurn(base(session, entities, { planContext: CONTEXT }), interpreter(dayPlan('start')));
    expect(started.response.outcome).toBe('clarify');
    expect(started.response.intents).toEqual([]);
    // The Later task joins only when the user agrees to it.
    const included = await runVNextTurn(base(session, entities, { planContext: CONTEXT }), interpreter(include));
    expect(included.response.assistantMessage).toContain('Write');
    const applied = await runVNextTurn(base(session, entities, { planContext: CONTEXT, proposeDay }), interpreter(dayPlan('apply')));
    return { session, applied };
  }

  it('does not start a plan without the agenda read', async () => {
    const result = await runVNextTurn(base(createSession(USER, 'no-agenda')), interpreter(dayPlan('start')));
    expect(result.blocked).toContain('day_context_missing');
    expect(result.response.intents).toEqual([]);
  });

  it('does not seed Later tasks into a new plan', async () => {
    const session = createSession(USER, 'no-seed');
    const started = await runVNextTurn(base(session, [WRITE], { planContext: CONTEXT }), interpreter(dayPlan('start')));
    expect(session.planDraft?.items).toEqual([]);
    expect(started.response.plan?.items).toEqual([]);
  });

  it('drops a second add of an activity already in the plan', async () => {
    const session = createSession(USER, 'dup');
    await runVNextTurn(base(session, [WRITE], { planContext: CONTEXT }), interpreter(dayPlan('start')));
    const add = (name: string): SemanticEnvelopeV1 => ({
      version: '1',
      kind: 'day_plan',
      operations: [],
      dayPlan: { phase: 'edit', edits: [{ op: 'add_task', name, durationMinutes: null, preferredHm: null, earliestHm: null, deadlineHm: null }] },
    });
    await runVNextTurn(base(session, [WRITE], { planContext: CONTEXT }), interpreter(add('Walk')));
    const again = await runVNextTurn(base(session, [WRITE], { planContext: CONTEXT }), interpreter(add('walk')));
    expect(session.planDraft?.items.map((item) => item.name)).toEqual(['Walk']);
    expect(again.blocked).toContain('duplicate_item');
  });

  it('seats an authorized unscheduled task in a real gap and dispatches only on an explicit claim', async () => {
    const { session, applied } = await plan(planner('2026-10-19T08:00:00.000Z', '2026-10-19T09:00:00.000Z'));
    expect(applied.response.outcome).toBe('confirm');
    expect(applied.serverWrites).toBe(0);
    expect(commandOf(applied)).toMatchObject({ kind: 'window', taskId: 'task-write', scheduledStartTime: '2026-10-19T08:00:00.000Z' });
    expect(session.structured?.entityFingerprints['task-write']).toMatchObject({ revision: 2, userId: USER, status: 'open' });

    const bare = await runVNextTurn(base(session, [WRITE], { transcript: 'yes' }), interpreter(CONFIRM));
    expect(bare.blocked).toContain('missing_confirmation_claim');
    expect(bare.response.intents).toEqual([]);

    const confirmed = await runVNextTurn(base(session, [WRITE], {
      transcript: 'yes',
      confirmation: claimOf(session),
      readEntity: async () => fresh(WRITE),
    }), interpreter(CONFIRM));
    expect(confirmed.response.outcome).toBe('act');
    expect(confirmed.response.intents).toHaveLength(1);
    expect(confirmed.serverWrites).toBe(0);
  });

  it('refuses a placement over an existing event', async () => {
    const { session, applied } = await plan(planner('2026-10-19T07:30:00.000Z', '2026-10-19T08:30:00.000Z'));
    expect(applied.response.outcome).toBe('refuse');
    expect(applied.blocked).toContain('proposal_overlap');
    expect(session.structured?.preview?.executionState ?? null).not.toBe('open');
  });

  it('refuses a placement that changes the task duration', async () => {
    const { applied } = await plan(planner('2026-10-19T08:00:00.000Z', '2026-10-19T08:30:00.000Z'));
    expect(applied.blocked).toContain('proposal_duration');
    expect(applied.response.intents).toEqual([]);
  });

  it('answers without a preview when nothing fits', async () => {
    const { session, applied } = await plan(planner('', '', true));
    expect(applied.response.outcome).toBe('answer');
    expect(applied.blocked).toContain('no_room');
    expect(applied.response.intents).toEqual([]);
    expect(session.structured?.preview?.executionState ?? null).not.toBe('open');
  });

  it('refuses a plan task the authorized catalog does not carry', async () => {
    const { applied } = await plan(planner('2026-10-19T08:00:00.000Z', '2026-10-19T09:00:00.000Z'), []);
    expect(applied.response.outcome).toBe('refuse');
    expect(applied.blocked).toContain('unauthorized_entity');
  });

  it('blocks the confirm when the planned task changed after preview', async () => {
    const { session } = await plan(planner('2026-10-19T08:00:00.000Z', '2026-10-19T09:00:00.000Z'));
    const result = await runVNextTurn(base(session, [WRITE], {
      transcript: 'yes',
      confirmation: claimOf(session),
      readEntity: async () => fresh({ ...WRITE, revision: 3 }),
    }), interpreter(CONFIRM));
    expect(result.blocked).toContain('stale_preview');
    expect(result.response.intents).toEqual([]);
  });
});

describe('stage 4.1 V1 bridge isolation', () => {
  it('maps fields mechanically and leaves a weekday for projection', () => {
    const mapped = envelopeToProposalGroup(operations([operation({
      opId: 'op-1',
      action: 'create',
      target: { kind: 'new', localId: 'n' },
      changes: { title: 'Gym' },
      constraints: [{ kind: 'weekday', weekday: 3, which: 'next' }, { kind: 'clock', value: '18:00', role: 'start' }],
    })]), { nowIso: NOW, timeZone: TZ });
    expect(mapped?.proposals[0].constraints).toEqual([
      { kind: 'weekday', weekday: 3, which: 'next', localRef: 'op-1-c0' },
      { kind: 'clock', value: '18:00', role: 'start', localRef: 'op-1-c1' },
    ]);
  });

  it('carries every constraint it can represent and keeps the rest as unresolved instead of dropping it', () => {
    const mapped = envelopeToProposalGroup(operations([operation({
      opId: 'op-1',
      action: 'create',
      target: { kind: 'new', localId: 'n' },
      changes: { title: 'x' },
      constraints: [
        { kind: 'recurrence', expression: 'daily' },
        { kind: 'recurrence', expression: 'daily', pattern: 'DAILY' },
        { kind: 'day_bound', edge: 'sleep', role: 'deadline' },
        { kind: 'clock', value: '18:00', role: 'deadline' },
        { kind: 'clock', value: '15:00', role: 'preferred' },
        { kind: 'all_day' },
        { kind: 'relative_time', anchor: 'now', direction: 'after', amount: 2, unit: 'hour' },
        { kind: 'relative_time', anchor: 'referenced_task', direction: 'after', amount: 1, unit: 'hour' },
        { kind: 'time_of_day', label: 'evening', bound: 'at' },
        { kind: 'time_of_day', label: 'evening', bound: 'until' },
      ],
    })]));
    expect(mapped?.proposals[0].constraints.map(({ localRef, ...rest }) => (void localRef, rest))).toEqual([
      { kind: 'unresolved' },
      { kind: 'recurrence', pattern: 'DAILY' },
      { kind: 'day_bound', edge: 'sleep', role: 'deadline' },
      { kind: 'clock', value: '18:00', role: 'deadline' },
      // Scheduling refactor: a preferred clock is carried (flexible preferred start), not unresolved.
      { kind: 'clock', value: '15:00', role: 'preferred' },
      { kind: 'all_day' },
      { kind: 'relative', direction: 'after', amount: 2, unit: 'hour' },
      { kind: 'unresolved' },
      { kind: 'unresolved', label: 'evening' },
      { kind: 'unresolved' },
    ]);
  });

  it('lets the action of a same-utterance edit decide the fold, and never turns it into the create', async () => {
    const create = operation({ opId: 'op-1', action: 'create', target: { kind: 'new', localId: 'n' }, changes: { title: 'Report' } });
    const on = (action: SemanticOperationV1['action'], extra: Partial<SemanticOperationV1> = {}) =>
      operation({ opId: 'op-2', action, target: { kind: 'operation_result', opId: 'op-1' }, dependsOn: ['op-1'], ...extra });

    const session = createSession(USER, 'fold-delete');
    await runVNextTurn(base(session, []), interpreter(group([proposal({ action: 'create', target: { kind: 'new' }, changes: { title: 'Earlier' } })])));
    const before = claimOf(session);
    const deleted = await runVNextTurn(base(session, []), interpreter(operations([create, on('delete')])));
    expect(deleted.response.outcome).toBe('answer');
    expect(deleted.response.intents).toEqual([]);
    expect(claimOf(session)).toEqual(before);

    const completed = envelopeToProposalGroup(operations([create, on('complete')]));
    expect(completed?.proposals).toHaveLength(1);
    expect(completed?.proposals[0]).toMatchObject({ action: 'create', changes: { title: 'Report', status: 'completed' } });

    const renamed = envelopeToProposalGroup(operations([create, on('update', { changes: { title: 'Q4 report' } })]));
    expect(renamed?.proposals[0].changes.title).toBe('Q4 report');

    // A reminder holds no task id, so a reminder about the new task is its own create, not a fold.
    const reminded = envelopeToProposalGroup(operations([create, on('remind', { changes: { reminder: { op: 'create', dueYmd: '2026-10-19' } } })]));
    expect(reminded?.proposals.map((row) => [row.action, row.target.kind])).toEqual([['create', 'new'], ['remind', 'new']]);
    expect(reminded?.proposals[1].changes.reminder).toMatchObject({ op: 'create', name: 'Report' });
    expect(envelopeToProposalGroup(operations([create, on('delete'), operation({ opId: 'op-3', action: 'update', target: { kind: 'operation_result', opId: 'op-1' }, changes: { title: 'y' } })]))).toBeNull();
  });

  it('carries a series scope and an occurrence date instead of dropping them', () => {
    const mapped = envelopeToProposalGroup(operations([operation({
      opId: 'op-1',
      action: 'delete',
      target: { kind: 'existing', proposedId: 'x' },
      seriesScope: 'from_day',
      occurrence: '2026-10-21',
    })]));
    expect(mapped?.proposals[0]).toMatchObject({ seriesScope: 'from_day', occurrenceDate: '2026-10-21' });
  });

  it('does not import a date or language utility', () => {
    const source = fs.readFileSync(path.join(__dirname, 'contracts', 'envelope-to-proposal.ts'), 'utf8');
    const imports = source.split('\n').filter((line) => line.startsWith('import'));
    expect(imports.join('\n')).not.toMatch(/local-date|temporal|corrections|reference-resolver|recover/);
    expect(source).not.toMatch(/nextWeekdayYmd|addDaysToYmd|Date\.parse|new Date/);
  });

  it('runs create, correction, bulk, confirm, and day-plan turns without calling a legacy recovery function', async () => {
    const modules: Record<string, unknown>[] = [
      corrections, repair, temporalResolver, referenceResolver, legacyAdapter, legacyScope, clarification, utterancePolicy, graphNormalize,
    ];
    const spies = modules.flatMap((module) =>
      Object.keys(module)
        .filter((key) => typeof module[key] === 'function')
        .map((key) => jest.spyOn(module as Record<string, (...args: unknown[]) => unknown>, key)));
    try {
      const session = createSession(USER, 'isolation');
      await runVNextTurn(base(session, [], { transcript: 'add gym next wednesday at six' }), interpreter(operations([operation({
        opId: 'op-1',
        action: 'create',
        target: { kind: 'new', localId: 'n' },
        changes: { title: 'Gym' },
        constraints: [{ kind: 'weekday', weekday: 3, which: 'next' }, { kind: 'clock', value: '18:00', role: 'start' }],
      })])));
      const op = session.structured!.operations[0];
      await runVNextTurn(base(session, [], { transcript: 'make it seven' }), interpreter(group([], {
        patches: [{ pendingId: op.pendingId, baseRevision: op.revision, fields: [], constraints: [{ op: 'replace', constraintId: op.constraints[1].constraintId, constraint: { kind: 'clock', value: '19:00', role: 'start' } }] }],
      })));
      await runVNextTurn(base(session, [], { transcript: 'yes', confirmation: claimOf(session) }), interpreter(CONFIRM));
      const rows = [entity({ id: 'm1', name: 'Sync' }), entity({ id: 'm2', name: 'Standup' })];
      await runVNextTurn(base(createSession(USER, 'isolation-bulk'), rows, { searchReceipt: { complete: true, ids: ['m1', 'm2'] } }), interpreter(operations([
        operation({ opId: 'op-1', action: 'complete', target: { kind: 'existing', description: 'meetings' }, scope: 'all' }),
      ])));
      await runVNextTurn(base(createSession(USER, 'isolation-plan'), [], { planContext: { tasks: [], slots: [], timeZone: TZ, nowIso: NOW, defaultDurationMinutes: 30 } }), interpreter({
        version: '1',
        kind: 'day_plan',
        operations: [],
        dayPlan: { phase: 'start', day: '2026-10-19' },
      }));
      const called = spies.filter((spy) => spy.mock.calls.length).map((spy) => spy.getMockName());
      expect(called).toEqual([]);
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
  });
});
