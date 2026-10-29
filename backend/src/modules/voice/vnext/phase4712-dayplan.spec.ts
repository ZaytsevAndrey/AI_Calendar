import { createSession } from './session/session';
import { runVNextTurn, type InterpretOutput, type TurnInput, type VNextInterpreter } from './pipeline';
import type { SemanticEnvelopeV1 } from './contracts/types';
import type { PlanDraft } from '../voice-agent.types';

const USER = 'user-1';
const TZ = 'Europe/Kyiv';
const NOW = '2026-10-18T10:00:00.000Z';

function base(session: ReturnType<typeof createSession>, extra: Partial<TurnInput> = {}): TurnInput {
  return {
    userId: USER,
    session,
    transcript: 'plan my day',
    nowIso: NOW,
    timeZone: TZ,
    language: 'uk',
    arm: 'A',
    wakeHm: '07:00',
    sleepHm: '23:00',
    defaultDurationMinutes: 30,
    entities: [],
    planContext: {
      tasks: [],
      slots: [],
      timeZone: TZ,
      nowIso: NOW,
      defaultDurationMinutes: 30,
    },
    ...extra,
  };
}

function interpreter(envelope: SemanticEnvelopeV1): VNextInterpreter {
  return {
    arm: 'A',
    async interpret(): Promise<InterpretOutput> {
      return {
        ok: true,
        specialist: 'test',
        promptHash: 'day',
        usage: { calls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 },
        reads: [],
        envelope,
      };
    },
  };
}

describe('stage 4.1 structured day-plan', () => {
  it('starts a day plan without opening a pending execution', async () => {
    const session = createSession(USER, 'start');
    const result = await runVNextTurn(base(session), interpreter({
      version: '1',
      kind: 'day_plan',
      operations: [],
      dayPlan: { phase: 'start', day: '2026-10-19' },
    }));
    expect(result.blocked).not.toContain('day_plan_not_structured');
    expect(session.planDraft?.day).toBe('2026-10-19');
    expect(session.structured?.preview).toBeFalsy();
    expect(result.response.outcome).toBe('clarify');
    expect(result.serverWrites).toBe(0);
  });

  it('cancels an open plan as a read-only answer', async () => {
    const session = createSession(USER, 'cancel');
    await runVNextTurn(base(session), interpreter({
      version: '1',
      kind: 'day_plan',
      operations: [],
      dayPlan: { phase: 'start', day: '2026-10-19' },
    }));
    const canceled = await runVNextTurn(base(session, { transcript: 'cancel' }), interpreter({
      version: '1',
      kind: 'day_plan',
      operations: [],
      dayPlan: { phase: 'cancel' },
    }));
    expect(canceled.response.outcome).toBe('answer');
    expect(session.planDraft).toBeNull();
    expect(canceled.serverWrites).toBe(0);
  });

  it('applies a plan into a structured confirm preview before any write', async () => {
    const session = createSession(USER, 'apply');
    await runVNextTurn(base(session), interpreter({
      version: '1',
      kind: 'day_plan',
      operations: [],
      dayPlan: { phase: 'start', day: '2026-10-19' },
    }));
    const proposeDay = async (_userId: string, draft: PlanDraft) => ({
      day: draft.day,
      stage: 'review' as const,
      revision: draft.revision,
      items: draft.items.map((item) => ({
        itemId: item.id,
        taskId: item.taskId,
        source: item.source,
        name: item.name,
        start: '2026-10-19T08:00:00.000Z',
        end: '2026-10-19T08:30:00.000Z',
        durationMinutes: item.durationMinutes,
      })),
      unplaced: [],
      changedItemIds: draft.items.map((item) => item.id),
    });
    await runVNextTurn(base(session, { transcript: 'add tea' }), interpreter({
      version: '1',
      kind: 'day_plan',
      operations: [],
      dayPlan: {
        phase: 'edit',
        edits: [{ op: 'add_task', name: 'tea', durationMinutes: 30, preferredHm: null, earliestHm: null, deadlineHm: null }],
      },
    }));
    const applied = await runVNextTurn(base(session, { transcript: 'apply', proposeDay }), interpreter({
      version: '1',
      kind: 'day_plan',
      operations: [],
      dayPlan: { phase: 'apply' },
    }));
    expect(applied.response.outcome).toBe('confirm');
    expect(applied.serverWrites).toBe(0);
    expect(session.structured?.preview?.executionState).toBe('open');
    expect(session.protocol).toBe('structured');
    const claim = {
      executionId: session.structured!.preview!.executionId,
      previewRevision: session.structured!.preview!.previewRevision,
    };
    const confirmed = await runVNextTurn(base(session, {
      transcript: 'yes',
      confirmation: claim,
      proposeDay,
    }), interpreter({
      version: '1',
      kind: 'control',
      operations: [],
      control: 'confirm_pending',
    }));
    expect(confirmed.response.outcome).toBe('act');
    expect(confirmed.serverWrites).toBe(0);
  });

  it('refuses apply when the day planner is unavailable', async () => {
    const session = createSession(USER, 'no-planner');
    await runVNextTurn(base(session), interpreter({
      version: '1',
      kind: 'day_plan',
      operations: [],
      dayPlan: { phase: 'start', day: '2026-10-19' },
    }));
    const applied = await runVNextTurn(base(session, { transcript: 'apply' }), interpreter({
      version: '1',
      kind: 'day_plan',
      operations: [],
      dayPlan: { phase: 'apply' },
    }));
    expect(applied.response.outcome).toBe('refuse');
    expect(applied.blocked).toContain('day_planner_unavailable');
  });
});
