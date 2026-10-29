import type { PlacementPlan } from '../../schedule/placement-step.util';
import type { Task } from '../../tasks/entities/task.entity';
import { VoiceDayPlanner } from '../voice-agent.day-plan';
import type { DayPlanProposal, PlanDraft, PlanItem } from '../voice-agent.types';
import type { SemanticConstraintV1, SemanticEnvelopeV1, SemanticOperationV1 } from './contracts/types';
import { runVNextTurn, type PipelineResult, type TurnInput } from './pipeline';
import { withStructuredConfirmation } from './eval/structured-test-turn';
import type { EntityRecord } from './reference/reference-resolver';
import { createSession, type VNextSession } from './session/session';
import { resolveZonedClock } from './temporal/resolve-clock';

const NOW = '2026-10-18T06:00:00.000Z';
const ZONE = 'Europe/Kyiv';
const TASK: EntityRecord = { id: 'task-1', userId: 'user-1', type: 'task', name: 'Звіт', status: 'open' };

function openSession(sessionId: string): VNextSession {
  return createSession('user-1', sessionId);
}

function operation(partial: Pick<SemanticOperationV1, 'opId' | 'action' | 'target'> & Partial<SemanticOperationV1>): SemanticOperationV1 {
  return { changes: {}, constraints: [], dependsOn: [], source: { text: 'hello' }, ...partial };
}

function clockIso(ymd: string, hm: string): string {
  const resolved = resolveZonedClock(ymd, hm, ZONE);
  if (resolved.status !== 'ok') throw new Error(resolved.status);
  return resolved.iso;
}

function clock(role: 'start' | 'end', value: string): SemanticConstraintV1 {
  return { kind: 'clock', role, value };
}

function envelope(operations: SemanticOperationV1[], control?: SemanticEnvelopeV1['control']): SemanticEnvelopeV1 {
  return { version: '1', kind: 'operations', operations, ...(control ? { control } : {}) };
}

function control(name: 'confirm_pending' | 'cancel_pending' | 'answer_pending'): SemanticEnvelopeV1 {
  return { version: '1', kind: 'control', operations: [], control: name };
}

async function turn(session: VNextSession, value: SemanticEnvelopeV1, extra: Partial<TurnInput> = {}) {
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
      language: 'en',
      arm: 'A',
      entities: [TASK],
      ...extra,
    },
    { arm: 'A', interpret: async () => ({ ok: true, envelope: value, reads: [], usage: { calls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 }, specialist: null, promptHash: 'phase43' }) },
  );
}

function move(opId: string, dependsOn: string[] = [], constraints: SemanticConstraintV1[] = []): SemanticOperationV1 {
  return operation({
    opId,
    action: 'move',
    target: { kind: 'existing', proposedId: 'task-1', description: 'Звіт' },
    dependsOn,
    constraints,
  });
}

function create(opId: string, title = 'Bread', constraints: SemanticConstraintV1[] = []): SemanticOperationV1 {
  return operation({ opId, action: 'create', target: { kind: 'new', localId: opId }, changes: { title }, constraints });
}

function commands(result: PipelineResult) {
  return (result.response.intents ?? []).flatMap((intent) => (intent.type === 'command' ? [intent.command] : []));
}

function creates(result: PipelineResult) {
  return (result.response.intents ?? []).flatMap((intent) => (intent.type === 'create' ? [intent.task] : []));
}

function item(id: string, name: string): PlanItem {
  return { id, taskId: null, source: 'new', name, durationMinutes: 30, preferredHm: null, earliestHm: null, deadlineHm: null };
}

function planDraft(items: PlanItem[]): PlanDraft {
  return { day: '2026-10-19', stage: 'review', interviewAsked: 0, items, revision: 1, nextNewId: items.length + 1, lastProposal: null };
}

function seated(startIso: string): PlacementPlan {
  const start = new Date(startIso);
  return { outcome: 'seated', start, end: new Date(start.getTime() + 30 * 60_000), moves: [] } as unknown as PlacementPlan;
}

describe('Phase 4.3 dependency repair', () => {
  it('keeps a dependency on a successfully held operation until that operation is preserved', async () => {
    const session = openSession('dep-held');
    const first = await turn(session, envelope([
      create('c1'),
      move('m1', ['c1']),
    ]));
    expect(first.response.outcome).toBe('clarify');
    expect(first.response.intents).toEqual([]);
    expect(session.heldIntents).toHaveLength(1);
    expect(session.adaptedOpIds).toEqual(['c1']);

    const second = await turn(session, envelope([move('m1', ['c1'], [clock('start', '10:00')])], 'answer_pending'));
    expect(second.response.outcome).toBe('confirm');
    expect(creates(second)).toHaveLength(1);
    expect(commands(second).map((command) => command.kind)).toEqual(['move']);
    expect(session.pendingIntents).toHaveLength(2);
  });

  it('never treats a canceled prerequisite as successful', async () => {
    const session = openSession('dep-canceled');
    const first = await turn(session, envelope([
      operation({ opId: 'c1', action: 'create', target: { kind: 'new', localId: 'c1' }, changes: { title: 'Letter' } }),
      operation({ opId: 'd1', action: 'delete', target: { kind: 'operation_result', opId: 'c1' } }),
      move('m1', ['c1'], [clock('start', '10:00')]),
    ]));
    expect(first.response.outcome).toBe('clarify');
    expect(commands(first)).toEqual([]);
    expect(first.blocked).toContain('prerequisite_canceled');

    const second = await turn(session, envelope([move('m1', ['c1'], [clock('start', '11:00')])], 'answer_pending'));
    expect(second.response.outcome).toBe('clarify');
    expect(second.response.intents).toEqual([]);
    expect(second.blocked).toContain('prerequisite_canceled');
  });

  it('keeps a dependency on an operation that does not exist', async () => {
    const session = openSession('dep-missing');
    const first = await turn(session, envelope([move('m1', ['ghost'], [clock('start', '10:00')])]));
    expect(first.response.outcome).toBe('clarify');
    expect(first.blocked).toContain('missing_dependency');
    const second = await turn(session, envelope([move('m1', ['ghost'], [clock('start', '10:00')])], 'answer_pending'));
    expect(second.response.outcome).toBe('clarify');
    expect(second.response.intents).toEqual([]);
    expect(second.blocked).toContain('missing_dependency');
  });

  it('keeps a dependency on another operation that is still blocked', async () => {
    const session = openSession('dep-blocked');
    const first = await turn(session, envelope([move('a1'), move('b1', ['a1'])]));
    expect(first.response.outcome).toBe('clarify');
    const second = await turn(session, envelope([
      move('a1'),
      move('b1', ['a1'], [clock('start', '10:00')]),
    ], 'answer_pending'));
    expect(second.response.outcome).toBe('clarify');
    expect(second.response.intents).toEqual([]);
    expect(second.blocked).toEqual(expect.arrayContaining(['insufficient_move', 'prerequisite_failed']));
  });

  it('preserves mixed dependency statuses and does not duplicate a held sibling', async () => {
    const session = openSession('dep-mixed');
    const first = await turn(session, envelope([
      create('held'),
      operation({ opId: 'gone', action: 'create', target: { kind: 'new', localId: 'gone' }, changes: { title: 'Letter' } }),
      operation({ opId: 'drop', action: 'delete', target: { kind: 'operation_result', opId: 'gone' } }),
      move('m1', ['held', 'gone'], [clock('start', '10:00')]),
    ]));
    expect(first.response.intents).toEqual([]);
    expect(session.heldIntents).toHaveLength(1);
    const second = await turn(session, envelope([move('m1', ['held', 'gone'], [clock('start', '10:00')])], 'answer_pending'));
    expect(second.response.outcome).toBe('clarify');
    expect(second.response.intents).toEqual([]);
    expect(session.heldIntents).toHaveLength(1);
    expect(second.blocked).toContain('prerequisite_canceled');
  });

  it('validates a dependency introduced by the clarification answer', async () => {
    const session = openSession('dep-answer');
    await turn(session, envelope([create('held'), move('m1')]));
    const introduced = await turn(session, envelope([move('m1', ['ghost'], [clock('start', '10:00')])], 'answer_pending'));
    expect(introduced.response.outcome).toBe('clarify');
    expect(introduced.response.intents).toEqual([]);
    expect(introduced.blocked).toContain('missing_dependency');
    expect(session.heldIntents.filter((intent) => intent.type === 'create')).toHaveLength(1);
  });

  it('does not emit an executable intent when the prerequisite failed', async () => {
    const session = openSession('dep-failed');
    const result = await turn(session, envelope([
      operation({ opId: 'bad', action: 'update', target: { kind: 'existing', proposedId: 'task-1', description: 'Звіт' } }),
      move('m1', ['bad'], [clock('start', '10:00')]),
    ]));
    expect(result.response.outcome).toBe('clarify');
    expect(result.response.intents).toEqual([]);
    expect(result.blocked).toContain('prerequisite_failed');
  });
});

describe('Phase 4.3 semantic preservation', () => {
  it('keeps location, status, and a reminder on a create, and blocks an unrepresentable reminder', async () => {
    const located = await turn(openSession('create-location'), envelope([
      operation({ opId: 'c1', action: 'create', target: { kind: 'new', localId: 'c1' }, changes: { title: 'Dentist', location: 'Clinic' } }),
    ]));
    expect(located.response.outcome).toBe('confirm');
    expect(creates(located)[0]?.location).toBe('Clinic');

    const status = await turn(openSession('create-status'), envelope([
      operation({ opId: 'c1', action: 'create', target: { kind: 'new', localId: 'c1' }, changes: { title: 'Dentist', status: 'completed' } }),
    ]));
    expect(creates(status)[0]?.status).toBe('completed');

    const reminder = await turn(openSession('create-reminder'), envelope([
      operation({ opId: 'c1', action: 'create', target: { kind: 'new', localId: 'c1' }, changes: { title: 'Dentist', reminder: { op: 'create', name: 'Call' } } }),
    ]));
    expect(reminder.response.outcome).toBe('clarify');
    expect(reminder.response.intents).toEqual([]);
    expect(reminder.blocked).toContain('missing_day');
  });

  it('blocks a recurrence expression instead of emitting isRecurring', async () => {
    const result = await turn(openSession('create-recurrence'), envelope([
      operation({
        opId: 'c1',
        action: 'create',
        target: { kind: 'new', localId: 'c1' },
        changes: { title: 'Standup' },
        constraints: [{ kind: 'recurrence', expression: 'every Monday' }],
      }),
    ]));
    expect(result.response.outcome).toBe('clarify');
    expect(result.response.intents).toEqual([]);
    expect(JSON.stringify(result.response)).not.toContain('"isRecurring":true');
    expect(result.blocked).toContain('unrepresented_constraint');
  });

  it('blocks move constraints that the move command cannot carry', async () => {
    for (const extra of [
      { changes: { location: 'Office' }, constraints: [] as SemanticConstraintV1[] },
      { changes: { status: 'canceled' as const }, constraints: [] as SemanticConstraintV1[] },
      { changes: {}, constraints: [{ kind: 'recurrence' as const, expression: 'daily' }] },
      { changes: {}, constraints: [{ kind: 'ordering' as const, relation: 'after' as const, target: { kind: 'existing' as const, description: 'Lunch' } }] },
    ]) {
      const result = await turn(openSession('move-block'), envelope([
        operation({
          opId: 'm1',
          action: 'move',
          target: { kind: 'existing', proposedId: 'task-1', description: 'Звіт' },
          changes: extra.changes,
          constraints: [clock('start', '10:00'), ...extra.constraints],
        }),
      ]));
      expect(result.response.outcome).toBe('clarify');
      expect(result.response.intents).toEqual([]);
      expect(result.blocked).toContain('unrepresented_constraint');
    }
  });

  it('still previews a fully supported create, move, update, and delete', async () => {
    const created = await turn(openSession('ok-create'), envelope([
      operation({
        opId: 'c1',
        action: 'create',
        target: { kind: 'new', localId: 'c1' },
        changes: { title: 'Bread', priority: 'high' },
        constraints: [clock('start', '10:00'), { kind: 'duration', minutes: 30 }],
      }),
    ]));
    expect(created.response.outcome).toBe('confirm');
    expect(creates(created)[0]?.name).toBe('Bread');

    const moved = await turn(openSession('ok-move'), envelope([move('m1', [], [clock('start', '10:00')])]));
    expect(commands(moved)[0]?.kind).toBe('move');
    expect(commands(moved)[0]?.scheduledStartTime).toBe(clockIso('2026-10-18', '10:00'));

    const updated = await turn(openSession('ok-update'), envelope([
      operation({
        opId: 'u1',
        action: 'update',
        target: { kind: 'existing', proposedId: 'task-1', description: 'Звіт' },
        changes: { title: 'Report', location: 'Office' },
      }),
    ]));
    expect(commands(updated)[0]?.patch).toMatchObject({ name: 'Report', location: 'Office' });

    const removed = await turn(openSession('ok-delete'), envelope([
      operation({ opId: 'd1', action: 'delete', target: { kind: 'existing', proposedId: 'task-1', description: 'Звіт' } }),
    ]));
    expect(commands(removed)[0]?.kind).toBe('delete');
  });

  it('blocks the whole operation when supported and unsupported constraints are mixed', async () => {
    const result = await turn(openSession('mixed'), envelope([
      operation({
        opId: 'c1',
        action: 'create',
        target: { kind: 'new', localId: 'c1' },
        changes: { title: 'Standup', location: 'Room' },
        constraints: [clock('start', '10:00'), { kind: 'recurrence', expression: 'daily' }],
      }),
    ]));
    expect(result.response.outcome).toBe('clarify');
    expect(result.response.intents).toEqual([]);
    expect(JSON.stringify(result.response)).not.toContain('Room');
  });
});

describe('Phase 4.3 day plan repair', () => {
  const context = { tasks: [] as Task[], slots: [], timeZone: ZONE, nowIso: NOW, defaultDurationMinutes: 30 };

  it('attaches a qualitative label to the item applyPlanEdits actually created', async () => {
    const session = openSession('labels');
    session.planDraft = { day: '2026-10-19', stage: 'interview', interviewAsked: 0, items: [], revision: 0, nextNewId: 1, lastProposal: null };
    const result = await turn(session, {
      version: '1',
      kind: 'day_plan',
      operations: [],
      dayPlan: {
        phase: 'edit',
        edits: [
          { op: 'add_task', name: 'Bread', durationMinutes: 30, preferredHm: null, earliestHm: null, deadlineHm: null },
          { op: 'add_task', name: 'Walk', durationMinutes: 30, preferredHm: null, earliestHm: null, deadlineHm: null, qualitative: 'evening' },
        ],
      },
    }, { planContext: context });
    const bread = session.planDraft?.items.find((row) => row.name === 'Bread');
    const walk = session.planDraft?.items.find((row) => row.name === 'Walk');
    expect(bread?.id).toBe('new:1');
    expect(walk?.id).toBe('new:2');
    expect(session.qualitativeByItemId[bread!.id]).toBeUndefined();
    expect(session.qualitativeByItemId[walk!.id]).toBe('evening');
    expect(result.preservedLabels).toContain('evening');
  });

  it('keeps a mapped morning preferred start as a window instead of clearing it', async () => {
    const session = openSession('pref-morning');
    session.planDraft = planDraft([item('new:1', 'Walk')]);
    const seen: { draft: PlanDraft | null } = { draft: null };
    await turn(session, {
      version: '1',
      kind: 'day_plan',
      operations: [],
      dayPlan: { phase: 'apply', edits: [{ op: 'set_preferred_start', itemId: 'new:1', hm: null, qualitative: 'morning' }] },
    }, {
      planContext: context,
      proposeDay: async (_userId, draft) => {
        seen.draft = draft;
        return {
          day: draft.day,
          stage: 'review',
          revision: 1,
          items: [],
          unplaced: draft.items.map((row) => ({ itemId: row.id, name: row.name, reason: 'no_room' as const })),
          changedItemIds: [],
        };
      },
    });
    expect(seen.draft?.items[0]?.earliestHm).toBe('08:00');
    expect(seen.draft?.items[0]?.deadlineHm).toBe('11:00');
    expect(session.qualitativeByItemId['new:1']).toBe('morning');
  });

  it.each(['evening', 'night', 'after_lunch', 'after_work'] as const)('keeps an unresolved %s preferred start on the edited item', async (label) => {
    const session = openSession(`pref-${label}`);
    session.planDraft = planDraft([item('new:1', 'Walk')]);
    const calls: string[] = [];
    const result = await turn(session, {
      version: '1',
      kind: 'day_plan',
      operations: [],
      dayPlan: { phase: 'apply', edits: [{ op: 'set_preferred_start', itemId: 'new:1', hm: null, qualitative: label }] },
    }, {
      planContext: context,
      proposeDay: async () => {
        calls.push('propose');
        return { day: '2026-10-19', stage: 'review', revision: 1, items: [], unplaced: [], changedItemIds: [] };
      },
    });
    expect(result.response.outcome).toBe('refuse');
    expect(result.blocked).toContain('unmapped_time');
    expect(result.preservedLabels).toContain(label);
    expect(session.qualitativeByItemId['new:1']).toBe(label);
    expect(calls).toEqual([]);
    expect(JSON.stringify(result.response)).not.toContain('18:00');
  });

  it('rejects an unknown include id during apply and describes a started draft', async () => {
    const session = openSession('include');
    const task = { id: 'task-9', name: 'Report', status: 'todo', isUnscheduled: true, isRecurring: false, createdAt: new Date('2026-10-01T00:00:00.000Z') } as Task;
    const started = await turn(session, { version: '1', kind: 'day_plan', operations: [], dayPlan: { phase: 'start', day: '2026-10-19' } }, {
      planContext: { ...context, tasks: [task] },
    });
    expect(started.response.plan?.items).toEqual([]);
    expect(started.response.plan?.unplaced).toEqual([]);

    const edited = await turn(session, {
      version: '1',
      kind: 'day_plan',
      operations: [],
      dayPlan: { phase: 'edit', edits: [{ op: 'include_task', taskId: 'missing' }] },
    }, { planContext: { ...context, tasks: [task] } });
    expect(edited.response.outcome).toBe('refuse');
    expect(edited.blocked).toContain('unknown_task');
    expect(session.planDraft?.items).toHaveLength(0);

    const applied = await turn(session, {
      version: '1',
      kind: 'day_plan',
      operations: [],
      dayPlan: { phase: 'apply', edits: [{ op: 'include_task', taskId: 'missing' }, { op: 'include_task', taskId: 'task-9' }] },
    }, { planContext: { ...context, tasks: [task] } });
    expect(applied.response.outcome).toBe('refuse');
    expect(applied.blocked).toContain('unknown_task');
    expect(applied.response.intents).toEqual([]);
    expect(session.planDraft?.items.map((row) => row.taskId)).not.toContain('missing');
  });

  it('rejects an inconsistent proposal and keeps an omitted draft item visible', async () => {
    const session = openSession('proposal');
    session.planDraft = planDraft([item('new:1', 'Bread'), item('new:2', 'Walk')]);
    const wrongDay = await turn(session, { version: '1', kind: 'day_plan', operations: [], dayPlan: { phase: 'apply' } }, {
      planContext: context,
      proposeDay: async () => ({ day: '2026-10-20', stage: 'review', revision: 1, items: [], unplaced: [], changedItemIds: [] }),
    });
    expect(wrongDay.blocked).toContain('proposal_day');
    expect(wrongDay.response.intents).toEqual([]);

    const unknown = await turn(session, { version: '1', kind: 'day_plan', operations: [], dayPlan: { phase: 'apply' } }, {
      planContext: context,
      proposeDay: async () => ({
        day: '2026-10-19',
        stage: 'review',
        revision: 1,
        items: [{ itemId: 'nope', taskId: null, source: 'new', name: 'Nope', start: '2026-10-19T07:00:00.000Z', end: '2026-10-19T07:30:00.000Z', durationMinutes: 30 }],
        unplaced: [],
        changedItemIds: [],
      }),
    });
    expect(unknown.blocked).toContain('proposal_unknown_item');
    expect(unknown.response.intents).toEqual([]);

    const duplicate = await turn(session, { version: '1', kind: 'day_plan', operations: [], dayPlan: { phase: 'apply' } }, {
      planContext: context,
      proposeDay: async () => ({
        day: '2026-10-19',
        stage: 'review',
        revision: 1,
        items: [
          { itemId: 'new:1', taskId: null, source: 'new', name: 'Bread', start: '2026-10-19T07:00:00.000Z', end: '2026-10-19T07:30:00.000Z', durationMinutes: 30 },
          { itemId: 'new:1', taskId: null, source: 'new', name: 'Bread', start: '2026-10-19T08:00:00.000Z', end: '2026-10-19T08:30:00.000Z', durationMinutes: 30 },
        ],
        unplaced: [],
        changedItemIds: [],
      } satisfies DayPlanProposal),
    });
    expect(duplicate.blocked).toContain('proposal_duplicate_item');
    expect(duplicate.response.intents).toEqual([]);

    const omitted = await turn(session, { version: '1', kind: 'day_plan', operations: [], dayPlan: { phase: 'apply' } }, {
      planContext: context,
      proposeDay: async () => ({
        day: '2026-10-19',
        stage: 'review',
        revision: 1,
        items: [{ itemId: 'new:1', taskId: null, source: 'new', name: 'Bread', start: '2026-10-19T07:00:00.000Z', end: '2026-10-19T07:30:00.000Z', durationMinutes: 30 }],
        unplaced: [],
        changedItemIds: ['new:1'],
      } satisfies DayPlanProposal),
    });
    expect(omitted.response.plan?.unplaced.map((row) => row.itemId)).toContain('new:2');
    expect(omitted.response.intents).toHaveLength(1);
    expect(omitted.blocked).toContain('proposal_omitted_item');
  });
});

describe('Phase 4.3 temporal and clarification repair', () => {
  it('keeps one day source with a clock and blocks two conflicting day sources', async () => {
    const dated = await turn(openSession('date-clock'), envelope([
      operation({
        opId: 'c1',
        action: 'create',
        target: { kind: 'new', localId: 'c1' },
        changes: { title: 'Bread' },
        constraints: [{ kind: 'date', value: '2026-10-20', precision: 'day' }, clock('start', '10:00')],
      }),
    ]));
    expect(creates(dated)[0]?.scheduledStartTime).toBe(clockIso('2026-10-20', '10:00'));

    const relative = await turn(openSession('relative-clock'), envelope([
      operation({
        opId: 'c1',
        action: 'create',
        target: { kind: 'new', localId: 'c1' },
        changes: { title: 'Bread' },
        constraints: [{ kind: 'relative_time', anchor: 'now', direction: 'after', amount: 1, unit: 'day' }, clock('start', '10:00')],
      }),
    ]));
    expect(creates(relative)[0]?.scheduledStartTime).toBe(clockIso('2026-10-19', '10:00'));

    for (const constraints of [
      [{ kind: 'date' as const, value: '2026-10-20', precision: 'day' as const }, { kind: 'relative_time' as const, anchor: 'now' as const, direction: 'after' as const, amount: 1, unit: 'day' as const }],
      [{ kind: 'weekday' as const, weekday: 5, which: 'next' as const }, { kind: 'relative_time' as const, anchor: 'now' as const, direction: 'after' as const, amount: 1, unit: 'day' as const }],
      [{ kind: 'date' as const, value: '2026-10-20', precision: 'day' as const }, { kind: 'date' as const, value: '2026-10-21', precision: 'day' as const }],
    ]) {
      const result = await turn(openSession('conflict-day'), envelope([
        operation({ opId: 'c1', action: 'create', target: { kind: 'new', localId: 'c1' }, changes: { title: 'Bread' }, constraints: [...constraints, clock('start', '10:00')] }),
      ]));
      expect(result.response.outcome).toBe('clarify');
      expect(result.response.intents).toEqual([]);
      expect(result.blocked).toContain('conflicting_day');
    }
  });

  it('merges constraints by identity and preserves fields the answer does not restate', async () => {
    const session = openSession('merge');
    await turn(session, envelope([
      operation({
        opId: 'c1',
        action: 'create',
        target: { kind: 'new', localId: 'c1' },
        changes: { title: 'Standup', reminder: { op: 'create', name: 'Ping', notificationTime: 'Call me' } },
        constraints: [
          { kind: 'ordering', relation: 'after', target: { kind: 'existing', description: 'Lunch' } },
          { kind: 'ordering', relation: 'before', target: { kind: 'existing', description: 'Dinner' } },
          { kind: 'weekday', weekday: 1, which: 'this' },
          { kind: 'weekday', weekday: 5, which: 'next' },
          { kind: 'recurrence', expression: 'every week' },
          { kind: 'duration', minutes: 30 },
          { kind: 'duration', minutes: 45 },
        ],
      }),
    ]));
    const answered = await turn(session, envelope([
      operation({
        opId: 'c1',
        action: 'create',
        target: { kind: 'new', localId: 'c1' },
        changes: { reminder: { op: 'create', notificationTime: 'Text me' } },
        constraints: [{ kind: 'recurrence', expression: 'every month' }],
        dependsOn: ['held'],
      }),
    ], 'answer_pending'));
    const stored = session.pendingClarification?.blocked.find((row) => row.operation.opId === 'c1')?.operation;
    expect(stored?.constraints.filter((row) => row.kind === 'ordering')).toHaveLength(2);
    expect(stored?.constraints.filter((row) => row.kind === 'weekday')).toHaveLength(2);
    expect(stored?.constraints.filter((row) => row.kind === 'duration')).toHaveLength(2);
    expect(stored?.constraints).toContainEqual({ kind: 'recurrence', expression: 'every month' });
    expect(stored?.constraints).not.toContainEqual({ kind: 'recurrence', expression: 'every week' });
    expect(stored?.changes.reminder).toMatchObject({ name: 'Ping', notificationTime: 'Text me' });
    expect(stored?.changes.title).toBe('Standup');
    expect(stored?.dependsOn).toContain('held');
    expect(answered.response.intents).toEqual([]);
  });

  it('opens a clarification that has a question and no operation', async () => {
    const session = openSession('standalone');
    const asked = await turn(session, { version: '1', kind: 'clarification', operations: [], clarification: { question: 'Which day?', operationIds: [], missing: [] } });
    expect(asked.response.outcome).toBe('clarify');
    expect(asked.response.intents).toEqual([]);
    expect(asked.serverWrites).toBe(0);
    expect(asked.blocked ?? []).not.toContain('clarification_without_operation');
    expect(session.openQuestion).toBe('Which day?');

    const answer = await turn(session, control('answer_pending'));
    expect(answer.response.outcome).toBe('clarify');
    expect(answer.blocked).toContain('answer_not_applied');

    const canceled = await turn(session, control('cancel_pending'));
    expect(canceled.response.outcome).toBe('answer');
    expect(session.openQuestion).toBeNull();

    const next = await turn(session, envelope([create('c1')]));
    expect(next.response.outcome).toBe('confirm');
    expect(creates(next)[0]?.name).toBe('Bread');
  });

  it('keeps an independent day-plan draft when an unrelated clarification is canceled', async () => {
    const session = openSession('cancel-plan');
    await turn(session, { version: '1', kind: 'day_plan', operations: [], dayPlan: { phase: 'start', day: '2026-10-19' } }, {
      planContext: { tasks: [{ id: 'task-9', name: 'Report', status: 'todo', isUnscheduled: true, isRecurring: false, createdAt: new Date('2026-10-01T00:00:00.000Z') } as Task], slots: [], timeZone: ZONE, nowIso: NOW, defaultDurationMinutes: 30 },
    });
    expect(session.planDraft?.items).toHaveLength(1);
    await turn(session, envelope([operation({ opId: 'c1', action: 'create', target: { kind: 'new', localId: 'c1' } })]));
    expect(session.openQuestion).toBeTruthy();
    const canceled = await turn(session, control('cancel_pending'));
    expect(canceled.response.outcome).toBe('answer');
    expect(session.openQuestion).toBeNull();
    expect(session.pendingClarification).toBeNull();
    expect(session.planDraft?.items).toHaveLength(1);

    const cycle = openSession('cycle');
    await turn(cycle, envelope([move('a1'), move('b1')]));
    const question = cycle.openQuestion;
    const cycled = await turn(cycle, envelope([move('a1', ['b1']), move('b1', ['a1'])], 'answer_pending'));
    expect(cycled.response.outcome).toBe('clarify');
    expect(cycled.blocked).toContain('cycle');
    expect(cycle.openQuestion).toBe(question);
    expect(cycle.pendingClarification?.blocked.map((row) => row.operation.opId).sort()).toEqual(['a1', 'b1']);
  });
});

describe('Phase 4.3 integration readiness', () => {
  it('previews both operations after clarification and does not execute a confirmation twice', async () => {
    const session = openSession('workflow');
    const first = await turn(session, envelope([create('c1', 'Bread'), move('m1')]));
    expect(first.response.outcome).toBe('clarify');
    expect(session.heldIntents).toHaveLength(1);
    expect(session.pendingIntents).toBeNull();

    const second = await turn(session, envelope([move('m1', [], [clock('start', '10:00')])], 'answer_pending'));
    expect(second.response.outcome).toBe('confirm');
    expect(creates(second).map((task) => task.name)).toEqual(['Bread']);
    expect(commands(second).map((command) => command.kind)).toEqual(['move']);
    expect(session.openQuestion).toBeNull();

    const confirmed = await turn(session, control('confirm_pending'));
    expect(confirmed.response.outcome).toBe('act');
    expect(confirmed.serverWrites).toBe(0);
    expect(creates(confirmed)).toHaveLength(1);
    expect(commands(confirmed)).toHaveLength(1);
    expect(session.pendingIntents).toBeNull();

    const again = await turn(session, control('confirm_pending'));
    expect(again.response.outcome).toBe('answer');
    expect(again.response.intents).toEqual([]);
  });

  it('converts a real day-planner proposal without writing a calendar', async () => {
    const placement = {
      previewSequence: async () => [seated('2026-10-19T07:00:00.000Z'), { outcome: 'conflict' } as PlacementPlan],
    };
    const planner = new VoiceDayPlanner(placement as never, { find: async () => [] } as never);
    const session = openSession('real-plan');
    session.planDraft = planDraft([item('new:1', 'Bread'), item('new:2', 'Walk')]);
    const result = await turn(session, { version: '1', kind: 'day_plan', operations: [], dayPlan: { phase: 'apply' } }, {
      planContext: { tasks: [], slots: [], timeZone: ZONE, nowIso: NOW, defaultDurationMinutes: 30 },
      proposeDay: (userId, draft, timeZone) => planner.propose(userId, draft, timeZone),
    });
    expect(result.response.outcome).toBe('confirm');
    expect(result.serverWrites).toBe(0);
    expect(result.response.plan?.items.map((row) => row.itemId)).toEqual(['new:1']);
    expect(result.response.plan?.unplaced).toEqual([{ itemId: 'new:2', name: 'Walk', reason: 'conflict' }]);
    expect(creates(result).map((task) => task.name)).toEqual(['Bread']);
  });

  it('keeps supported fields and blocks unsupported ones across representative operations', async () => {
    const reminder = await turn(openSession('remind'), envelope([
      operation({
        opId: 'r1',
        action: 'remind',
        target: { kind: 'new', localId: 'r1' },
        changes: { reminder: { op: 'create', name: 'Call', dueYmd: '2026-10-19', recurrencePattern: 'DAILY' } },
        constraints: [{ kind: 'recurrence', expression: 'daily' }],
      }),
    ]));
    expect(reminder.response.outcome).toBe('confirm');
    expect(commands(reminder)[0]?.kind).toBe('remind_create');

    const ordered = await turn(openSession('ordered'), envelope([
      operation({
        opId: 'u1',
        action: 'update',
        target: { kind: 'existing', proposedId: 'task-1', description: 'Звіт' },
        changes: { title: 'Report' },
        constraints: [{ kind: 'ordering', relation: 'after', target: { kind: 'existing', description: 'Lunch' } }],
      }),
    ]));
    expect(ordered.response.outcome).toBe('clarify');
    expect(ordered.response.intents).toEqual([]);
    expect(ordered.blocked).toContain('unrepresented_constraint');
  });
});
