import { createSession } from './session/session';
import { runVNextTurn, type InterpretOutput, type TurnInput, type VNextInterpreter } from './pipeline';
import type { ProposalGroup } from './contracts/proposal';
import type { EntityRecord } from './reference/reference-resolver';

const USER = 'user-1';
const NOW = '2026-10-18T06:00:00.000Z';
const TZ = 'Europe/Kyiv';

function entity(overrides: Partial<EntityRecord> = {}): EntityRecord {
  return {
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
    ...overrides,
  };
}

function proposal(overrides: Record<string, unknown> = {}) {
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

function group(overrides: Record<string, unknown> = {}): ProposalGroup {
  return { version: '1', control: 'none', proposals: [proposal()], patches: [], ...overrides } as ProposalGroup;
}

function interpreter(body: ProposalGroup): VNextInterpreter {
  return {
    arm: 'A',
    async interpret(): Promise<InterpretOutput> {
      return {
        ok: true,
        group: body,
        reads: [],
        usage: { calls: 1, inputTokens: 1, outputTokens: 1, latencyMs: 1 },
        specialist: null,
        promptHash: 'revalidate',
      };
    },
  };
}

function base(session = createSession(USER, 's1'), entities: EntityRecord[] = [entity()]): TurnInput {
  return {
    transcript: 'rename report',
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

async function previewThen(input: {
  entities?: EntityRecord[];
  readEntity?: TurnInput['readEntity'];
  confirmGroup?: ProposalGroup;
  mutateSession?: (session: ReturnType<typeof createSession>) => void | Promise<void>;
}) {
  const session = createSession(USER, 's1');
  const entities = input.entities ?? [entity()];
  await runVNextTurn(base(session, entities), interpreter(group()));
  const claim = {
    executionId: session.structured!.preview!.executionId,
    previewRevision: session.structured!.preview!.previewRevision,
  };
  if (input.mutateSession) await input.mutateSession(session);
  return runVNextTurn({
    ...base(session, entities),
    transcript: 'yes',
    confirmation: claim,
    readEntity: input.readEntity,
  }, interpreter(input.confirmGroup ?? group({ control: 'confirm', proposals: [], patches: [] })));
}

describe('stage 4.1 confirmation entity revalidation', () => {
  it('confirms when the entity is unchanged', async () => {
    const result = await previewThen({
      readEntity: async () => ({
        exists: true,
        revision: 3,
        calendarId: 'cal',
        writable: true,
        googleEventId: 'g-report',
        status: 'open',
        userId: USER,
      }),
    });
    expect(result.response.outcome).toBe('act');
    expect(result.serverWrites).toBe(0);
    expect(result.response.intents).toHaveLength(1);
  });

  it('rejects when the entity revision changed after preview', async () => {
    const result = await previewThen({
      readEntity: async () => ({
        exists: true,
        revision: 4,
        calendarId: 'cal',
        writable: true,
        googleEventId: 'g-report',
        status: 'open',
        userId: USER,
      }),
    });
    expect(result.response.outcome).toBe('clarify');
    expect(result.blocked).toContain('stale_preview');
    expect(result.response.intents).toEqual([]);
    expect(result.serverWrites).toBe(0);
  });

  it('rejects when the entity was deleted after preview', async () => {
    const result = await previewThen({
      readEntity: async () => ({ exists: false }),
    });
    expect(result.blocked).toContain('stale_deleted');
    expect(result.response.outcome).toBe('clarify');
  });

  it('rejects when access was revoked after preview', async () => {
    const result = await previewThen({
      readEntity: async () => ({
        exists: true,
        revision: 3,
        calendarId: 'cal',
        writable: false,
        googleEventId: 'g-report',
        status: 'open',
        userId: USER,
      }),
    });
    expect(result.blocked).toContain('unauthorized_entity');
  });

  it('rejects when the calendar event identity changed for a move', async () => {
    const session = createSession(USER, 'move');
    const entities = [entity()];
    await runVNextTurn(base(session, entities), interpreter(group({
      proposals: [proposal({
        action: 'move',
        changes: {},
        constraints: [
          { localRef: 'd', kind: 'date', value: '2026-10-23' },
          { localRef: 'c', kind: 'clock', value: '11:00', role: 'start' },
        ],
        scheduling: 'scheduled',
      })],
    })));
    const claim = {
      executionId: session.structured!.preview!.executionId,
      previewRevision: session.structured!.preview!.previewRevision,
    };
    const result = await runVNextTurn({
      ...base(session, entities),
      transcript: 'yes',
      confirmation: claim,
      readEntity: async () => ({
        exists: true,
        revision: 3,
        calendarId: 'cal',
        writable: true,
        googleEventId: 'g-other',
        status: 'open',
        userId: USER,
      }),
    }, interpreter(group({ control: 'confirm', proposals: [], patches: [] })));
    expect(result.blocked).toContain('stale_event_identity');
    expect(result.response.outcome).toBe('clarify');
  });

  it('rejects when the revalidation read fails', async () => {
    const result = await previewThen({
      readEntity: async () => {
        throw new Error('timeout');
      },
    });
    expect(result.blocked).toContain('revalidation_failed');
    expect(result.response.outcome).toBe('clarify');
  });

  it('rejects when a correction lands while revalidation awaits', async () => {
    const session = createSession(USER, 'race');
    const entities = [entity()];
    await runVNextTurn(base(session, entities), interpreter(group()));
    const claim = {
      executionId: session.structured!.preview!.executionId,
      previewRevision: session.structured!.preview!.previewRevision,
    };
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const confirming = runVNextTurn({
      ...base(session, entities),
      transcript: 'yes',
      confirmation: claim,
      readEntity: async () => {
        await gate;
        return {
          exists: true,
          revision: 3,
          calendarId: 'cal',
          writable: true,
          googleEventId: 'g-report',
          status: 'open',
          userId: USER,
        };
      },
    }, interpreter(group({ control: 'confirm', proposals: [], patches: [] })));
    await runVNextTurn({
      ...base(session, entities),
      transcript: 'actually Review',
    }, interpreter(group({
      proposals: [],
      patches: [{
        pendingId: session.structured!.operations[0].pendingId,
        baseRevision: session.structured!.operations[0].revision,
        fields: [{ op: 'replace', field: 'title', value: 'Review' }],
        constraints: [],
      }],
    })));
    release();
    const result = await confirming;
    expect(result.blocked).toContain('version_conflict');
    expect(result.response.outcome).toBe('clarify');
    expect(session.structured?.preview?.executionState).toBe('open');
    expect(session.structured?.preview?.executionId).not.toBe(claim.executionId);
  });

  it('rejects when cancellation lands while revalidation awaits', async () => {
    const session = createSession(USER, 'cancel-race');
    const entities = [entity()];
    await runVNextTurn(base(session, entities), interpreter(group()));
    const claim = {
      executionId: session.structured!.preview!.executionId,
      previewRevision: session.structured!.preview!.previewRevision,
    };
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const confirming = runVNextTurn({
      ...base(session, entities),
      transcript: 'yes',
      confirmation: claim,
      readEntity: async () => {
        await gate;
        return {
          exists: true,
          revision: 3,
          calendarId: 'cal',
          writable: true,
          googleEventId: 'g-report',
          status: 'open',
          userId: USER,
        };
      },
    }, interpreter(group({ control: 'confirm', proposals: [], patches: [] })));
    await runVNextTurn({
      ...base(session, entities),
      transcript: 'cancel',
      confirmation: claim,
    }, interpreter(group({ control: 'cancel', proposals: [], patches: [] })));
    release();
    const result = await confirming;
    expect(result.blocked).toContain('version_conflict');
    expect(result.response.intents).toEqual([]);
  });

  it('does not dispatch a second confirmation', async () => {
    const session = createSession(USER, 'dup');
    const entities = [entity()];
    const readEntity: TurnInput['readEntity'] = async () => ({
      exists: true,
      revision: 3,
      calendarId: 'cal',
      writable: true,
      googleEventId: 'g-report',
      status: 'open',
      userId: USER,
    });
    await runVNextTurn(base(session, entities), interpreter(group()));
    const claim = {
      executionId: session.structured!.preview!.executionId,
      previewRevision: session.structured!.preview!.previewRevision,
    };
    const first = await runVNextTurn({
      ...base(session, entities),
      transcript: 'yes',
      confirmation: claim,
      readEntity,
    }, interpreter(group({ control: 'confirm', proposals: [], patches: [] })));
    const second = await runVNextTurn({
      ...base(session, entities),
      transcript: 'yes',
      confirmation: claim,
      readEntity,
    }, interpreter(group({ control: 'confirm', proposals: [], patches: [] })));
    expect(first.response.outcome).toBe('act');
    expect(second.blocked).toContain('duplicate_confirm');
  });

  it('rejects the whole confirmation when one of several entities is stale', async () => {
    const second = entity({ id: 'task-meet', name: 'Нарада', googleEventId: 'g-meet', revision: 1 });
    const session = createSession(USER, 'multi');
    const entities = [entity(), second];
    await runVNextTurn(base(session, entities), interpreter(group({
      proposals: [
        proposal(),
        proposal({
          localRef: 'b',
          action: 'complete',
          target: { kind: 'entity', entityId: 'task-meet' },
          changes: {},
        }),
      ],
    })));
    const claim = {
      executionId: session.structured!.preview!.executionId,
      previewRevision: session.structured!.preview!.previewRevision,
    };
    const result = await runVNextTurn({
      ...base(session, entities),
      transcript: 'yes',
      confirmation: claim,
      readEntity: async (id) => ({
        exists: true,
        revision: id === 'task-meet' ? 9 : 3,
        calendarId: 'cal',
        writable: true,
        googleEventId: id === 'task-meet' ? 'g-meet' : 'g-report',
        status: 'open',
        userId: USER,
      }),
    }, interpreter(group({ control: 'confirm', proposals: [], patches: [] })));
    expect(result.blocked).toContain('stale_preview');
    expect(result.response.intents).toEqual([]);
    expect(session.structured?.preview?.executionState).toBe('superseded');
  });
});
