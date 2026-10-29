import { createSession } from './session/session';
import { runVNextTurn, type InterpretOutput, type TurnInput, type VNextInterpreter } from './pipeline';
import type { ProposalGroup } from './contracts/proposal';
import type { EntityRecord } from './reference/reference-resolver';
import { resolveZonedClock } from './temporal/resolve-clock';

const USER = 'user-1';
const NOW = '2026-10-18T06:00:00.000Z';
const TZ = 'Europe/Kyiv';

const report: EntityRecord = {
  id: 'task-report',
  userId: USER,
  type: 'task',
  name: 'Звіт',
  status: 'open',
  revision: 3,
  calendarId: 'cal',
  scheduledStart: '2026-10-21T08:00:00.000Z',
  scheduledEnd: '2026-10-21T09:00:00.000Z',
  googleEventId: 'g-report',
  writable: true,
};

const readonlyFlight: EntityRecord = {
  id: 'ext-flight',
  userId: USER,
  type: 'external_event',
  name: 'Flight',
  status: 'open',
  revision: 1,
  calendarId: 'cal',
  scheduledStart: '2026-10-27T12:00:00.000Z',
  scheduledEnd: '2026-10-27T15:00:00.000Z',
  writable: false,
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
      { localRef: 'd', kind: 'date', value: '2026-10-22' },
      { localRef: 'c', kind: 'clock', value: '19:00', role: 'start' },
      { localRef: 'm', kind: 'duration', minutes: 30 },
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

function interpreter(groupOrFactory: ProposalGroup | (() => ProposalGroup)): VNextInterpreter {
  return {
    arm: 'A',
    async interpret(): Promise<InterpretOutput> {
      const value = typeof groupOrFactory === 'function' ? groupOrFactory() : groupOrFactory;
      return {
        ok: true,
        group: value,
        reads: [],
        usage: { calls: 1, inputTokens: 1, outputTokens: 1, latencyMs: 1 },
        specialist: null,
        promptHash: 'stage4',
      };
    },
  };
}

function base(session = createSession(USER, 's1'), entities: EntityRecord[] = [report]): TurnInput {
  return {
    transcript: 'add Planning at 19:00',
    userId: USER,
    session,
    nowIso: NOW,
    timeZone: TZ,
    wakeHm: '08:00',
    sleepHm: '23:00',
    defaultDurationMinutes: 30,
    language: 'en',
    entities,
    arm: 'A',
  };
}

describe('stage 4 structured pipeline', () => {
  it('previews a create and confirms only with a trusted claim', async () => {
    const session = createSession(USER, 's1');
    const preview = await runVNextTurn(base(session), interpreter(group()));
    expect(preview.response.outcome).toBe('confirm');
    expect(preview.serverWrites).toBe(0);
    expect(preview.response.intents).toHaveLength(1);
    expect(preview.response.intents[0]).toMatchObject({ type: 'create', summary: 'Planning' });
    if (preview.response.intents[0].type !== 'create') return;
    expect(preview.response.intents[0].task.taskId).toBeUndefined();
    const zoned = resolveZonedClock('2026-10-22', '19:00', TZ);
    expect(zoned.status).toBe('ok');
    if (zoned.status === 'ok') expect(preview.response.intents[0].task.scheduledStartTime).toBe(zoned.iso);
    expect(session.protocol).toBe('structured');
    expect(session.structured?.preview?.executionState).toBe('open');
    const claim = {
      executionId: session.structured!.preview!.executionId,
      previewRevision: session.structured!.preview!.previewRevision,
    };
    const bare = await runVNextTurn({
      ...base(session),
      transcript: 'yes',
      confirmation: undefined,
    }, interpreter(group({ control: 'confirm', proposals: [], patches: [] })));
    expect(bare.blocked).toContain('missing_confirmation_claim');
    expect(bare.response.outcome).toBe('refuse');
    expect(session.structured?.preview?.executionState).toBe('open');
    const confirmed = await runVNextTurn({
      ...base(session),
      transcript: 'yes',
      confirmation: claim,
    }, interpreter(group({ control: 'confirm', proposals: [], patches: [] })));
    expect(confirmed.response.outcome).toBe('act');
    expect(confirmed.serverWrites).toBe(0);
    expect(confirmed.response.intents[0].type).toBe('create');
    expect(session.structured?.preview?.executionState).toBe('dispatched');
    const again = await runVNextTurn({
      ...base(session),
      transcript: 'yes',
      confirmation: claim,
    }, interpreter(group({ control: 'confirm', proposals: [], patches: [] })));
    expect(again.blocked).toContain('duplicate_confirm');
    expect(again.response.outcome).toBe('answer');
  });

  it('folds create+rename+move into one create preview identity', async () => {
    const session = createSession(USER, 's1');
    const first = await runVNextTurn(base(session), interpreter(group()));
    const pendingId = session.structured!.operations[0].pendingId;
    const second = await runVNextTurn({
      ...base(session),
      transcript: 'rename to Review and move to 18:00',
    }, interpreter(group({
      previewBoundary: 'extend',
      proposals: [
        proposal({
          localRef: 'u',
          action: 'update',
          target: { kind: 'pending', pendingId },
          dependsOn: [{ pendingId }],
          changes: { title: 'Review' },
          constraints: [],
          scheduling: 'scheduled',
        }),
        proposal({
          localRef: 'm',
          action: 'move',
          target: { kind: 'pending', pendingId },
          dependsOn: [{ pendingId }],
          changes: {},
          constraints: [{ localRef: 'c2', kind: 'clock', value: '18:00', role: 'start' }],
        }),
      ],
    })));
    expect(second.response.outcome).toBe('confirm');
    expect(second.response.intents).toHaveLength(1);
    expect(second.response.intents[0]).toMatchObject({ type: 'create', summary: 'Review' });
    expect(session.structured!.preview!.executionId).not.toBe(first.response.intents && session.structured?.executions[0].executionId);
    expect(session.structured!.preview!.previewRevision).toBeGreaterThan(1);
    expect(JSON.stringify(second.response.intents)).not.toContain(pendingId);
    const stale = await runVNextTurn({
      ...base(session),
      transcript: 'yes',
      confirmation: {
        executionId: session.structured!.executions[0].executionId,
        previewRevision: 1,
      },
    }, interpreter(group({ control: 'confirm', proposals: [], patches: [] })));
    expect(stale.blocked.some((code) => code === 'superseded_preview' || code === 'stale_execution' || code === 'stale_revision')).toBe(true);
    expect(session.structured!.preview!.executionState).toBe('open');
  });

  it('rejects forged and read-only targets and keeps the previous preview', async () => {
    const session = createSession(USER, 's1');
    await runVNextTurn(base(session), interpreter(group()));
    const before = JSON.stringify(session.structured);
    const forged = await runVNextTurn({
      ...base(session),
      transcript: 'update missing',
    }, interpreter(group({
      proposals: [proposal({
        action: 'update',
        target: { kind: 'entity', entityId: 'task-forged' },
        changes: { title: 'X' },
        constraints: [],
        scheduling: 'unscheduled',
      })],
    })));
    expect(forged.response.outcome).toBe('refuse');
    expect(forged.blocked).toContain('unauthorized_entity');
    expect(JSON.stringify(session.structured)).toBe(before);
    const locked = await runVNextTurn({
      ...base(session, [readonlyFlight]),
      transcript: 'move flight',
    }, interpreter(group({
      proposals: [proposal({
        action: 'move',
        entityType: 'external_event',
        target: { kind: 'entity', entityId: 'ext-flight' },
        changes: {},
        constraints: [
          { localRef: 'd', kind: 'date', value: '2026-10-28' },
          { localRef: 'c', kind: 'clock', value: '10:00', role: 'start' },
        ],
      })],
    })));
    expect(locked.response.outcome !== 'confirm' || locked.blocked.length > 0).toBe(true);
  });

  it('projects a stored move only when a verified google event id is present', async () => {
    const withEvent = await runVNextTurn(base(createSession(USER, 's1'), [report]), interpreter(group({
      proposals: [proposal({
        action: 'move',
        target: { kind: 'entity', entityId: 'task-report' },
        changes: {},
        constraints: [
          { localRef: 'd', kind: 'date', value: '2026-10-23' },
          { localRef: 'c', kind: 'clock', value: '11:00', role: 'start' },
        ],
      })],
    })));
    expect(withEvent.response.outcome).toBe('confirm');
    expect(withEvent.response.intents[0]).toMatchObject({ type: 'command' });
    if (withEvent.response.intents[0].type === 'command') {
      expect(withEvent.response.intents[0].command.kind).toBe('move');
      expect(withEvent.response.intents[0].command.taskId).toBe('task-report');
      expect(withEvent.response.intents[0].command.googleEventId).toBe('g-report');
    }
    const bareEntity: EntityRecord = { ...report, googleEventId: null };
    const without = await runVNextTurn(base(createSession(USER, 's2'), [bareEntity]), interpreter(group({
      proposals: [proposal({
        action: 'move',
        target: { kind: 'entity', entityId: 'task-report' },
        changes: {},
        constraints: [
          { localRef: 'd', kind: 'date', value: '2026-10-23' },
          { localRef: 'c', kind: 'clock', value: '11:00', role: 'start' },
        ],
      })],
    })));
    expect(without.response.outcome).toBe('clarify');
    expect(without.blocked).toContain('unrepresentable_move');
  });

  it('invalidates a legacy pending preview and does not confirm it', async () => {
    const session = createSession(USER, 's1');
    session.protocol = 'legacy';
    session.pendingIntents = [{ type: 'create', summary: 'Old', task: { name: 'Old' } }];
    session.pendingSummary = 'Old';
    const result = await runVNextTurn({
      ...base(session),
      transcript: 'yes',
      confirmation: { executionId: 'exec_old', previewRevision: 1 },
    }, interpreter(group({ control: 'confirm', proposals: [], patches: [] })));
    expect(session.pendingIntents).toBeNull();
    expect(session.protocol).toBe('structured');
    expect(result.blocked).toContain('legacy_or_missing_preview');
  });

  it('cancels the exact preview without dispatching intents', async () => {
    const session = createSession(USER, 's1');
    await runVNextTurn(base(session), interpreter(group()));
    const claim = {
      executionId: session.structured!.preview!.executionId,
      previewRevision: session.structured!.preview!.previewRevision,
    };
    const cancelled = await runVNextTurn({
      ...base(session),
      transcript: 'cancel',
      confirmation: claim,
    }, interpreter(group({ control: 'cancel', proposals: [], patches: [] })));
    expect(cancelled.response.outcome).toBe('answer');
    expect(cancelled.response.intents).toEqual([]);
    expect(cancelled.serverWrites).toBe(0);
    expect(session.pendingIntents).toBeNull();
  });
});
