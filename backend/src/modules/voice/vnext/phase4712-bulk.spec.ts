import { createSession } from './session/session';
import { runVNextTurn, type InterpretOutput, type TurnInput, type VNextInterpreter } from './pipeline';
import type { SemanticEnvelopeV1 } from './contracts/types';
import type { EntityRecord } from './reference/reference-resolver';
import type { ProposalGroup } from './contracts/proposal';

const USER = 'user-1';
const TZ = 'Europe/Kyiv';
const NOW = '2026-10-18T10:00:00.000Z';

const MEETINGS: EntityRecord[] = [
  { id: 'a', userId: USER, type: 'task', name: 'Нарада', status: 'open', calendarId: 'work', revision: 1, googleEventId: 'g-a', scheduledStart: '2026-10-18T12:00:00.000Z', scheduledEnd: '2026-10-18T13:00:00.000Z' },
  { id: 'b', userId: USER, type: 'task', name: 'Нарада', status: 'open', calendarId: 'work', revision: 1, googleEventId: 'g-b', scheduledStart: '2026-10-18T14:00:00.000Z', scheduledEnd: '2026-10-18T15:00:00.000Z' },
];

function base(session: ReturnType<typeof createSession>, entities: EntityRecord[] = MEETINGS, extra: Partial<TurnInput> = {}): TurnInput {
  return {
    userId: USER,
    session,
    transcript: 'bulk',
    nowIso: NOW,
    timeZone: TZ,
    language: 'uk',
    arm: 'A',
    wakeHm: '07:00',
    sleepHm: '23:00',
    defaultDurationMinutes: 30,
    entities,
    ...extra,
  };
}

function interpreter(group: ProposalGroup | null, envelope?: SemanticEnvelopeV1): VNextInterpreter {
  return {
    arm: 'A',
    async interpret(): Promise<InterpretOutput> {
      return {
        ok: true,
        specialist: 'test',
        promptHash: 'bulk',
        usage: { calls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 },
        reads: [],
        group: group ?? undefined,
        envelope,
      };
    },
  };
}

function envelopeBulkDelete(): SemanticEnvelopeV1 {
  return {
    version: '1',
    kind: 'operations',
    operations: [{
      opId: 'op-1',
      action: 'delete',
      target: { kind: 'existing', description: 'Нарада', calendarId: 'work' },
      scope: 'all',
      changes: {},
      constraints: [],
      dependsOn: [],
      source: { text: 'Видали всі наради' },
    }],
  };
}

describe('stage 4.1 structured bulk scope', () => {
  it('previews an explicit multi-entity proposal set', async () => {
    const session = createSession(USER, 'multi');
    const group: ProposalGroup = {
      version: '1',
      control: 'none',
      proposals: [
        {
          localRef: 'a',
          action: 'delete',
          entityType: 'task',
          target: { kind: 'entity', entityId: 'a' },
          scheduling: 'unscheduled',
          changes: { title: 'Нарада' },
          constraints: [],
          dependsOn: [],
          known: [],
          missing: [],
          source: { text: 'a' },
        },
        {
          localRef: 'b',
          action: 'delete',
          entityType: 'task',
          target: { kind: 'entity', entityId: 'b' },
          scheduling: 'unscheduled',
          changes: { title: 'Нарада' },
          constraints: [],
          dependsOn: [],
          known: [],
          missing: [],
          source: { text: 'b' },
        },
      ],
      patches: [],
    };
    const result = await runVNextTurn(base(session), interpreter(group));
    expect(result.response.outcome).toBe('confirm');
    expect(result.response.intents).toHaveLength(2);
    expect(result.serverWrites).toBe(0);
  });

  it('expands a complete search receipt for scope:all without inventing ids', async () => {
    const session = createSession(USER, 'complete');
    const result = await runVNextTurn(
      base(session, MEETINGS, { searchReceipt: { complete: true, ids: ['a', 'b'] } }),
      interpreter(null, envelopeBulkDelete()),
    );
    expect(result.response.outcome).toBe('confirm');
    expect(result.response.intents).toHaveLength(2);
    expect(session.previewTargetIds.sort()).toEqual(['a', 'b']);
  });

  it('rejects a truncated search as exhaustive', async () => {
    const session = createSession(USER, 'trunc');
    const result = await runVNextTurn(
      base(session, MEETINGS, { searchReceipt: { complete: false, truncated: true, ids: ['a'] } }),
      interpreter(null, envelopeBulkDelete()),
    );
    expect(result.response.outcome).toBe('clarify');
    expect(result.blocked).toContain('search_truncated');
    expect(result.response.intents).toEqual([]);
  });

  it('rejects missing completeness for universal scope', async () => {
    const session = createSession(USER, 'unknown');
    const result = await runVNextTurn(base(session), interpreter(null, envelopeBulkDelete()));
    expect(result.blocked).toContain('completeness_unknown');
    expect(result.response.intents).toEqual([]);
  });

  it('refuses an unauthorized entity in a proposed set', async () => {
    const session = createSession(USER, 'auth');
    const group: ProposalGroup = {
      version: '1',
      control: 'none',
      proposals: [{
        localRef: 'x',
        action: 'delete',
        entityType: 'task',
        target: { kind: 'entity', entityId: 'other-user-task' },
        scheduling: 'unscheduled',
        changes: {},
        constraints: [],
        dependsOn: [],
        known: [],
        missing: [],
        source: { text: 'x' },
      }],
      patches: [],
    };
    const result = await runVNextTurn(base(session), interpreter(group));
    expect(result.response.outcome).toBe('refuse');
    expect(result.blocked).toContain('unauthorized_entity');
  });

  it('rejects confirmation when the bulk set shrinks after preview', async () => {
    const session = createSession(USER, 'stale-set');
    const preview = await runVNextTurn(
      base(session, MEETINGS, { searchReceipt: { complete: true, ids: ['a', 'b'] } }),
      interpreter(null, envelopeBulkDelete()),
    );
    expect(preview.response.outcome).toBe('confirm');
    const claim = {
      executionId: session.structured!.preview!.executionId,
      previewRevision: session.structured!.preview!.previewRevision,
    };
    const changed = await runVNextTurn(
      base(session, MEETINGS, {
        transcript: 'yes',
        confirmation: claim,
        searchReceipt: { complete: true, ids: ['a'] },
      }),
      interpreter({ version: '1', control: 'confirm', proposals: [], patches: [] }),
    );
    expect(changed.response.outcome).toBe('clarify');
    expect(changed.blocked).toContain('stale_scope');
    expect(changed.response.intents).toEqual([]);
  });

  it('rejects bulk confirmation with an outdated execution identity', async () => {
    const session = createSession(USER, 'stale-id');
    await runVNextTurn(
      base(session, MEETINGS, { searchReceipt: { complete: true, ids: ['a', 'b'] } }),
      interpreter(null, envelopeBulkDelete()),
    );
    const changed = await runVNextTurn(
      base(session, MEETINGS, {
        transcript: 'yes',
        confirmation: { executionId: 'exec_old', previewRevision: 1 },
        searchReceipt: { complete: true, ids: ['a', 'b'] },
      }),
      interpreter({ version: '1', control: 'confirm', proposals: [], patches: [] }),
    );
    expect(changed.blocked).toContain('stale_execution');
    expect(changed.response.outcome).not.toBe('act');
  });
});
