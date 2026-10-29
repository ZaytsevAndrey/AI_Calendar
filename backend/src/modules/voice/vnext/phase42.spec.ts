import type { DayPlanProposal, PlanDraft } from '../voice-agent.types';
import type { Task } from '../../tasks/entities/task.entity';
import type { SemanticEnvelopeV1, SemanticOperationV1 } from './contracts/types';
import { mergeSpecialistFragment, specialistReason } from './interpreters/complexity';
import { runVNextTurn, type TurnInput } from './pipeline';
import { withStructuredConfirmation } from './eval/structured-test-turn';
import type { EntityRecord } from './reference/reference-resolver';
import { createSession, type VNextSession } from './session/session';
import { resolveZonedClock } from './temporal/resolve-clock';

const NOW = '2026-10-18T06:00:00.000Z';
const ZONE = 'Europe/Kyiv';
const TASK: EntityRecord = { id: 'task-1', userId: 'user-1', type: 'task', name: 'Звіт', status: 'open' };
const OTHER: EntityRecord = { id: 'task-2', userId: 'user-1', type: 'task', name: 'Звіт', status: 'open' };

function operation(partial: Pick<SemanticOperationV1, 'opId' | 'action' | 'target'> & Partial<SemanticOperationV1>): SemanticOperationV1 {
  return { changes: {}, constraints: [], dependsOn: [], source: { text: 'hello' }, ...partial };
}

function envelope(operations: SemanticOperationV1[], control?: SemanticEnvelopeV1['control']): SemanticEnvelopeV1 {
  return { version: '1', kind: operations.length || control === 'answer_pending' ? 'operations' : 'operations', operations, ...(control ? { control } : {}) };
}

function control(name: 'confirm_pending' | 'cancel_pending' | 'answer_pending'): SemanticEnvelopeV1 {
  return { version: '1', kind: 'control', operations: [], control: name };
}

async function turn(
  session: VNextSession,
  value: SemanticEnvelopeV1,
  extra: Partial<TurnInput> = {},
) {
  extra = withStructuredConfirmation(session, value, extra);
  return runVNextTurn(
    {
      transcript: value.control === 'confirm_pending' ? 'Так' : 'hello',
      userId: 'user-1',
      session,
      nowIso: NOW,
      timeZone: ZONE,
      wakeHm: '08:00',
      sleepHm: '23:00',
      defaultDurationMinutes: 30,
      language: 'uk',
      entities: [TASK],
      arm: 'A',
      ...extra,
    },
    {
      arm: 'A',
      interpret: async () => ({
        ok: true,
        envelope: value,
        reads: [],
        usage: { calls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 },
        specialist: null,
        promptHash: 'test',
      }),
    },
  );
}

function move(opId: string, constraints: SemanticOperationV1['constraints'] = []): SemanticOperationV1 {
  return operation({ opId, action: 'move', target: { kind: 'existing', proposedId: 'task-1', description: 'Звіт' }, constraints });
}

describe('phase 4.2 clarification', () => {
  it('keeps a move that has no clock, then previews the same move once the clock arrives', async () => {
    const session = createSession('user-1', 's');
    const first = await turn(session, envelope([move('move-1')]));
    expect(first.response.outcome).toBe('clarify');
    expect(first.response.intents).toEqual([]);
    expect(first.serverWrites).toBe(0);
    expect(session.pendingClarification?.blocked.map((row) => row.operation.opId)).toEqual(['move-1']);
    expect(session.pendingIntents).toBeNull();

    const second = await turn(
      session,
      envelope([move('move-1', [{ kind: 'clock', value: '10:00', role: 'start' }])], 'answer_pending'),
    );
    expect(second.response.outcome).toBe('confirm');
    expect(second.response.intents).toHaveLength(1);
    expect(second.response.intents[0]).toMatchObject({ type: 'command', command: { kind: 'move', taskId: 'task-1' } });
    expect(second.serverWrites).toBe(0);
    expect(session.pendingClarification).toBeNull();
    expect(session.openQuestion).toBeNull();
  });

  it('resolves an ambiguous task only from the answer', async () => {
    const session = createSession('user-1', 's');
    const first = await turn(
      session,
      envelope([operation({ opId: 'del-1', action: 'delete', target: { kind: 'existing', description: 'Звіт' } })]),
      { entities: [TASK, OTHER] },
    );
    expect(first.response.outcome).toBe('clarify');
    expect(first.blocked).toContain('ambiguous');

    const second = await turn(
      session,
      envelope([operation({ opId: 'del-1', action: 'delete', target: { kind: 'existing', proposedId: 'task-2', description: 'Звіт' } })], 'answer_pending'),
      { entities: [TASK, OTHER] },
    );
    expect(second.response.outcome).toBe('confirm');
    expect(second.response.intents[0]).toMatchObject({ type: 'command', command: { kind: 'delete', taskId: 'task-2' } });
    expect(second.serverWrites).toBe(0);
  });

  it('previews a held create together with the corrected move, once', async () => {
    const session = createSession('user-1', 's');
    const first = await turn(session, envelope([
      operation({ opId: 'create-1', action: 'create', target: { kind: 'new', localId: 'a' }, changes: { title: 'Хліб' } }),
      move('move-1'),
    ]));
    expect(first.response.outcome).toBe('clarify');
    expect(first.response.intents).toEqual([]);
    expect(session.heldIntents).toHaveLength(1);
    expect(session.heldIntents[0]).toMatchObject({ type: 'create' });

    const second = await turn(session, envelope([move('move-1', [{ kind: 'clock', value: '10:00', role: 'start' }])], 'answer_pending'));
    expect(second.response.outcome).toBe('confirm');
    expect(second.response.intents.filter((intent) => intent.type === 'create')).toHaveLength(1);
    expect(second.response.intents.filter((intent) => intent.type === 'command' && intent.command.kind === 'move')).toHaveLength(1);
    expect(session.heldIntents).toEqual([]);
    expect(second.serverWrites).toBe(0);
  });

  it('does not invent a target when the answer is about a different operation', async () => {
    const session = createSession('user-1', 's');
    await turn(session, envelope([move('move-1')]));
    const second = await turn(session, envelope([
      operation({ opId: 'other', action: 'create', target: { kind: 'new', localId: 'x' }, changes: { title: 'Нове' } }),
    ], 'answer_pending'));
    expect(second.response.outcome).toBe('clarify');
    expect(second.response.intents).toEqual([]);
    expect(second.blocked).toContain('unrelated_answer');
    expect(session.pendingClarification?.blocked[0]?.operation.opId).toBe('move-1');
    expect(session.pendingIntents).toBeNull();
  });

  it('cancel closes the question and does not apply', async () => {
    const session = createSession('user-1', 's');
    await turn(session, envelope([move('move-1')]));
    const second = await turn(session, control('cancel_pending'));
    expect(second.response.outcome).toBe('answer');
    expect(second.response.intents).toEqual([]);
    expect(session.pendingClarification).toBeNull();
    expect(session.pendingIntents).toBeNull();
    expect(second.serverWrites).toBe(0);
  });

  it('keeps the original move across two answers and preserves a clock that was already known', async () => {
    const session = createSession('user-1', 's');
    await turn(session, envelope([move('move-1', [
      { kind: 'clock', value: '10:00', role: 'start' },
      { kind: 'date', value: '2026-W42', precision: 'week' },
    ])]));
    expect(session.pendingClarification?.blocked[0]?.operation.constraints).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'clock', value: '10:00' }),
    ]));

    const still = await turn(session, envelope([move('move-1', [{ kind: 'date', value: '2026-W42', precision: 'week' }])], 'answer_pending'));
    expect(still.response.outcome).toBe('clarify');
    expect(session.pendingClarification?.blocked[0]?.operation.opId).toBe('move-1');
    expect(session.pendingClarification?.blocked[0]?.operation.constraints).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'clock', value: '10:00' }),
    ]));

    const done = await turn(session, envelope([move('move-1', [{ kind: 'date', value: '2026-10-19', precision: 'day' }])], 'answer_pending'));
    const expected = resolveZonedClock('2026-10-19', '10:00', ZONE);
    expect(expected.status).toBe('ok');
    expect(done.response.outcome).toBe('confirm');
    expect(done.response.intents[0]).toMatchObject({
      type: 'command',
      command: { kind: 'move', taskId: 'task-1', scheduledStartTime: expected.status === 'ok' ? expected.iso : '' },
    });
  });

  it('replaces a previously specified clock when the answer states a different clock', async () => {
    const session = createSession('user-1', 's');
    await turn(session, envelope([move('move-1', [
      { kind: 'clock', value: '10:00', role: 'start' },
      { kind: 'date', value: '2026-W42', precision: 'week' },
    ])]));
    const done = await turn(session, envelope([move('move-1', [
      { kind: 'clock', value: '11:00', role: 'start' },
      { kind: 'date', value: '2026-10-19', precision: 'day' },
    ])], 'answer_pending'));
    const expected = resolveZonedClock('2026-10-19', '11:00', ZONE);
    expect(expected.status).toBe('ok');
    expect(done.response.intents[0]).toMatchObject({
      command: { scheduledStartTime: expected.status === 'ok' ? expected.iso : '' },
    });
  });

  it('does not treat confirm as an answer while a question is open', async () => {
    const session = createSession('user-1', 's');
    await turn(session, envelope([
      operation({ opId: 'create-1', action: 'create', target: { kind: 'new', localId: 'a' }, changes: { title: 'Хліб' } }),
      move('move-1'),
    ]));
    const second = await turn(session, control('confirm_pending'));
    expect(second.response.outcome).toBe('clarify');
    expect(second.response.intents).toEqual([]);
    expect(session.pendingIntents).toBeNull();
    expect(session.pendingClarification?.blocked[0]?.operation.opId).toBe('move-1');
    expect(session.heldIntents).toHaveLength(1);
  });
});

describe('phase 4.2 day plan', () => {
  const task = {
    id: 'task-9',
    userId: 'user-1',
    name: 'Звіт',
    status: 'todo',
    isUnscheduled: true,
    isRecurring: false,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
  } as Task;

  const planContext = {
    tasks: [task],
    slots: [],
    timeZone: ZONE,
    nowIso: NOW,
    defaultDurationMinutes: 30,
  };

  it('refuses to start a day plan when the day context was not supplied', async () => {
    const session = createSession('user-1', 's');
    const result = await turn(session, {
      version: '1',
      kind: 'day_plan',
      operations: [],
      dayPlan: { phase: 'start', day: '2026-10-19', edits: [] },
    });
    expect(result.response.outcome).toBe('refuse');
    expect(result.blocked).toContain('day_context_missing');
    expect(session.planDraft).toBeNull();
    expect(result.serverWrites).toBe(0);
  });

  it('loads the real unscheduled task when the day context is supplied', async () => {
    const session = createSession('user-1', 's');
    const result = await turn(session, {
      version: '1',
      kind: 'day_plan',
      operations: [],
      dayPlan: { phase: 'start', day: '2026-10-19', edits: [] },
    }, { planContext });
    expect(result.response.outcome).toBe('clarify');
    expect(result.response.intents).toEqual([]);
    expect(session.planDraft?.items.map((item) => item.taskId)).toEqual(['task-9']);
    expect(result.serverWrites).toBe(0);
  });

  it('refuses an include of a task that is not in the day context', async () => {
    const session = createSession('user-1', 's');
    session.planDraft = {
      day: '2026-10-19',
      stage: 'interview',
      interviewAsked: 0,
      items: [],
      revision: 0,
      nextNewId: 1,
      lastProposal: null,
    };
    const before = session.planDraft.items.length;
    const result = await turn(session, {
      version: '1',
      kind: 'day_plan',
      operations: [],
      dayPlan: { phase: 'edit', day: '2026-10-19', edits: [{ op: 'include_task', taskId: 'missing' }] },
    }, { planContext });
    expect(result.response.outcome).toBe('refuse');
    expect(result.blocked).toContain('unknown_task');
    expect(session.planDraft?.items).toHaveLength(before);
  });

  it('previews seated proposal items and does not write them', async () => {
    const session = createSession('user-1', 's');
    const draft: PlanDraft = {
      day: '2026-10-19',
      stage: 'review',
      interviewAsked: 0,
      items: [{ id: 'new:1', taskId: null, source: 'new', name: 'Прогулянка', durationMinutes: 30, preferredHm: null, earliestHm: null, deadlineHm: null }],
      revision: 1,
      nextNewId: 2,
      lastProposal: null,
    };
    session.planDraft = draft;
    const proposal: DayPlanProposal = {
      day: '2026-10-19',
      stage: 'review',
      revision: 1,
      items: [{ itemId: 'new:1', taskId: null, source: 'new', name: 'Прогулянка', start: '2026-10-19T07:00:00.000Z', end: '2026-10-19T07:30:00.000Z', durationMinutes: 30 }],
      unplaced: [],
      changedItemIds: ['new:1'],
    };
    const result = await turn(session, {
      version: '1',
      kind: 'day_plan',
      operations: [],
      dayPlan: { phase: 'apply', day: '2026-10-19', edits: [] },
    }, { planContext, proposeDay: async () => proposal });
    expect(result.response.outcome).toBe('confirm');
    expect(result.response.plan?.items).toHaveLength(1);
    expect(result.response.intents).toHaveLength(1);
    expect(result.response.intents[0]?.type).toBe('create');
    expect(result.serverWrites).toBe(0);
    expect(JSON.stringify(result.response)).not.toContain('18:00');
  });

  it('does not seat an unresolved evening label when apply is requested', async () => {
    const session = createSession('user-1', 's');
    session.planDraft = {
      day: '2026-10-19',
      stage: 'review',
      interviewAsked: 0,
      items: [{ id: 'new:1', taskId: null, source: 'new', name: 'Прогулянка', durationMinutes: 30, preferredHm: null, earliestHm: null, deadlineHm: null }],
      revision: 1,
      nextNewId: 2,
      lastProposal: null,
    };
    session.qualitativeByItemId = { 'new:1': 'evening' };
    let called = false;
    const result = await turn(session, {
      version: '1',
      kind: 'day_plan',
      operations: [],
      dayPlan: { phase: 'apply', day: '2026-10-19', edits: [] },
    }, {
      planContext,
      proposeDay: async () => {
        called = true;
        return { day: '2026-10-19', stage: 'review', revision: 1, items: [], unplaced: [], changedItemIds: [] };
      },
    });
    expect(called).toBe(false);
    expect(result.response.outcome).toBe('refuse');
    expect(result.blocked).toContain('unmapped_time');
    expect(result.preservedLabels).toContain('evening');
    expect(result.response.intents).toEqual([]);
    expect(result.serverWrites).toBe(0);
  });

  it('refuses apply when the production planner was not provided', async () => {
    const session = createSession('user-1', 's');
    session.planDraft = {
      day: '2026-10-19',
      stage: 'review',
      interviewAsked: 0,
      items: [],
      revision: 0,
      nextNewId: 1,
      lastProposal: null,
    };
    const result = await turn(session, {
      version: '1',
      kind: 'day_plan',
      operations: [],
      dayPlan: { phase: 'apply', day: '2026-10-19', edits: [] },
    }, { planContext });
    expect(result.response.outcome).toBe('refuse');
    expect(result.blocked).toContain('day_planner_unavailable');
    expect(result.response.intents).toEqual([]);
  });
});

describe('phase 4.2 semantic preservation and preview state', () => {
  it('does not turn an evening move into an update', async () => {
    const session = createSession('user-1', 's');
    const result = await turn(session, envelope([move('move-1', [{ kind: 'time_of_day', label: 'evening', bound: 'at' }])]));
    expect(result.response.outcome).toBe('clarify');
    expect(result.blocked).toContain('unmapped_time');
    expect(result.response.intents).toEqual([]);
    expect(result.preservedLabels).toContain('evening');
  });

  it('folds a same-utterance move of a new task into that create and does not invent an id', async () => {
    const session = createSession('user-1', 's');
    const result = await turn(session, envelope([
      operation({ opId: 'create-1', action: 'create', target: { kind: 'new', localId: 'a' }, changes: { title: 'Хліб' } }),
      operation({ opId: 'move-1', action: 'move', target: { kind: 'operation_result', opId: 'create-1' }, constraints: [{ kind: 'clock', value: '10:00', role: 'start' }] }),
    ]));
    const expected = resolveZonedClock('2026-10-18', '10:00', ZONE);
    expect(expected.status).toBe('ok');
    expect(result.response.outcome).toBe('confirm');
    expect(result.response.intents).toHaveLength(1);
    expect(result.response.intents[0]).toMatchObject({
      type: 'create',
      task: { name: 'Хліб', scheduledStartTime: expected.status === 'ok' ? expected.iso : '' },
    });
    expect(JSON.stringify(result.response.intents)).not.toContain('task-');
    expect(result.serverWrites).toBe(0);
  });

  it('blocks a move whose result target is not the new task from this utterance', async () => {
    const session = createSession('user-1', 's');
    const result = await turn(session, envelope([
      operation({ opId: 'create-1', action: 'create', target: { kind: 'new', localId: 'a' }, changes: { title: 'Хліб' } }),
      operation({ opId: 'move-1', action: 'move', target: { kind: 'operation_result', opId: 'elsewhere' }, constraints: [{ kind: 'clock', value: '10:00', role: 'start' }] }),
    ]));
    expect(result.response.outcome).toBe('clarify');
    expect(result.response.intents).toEqual([]);
    expect(result.blocked).toContain('unsupported_binding');
    expect(session.pendingIntents).toBeNull();
    expect(session.heldIntents).toHaveLength(1);
  });

  it('previews a resolved delete without an extra question and without writing', async () => {
    const session = createSession('user-1', 's');
    const result = await turn(session, envelope([
      operation({ opId: 'del-1', action: 'delete', target: { kind: 'existing', proposedId: 'task-1', description: 'Звіт' } }),
    ]));
    expect(result.response.outcome).toBe('confirm');
    expect(result.response.intents[0]).toMatchObject({ command: { kind: 'delete', taskId: 'task-1' } });
    expect(result.serverWrites).toBe(0);
  });

  it('drops a stale preview when the next utterance is a different operation', async () => {
    const session = createSession('user-1', 's');
    const first = await turn(session, envelope([
      operation({ opId: 'create-1', action: 'create', target: { kind: 'new', localId: 'a' }, changes: { title: 'Хліб' } }),
    ]));
    expect(first.response.outcome).toBe('confirm');
    const second = await turn(session, envelope([
      operation({ opId: 'create-2', action: 'create', target: { kind: 'new', localId: 'b' }, changes: { title: 'Молоко' } }),
    ]));
    expect(second.response.outcome).toBe('confirm');
    expect(second.response.intents).toHaveLength(1);
    expect(second.response.intents[0]).toMatchObject({ type: 'create', task: { name: 'Молоко' } });
    const applied = await turn(session, control('confirm_pending'));
    expect(applied.response.outcome).toBe('act');
    expect(applied.response.intents).toHaveLength(1);
    expect(applied.response.intents[0]).toMatchObject({ task: { name: 'Молоко' } });
    expect(applied.serverWrites).toBe(0);
  });

  it('does not apply a preview when the utterance is only answer_pending', async () => {
    const session = createSession('user-1', 's');
    await turn(session, envelope([
      operation({ opId: 'create-1', action: 'create', target: { kind: 'new', localId: 'a' }, changes: { title: 'Хліб' } }),
    ]));
    const second = await turn(session, control('answer_pending'));
    expect(second.response.outcome).not.toBe('act');
    expect(second.response.intents).toEqual([]);
    expect(session.pendingIntents).toBeNull();
  });
});

describe('phase 4.2 specialist merge', () => {
  it('does not let a specialist fragment add a reminder the base operation did not have', () => {
    const base: SemanticEnvelopeV1 = {
      version: '1',
      kind: 'operations',
      operations: [operation({ opId: 'create-1', action: 'create', target: { kind: 'new', localId: 'a' }, changes: { title: 'Хліб' } })],
    };
    const fragment: SemanticEnvelopeV1 = {
      version: '1',
      kind: 'operations',
      operations: [operation({
        opId: 'create-1',
        action: 'create',
        target: { kind: 'new', localId: 'a' },
        changes: { reminder: { op: 'create', name: 'Хліб' } },
      })],
    };
    const merged = mergeSpecialistFragment(base, fragment);
    expect(merged.ok).toBe(true);
    if (merged.ok) expect(merged.envelope.operations[0]?.changes.reminder).toBeUndefined();
    expect(specialistReason(base.operations[0]!)).toBeNull();
  });
});
