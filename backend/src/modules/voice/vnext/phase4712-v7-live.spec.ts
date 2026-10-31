/**
 * V7 (31 Oct 2026): defects reproduced from the first live DeepSeek baseline, each with the envelope the
 * model actually produced. Mocked interpreter, no model call. Every test here was red before its fix.
 */
import { createSession } from './session/session';
import { runVNextTurn, type InterpretOutput, type TurnInput, type VNextInterpreter } from './pipeline';
import type { SemanticEnvelopeV1, SemanticOperationV1 } from './contracts/types';
import type { EntityRecord } from './reference/reference-resolver';

const USER = 'user-1';
const NOW = '2026-10-18T06:00:00.000Z'; // Sunday 09:00 Kyiv
const TZ = 'Europe/Kyiv';

type Session = ReturnType<typeof createSession>;

function interpreter(output: SemanticEnvelopeV1): VNextInterpreter {
  return {
    arm: 'A',
    async interpret(): Promise<InterpretOutput> {
      return { ok: true, specialist: 'test', promptHash: 'v7', usage: { calls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 }, reads: [], envelope: output };
    },
  };
}

function base(session: Session, entities: EntityRecord[], extra: Partial<TurnInput> = {}): TurnInput {
  return {
    transcript: 'turn', userId: USER, session, nowIso: NOW, timeZone: TZ, wakeHm: '08:00', sleepHm: '23:00',
    defaultDurationMinutes: 30, defaultReminderTime: '09:00', language: 'uk', entities, arm: 'A', ...extra,
  };
}

function op(partial: Partial<SemanticOperationV1> & Pick<SemanticOperationV1, 'opId' | 'action' | 'target'>): SemanticOperationV1 {
  return { changes: {}, constraints: [], dependsOn: [], source: { text: partial.opId }, ...partial };
}
const ops = (list: SemanticOperationV1[]): SemanticEnvelopeV1 => ({ version: '1', kind: 'operations', operations: list });
const task = (id: string, name: string, extra: Partial<EntityRecord> = {}): EntityRecord => ({ id, userId: USER, type: 'task', name, status: 'open', revision: 1, writable: true, ...extra });
const report = task('task-report', 'Звіт', { unscheduled: true });
const gym = task('task-gym', 'Спортзал', {
  recurring: true, seriesEventId: null,
  occurrences: [
    { start: '2026-10-19T07:00:00.000Z', end: '2026-10-19T08:00:00.000Z', googleEventId: null, slotId: 's-19' },
    { start: '2026-10-21T07:00:00.000Z', end: '2026-10-21T08:00:00.000Z', googleEventId: null, slotId: 's-21' },
  ],
});

type Result = Awaited<ReturnType<typeof runVNextTurn>>;
const outcome = (result: Result) => `${result.response.outcome} blocked=${result.blocked.join(',')} msg=${result.response.assistantMessage}`;
const command = (result: Result, index = 0) => {
  const intent = result.response.intents[index];
  if (!intent || intent.type !== 'command') throw new Error(`no command at ${index}: ${JSON.stringify(result.response)} blocked=${result.blocked}`);
  return intent.command as Record<string, unknown>;
};
const create = (result: Result, index = 0) => {
  const intent = result.response.intents[index];
  if (!intent || intent.type !== 'create') throw new Error(`no create at ${index}: ${JSON.stringify(result.response)} blocked=${result.blocked}`);
  return intent.task as Record<string, unknown>;
};

describe('V7 live defects — corrections of a pending command on a stored task (g-a-37, g-b-10, g-b-15, g-b-30, g-c-20)', () => {
  it('a correction addressed to the pending move by its id replaces that move, on the same task', async () => {
    const session = createSession(USER, 'v7-1');
    await runVNextTurn(base(session, [report], { transcript: 'перенеси звіт на понеділок' }), interpreter(ops([
      op({ opId: 'op-1', action: 'move', target: { kind: 'existing', proposedId: 'task-report' }, constraints: [{ kind: 'weekday', weekday: 1, which: 'next' }] }),
    ])));
    const corrected = await runVNextTurn(base(session, [report], { transcript: 'а, не понеділок, на вівторок о 13:05' }), interpreter(ops([
      op({ opId: 'op-1', action: 'move', target: { kind: 'operation_result', opId: 'pop_1' }, constraints: [{ kind: 'weekday', weekday: 2, which: 'next' }, { kind: 'clock', value: '13:05', role: 'start' }] }),
    ])));
    expect(outcome(corrected)).toMatch(/^confirm/);
    expect(corrected.response.intents).toHaveLength(1);
    expect(command(corrected)).toMatchObject({ kind: 'update', taskId: 'task-report', patch: { isUnscheduled: false, scheduledStartTime: '2026-10-20T10:05:00.000Z' } });
    expect(JSON.stringify(corrected.response.intents)).not.toContain('2026-10-19');
  });

  it('a different verb addressed to the pending operation replaces it: the Saturday move becomes a completion', async () => {
    const session = createSession(USER, 'v7-2');
    await runVNextTurn(base(session, [report]), interpreter(ops([
      op({ opId: 'op-1', action: 'move', target: { kind: 'existing', proposedId: 'task-report' }, constraints: [{ kind: 'weekday', weekday: 6, which: 'next' }] }),
    ])));
    const completed = await runVNextTurn(base(session, [report]), interpreter(ops([
      op({ opId: 'op-1', action: 'complete', target: { kind: 'operation_result', opId: 'pop_1' } }),
    ])));
    expect(outcome(completed)).toMatch(/^confirm/);
    expect(completed.response.intents).toHaveLength(1);
    expect(command(completed)).toMatchObject({ kind: 'complete', taskId: 'task-report' });
  });

  it('a rename and a length addressed to the pending update of a Later task fold into it', async () => {
    const idea = task('task-idea', 'Ідея для блогу');
    const session = createSession(USER, 'v7-3');
    await runVNextTurn(base(session, [idea]), interpreter(ops([
      op({ opId: 'op-1', action: 'update', target: { kind: 'existing', proposedId: 'task-idea' }, constraints: [{ kind: 'weekday', weekday: 6, which: 'next' }, { kind: 'clock', value: '11:00', role: 'start' }] }),
    ])));
    const renamed = await runVNextTurn(base(session, [idea]), interpreter(ops([
      op({ opId: 'op-1', action: 'update', target: { kind: 'operation_result', opId: 'pop_1' }, changes: { title: 'Чернетка посту' } }),
    ])));
    expect(outcome(renamed)).toMatch(/^confirm/);
    expect(command(renamed)).toMatchObject({ kind: 'update', taskId: 'task-idea', patch: { name: 'Чернетка посту', scheduledStartTime: '2026-10-24T08:00:00.000Z' } });
    const longer = await runVNextTurn(base(session, [idea]), interpreter(ops([
      op({ opId: 'op-1', action: 'update', target: { kind: 'operation_result', opId: 'pop_1' }, constraints: [{ kind: 'duration', minutes: 50 }] }),
    ])));
    expect(longer.response.intents).toHaveLength(1);
    expect(command(longer)).toMatchObject({ kind: 'update', taskId: 'task-idea', patch: { name: 'Чернетка посту', estimatedTimeInMinutes: 50 } });
  });
});

describe('V7 live defects — cancelling the only pending operation (g-a-38, g-b-16, g-c-20)', () => {
  it('a cancel addressed to the only pending create withdraws the preview instead of showing an empty one', async () => {
    const session = createSession(USER, 'v7-4');
    await runVNextTurn(base(session, []), interpreter(ops([op({ opId: 'op-1', action: 'create', target: { kind: 'new', localId: 'n' }, changes: { title: 'Перевірити пошту' } })])));
    const canceled = await runVNextTurn(base(session, []), interpreter(ops([op({ opId: 'op-1', action: 'cancel', target: { kind: 'operation_result', opId: 'pop_1' } })])));
    expect(canceled.response.outcome).toBe('answer');
    expect(canceled.response.assistantMessage).toBe('Скасував незастосовану дію.');
    expect(canceled.response.intents).toEqual([]);
    expect(session.structured?.preview?.executionState).not.toBe('open');
    expect(session.pendingIntents ?? []).toEqual([]);
  });

  it('a cancel addressed to the only pending command on a stored task withdraws it the same way', async () => {
    const session = createSession(USER, 'v7-5');
    await runVNextTurn(base(session, [report]), interpreter(ops([
      op({ opId: 'op-1', action: 'move', target: { kind: 'existing', proposedId: 'task-report' }, constraints: [{ kind: 'weekday', weekday: 6, which: 'next' }] }),
    ])));
    const canceled = await runVNextTurn(base(session, [report]), interpreter(ops([op({ opId: 'op-1', action: 'cancel', target: { kind: 'operation_result', opId: 'pop_1' } })])));
    expect(canceled.response.outcome).toBe('answer');
    expect(canceled.response.intents).toEqual([]);
    expect(session.structured?.preview?.executionState).not.toBe('open');
  });
});

describe('V7 live defects — a correction replaces the day or the part of day it corrects (g-b-18, g-b-19)', () => {
  it('a new date replaces a pending weekday instead of standing beside it', async () => {
    const session = createSession(USER, 'v7-6');
    await runVNextTurn(base(session, []), interpreter(ops([
      op({ opId: 'op-1', action: 'create', target: { kind: 'new', localId: 'n' }, changes: { title: 'здати ключі' }, constraints: [{ kind: 'weekday', weekday: 5, which: 'next' }] }),
    ])));
    const corrected = await runVNextTurn(base(session, []), interpreter(ops([
      op({ opId: 'op-1', action: 'update', target: { kind: 'operation_result', opId: 'pop_1' }, constraints: [{ kind: 'date', value: '2026-10-30', precision: 'day' }] }),
    ])));
    expect(outcome(corrected)).toMatch(/^confirm/);
    expect(create(corrected)).toMatchObject({ earliestStartTime: '2026-10-30T08:00:00+02:00' });
    expect(JSON.stringify(corrected.response.intents)).not.toContain('2026-10-23');
  });

  it('an exact clock replaces a pending part of day', async () => {
    const session = createSession(USER, 'v7-7');
    await runVNextTurn(base(session, []), interpreter(ops([
      op({ opId: 'op-1', action: 'create', target: { kind: 'new', localId: 'n' }, changes: { title: 'купити газету' }, constraints: [{ kind: 'weekday', weekday: 1, which: 'next' }, { kind: 'time_of_day', label: 'morning', bound: 'at' }] }),
    ])));
    const corrected = await runVNextTurn(base(session, []), interpreter(ops([
      op({ opId: 'op-1', action: 'update', target: { kind: 'operation_result', opId: 'pop_1' }, constraints: [{ kind: 'clock', value: '08:10', role: 'start' }] }),
    ])));
    expect(outcome(corrected)).toMatch(/^confirm/);
    expect(create(corrected)).toMatchObject({ scheduledStartTime: '2026-10-19T05:10:00.000Z' });
    expect(corrected.response.assistantMessage).not.toContain('Час доби');
  });
});

describe('V7 live defects — one day of a series named by its day (g-d-05, g-d-06, g-d-08, en-d-03, en-d-04)', () => {
  it('a day the user named is that occurrence: rename, done, move and delete need no separate scope', async () => {
    const run = (operation: SemanticOperationV1) => runVNextTurn(base(createSession(USER, `v7-${operation.opId}`), [gym, report]), interpreter(ops([operation])));
    const renamed = await run(op({ opId: 'r1', action: 'update', target: { kind: 'existing', proposedId: 'task-gym' }, changes: { title: 'йога' }, constraints: [{ kind: 'weekday', weekday: 1, which: 'next' }] }));
    expect(outcome(renamed)).toMatch(/^confirm/);
    expect(command(renamed)).toMatchObject({ kind: 'edit_occurrence', scope: 'occurrence', occurrenceStart: '2026-10-19T07:00:00.000Z', name: 'йога' });
    const done = await run(op({ opId: 'r2', action: 'complete', target: { kind: 'existing', proposedId: 'task-gym' }, constraints: [{ kind: 'weekday', weekday: 1, which: 'next' }] }));
    expect(command(done)).toMatchObject({ kind: 'edit_occurrence', scope: 'occurrence', status: 'completed', occurrenceStart: '2026-10-19T07:00:00.000Z' });
    const moved = await run(op({ opId: 'r3', action: 'move', target: { kind: 'existing', proposedId: 'task-gym' }, constraints: [{ kind: 'weekday', weekday: 1, which: 'next' }, { kind: 'clock', value: '19:00', role: 'start' }] }));
    expect(command(moved)).toMatchObject({ kind: 'move', slotId: 's-19', seriesScope: 'occurrence', start: '2026-10-19T16:00:00.000Z' });
    const dropped = await run(op({ opId: 'r4', action: 'delete', target: { kind: 'existing', proposedId: 'task-gym' }, constraints: [{ kind: 'date', value: '2026-10-21', precision: 'day' }] }));
    expect(command(dropped)).toMatchObject({ kind: 'skip', occurrenceStart: '2026-10-21T07:00:00.000Z' });
    const whole = await run(op({ opId: 'r5', action: 'delete', target: { kind: 'existing', proposedId: 'task-gym' } }));
    expect(whole.response.outcome).toBe('clarify');
    expect(whole.blocked).toContain('missing_series_scope');
  });
});

describe('V7 live defects — model output the validator refused but the contract can read (7 scenarios)', () => {
  it('a date constraint without precision is a day; operation_result with proposedId names the pending id', async () => {
    const session = createSession(USER, 'v7-8');
    await runVNextTurn(base(session, []), interpreter(ops([
      op({ opId: 'op-1', action: 'create', target: { kind: 'new', localId: 'n' }, changes: { title: 'call with Sam' }, constraints: [{ kind: 'date', value: '2026-10-19', precision: 'day' }, { kind: 'clock', value: '15:00', role: 'start' }] }),
    ])));
    const corrected = await runVNextTurn(base(session, []), interpreter(ops([
      op({ opId: 'op-1', action: 'update', target: { kind: 'operation_result', proposedId: 'pop_1' } as never, constraints: [{ kind: 'date', value: '2026-10-19' } as never, { kind: 'clock', value: '16:00', role: 'start' }] }),
    ])));
    expect(corrected.blocked).not.toContain('invalid_model_output');
    expect(outcome(corrected)).toMatch(/^confirm/);
    expect(create(corrected)).toMatchObject({ scheduledStartTime: '2026-10-19T13:00:00.000Z' });
  });
});

describe('V7 live defects — reminders (g-a-15, g-d-11, en-d-06)', () => {
  it('a reminder create whose day and clock are repeated as constraints is previewed once, at that clock', async () => {
    const result = await runVNextTurn(base(createSession(USER, 'v7-9'), []), interpreter(ops([
      op({
        opId: 'op-1', action: 'create', target: { kind: 'new', localId: 'rem-1' },
        changes: { title: 'перевірити страховку', reminder: { op: 'create', name: 'перевірити страховку', dueYmd: '2026-10-27', notificationTime: '08:20' } },
        constraints: [{ kind: 'date', value: '2026-10-27', precision: 'day' }, { kind: 'clock', value: '08:20', role: 'start' }],
      }),
    ])));
    expect(outcome(result)).toMatch(/^confirm/);
    expect(result.response.intents).toHaveLength(1);
    expect(command(result)).toMatchObject({ kind: 'remind_create', dueYmd: '2026-10-27', notificationTime: '08:20' });
  });

  it('an update of a stored reminder through changes.reminder is a reminder update, not a refused task write', async () => {
    const rent: EntityRecord = {
      id: 'rem-rent', userId: USER, type: 'reminder', name: 'Оплата оренди', status: 'open', revision: 1, writable: true,
      reminder: { dueYmd: '2026-10-20', notificationTime: '18:00', description: null, recurrencePattern: null, recurrenceWeekDays: null },
    };
    const result = await runVNextTurn(base(createSession(USER, 'v7-10'), [rent]), interpreter(ops([
      op({ opId: 'op-1', action: 'update', target: { kind: 'existing', proposedId: 'rem-rent', description: 'оренду' }, changes: { reminder: { op: 'update', notificationTime: '20:00' } } }),
    ])));
    expect(outcome(result)).toMatch(/^confirm/);
    expect(command(result)).toMatchObject({ kind: 'remind_update', reminderId: 'rem-rent', dueYmd: '2026-10-20', notificationTime: '20:00', name: 'Оплата оренди' });
  });
});

describe('V7 live defects — a part of day on a dated create (g-a-02, g-a-13, g-a-33, g-b-08, g-b-19)', () => {
  it('a day with a part of day is a task on that day with the label kept and no clock invented', async () => {
    const result = await runVNextTurn(base(createSession(USER, 'v7-11'), []), interpreter(ops([
      op({ opId: 'op-1', action: 'create', target: { kind: 'new', localId: 'n' }, changes: { title: 'віднести пакунок на пошту' }, constraints: [{ kind: 'weekday', weekday: 6, which: 'next' }, { kind: 'time_of_day', label: 'morning', bound: 'at' }] }),
    ])));
    expect(outcome(result)).toMatch(/^confirm/);
    expect(create(result)).toMatchObject({ earliestStartTime: '2026-10-24T08:00:00+03:00', deadline: '2026-10-24T23:00:00+03:00', isUnscheduled: false });
    expect(create(result)).not.toHaveProperty('scheduledStartTime');
    expect(result.response.assistantMessage).toContain('Час доби');
  });
});

describe('V7 live defects — a clock with no day (en-c-01)', () => {
  it('a clock still ahead today is today; a clock already past is a question', async () => {
    const ahead = await runVNextTurn(base(createSession(USER, 'v7-12'), []), interpreter(ops([
      op({ opId: 'op-1', action: 'create', target: { kind: 'new', localId: 'a' }, changes: { title: 'call mom' }, constraints: [{ kind: 'clock', value: '10:00', role: 'start' }] }),
      op({ opId: 'op-2', action: 'create', target: { kind: 'new', localId: 'b' }, changes: { title: 'call mom' }, constraints: [{ kind: 'clock', value: '15:00', role: 'start' }] }),
    ])));
    expect(ahead.response.outcome).toBe('confirm');
    expect(ahead.response.intents.map((intent) => (intent.type === 'create' ? intent.task.scheduledStartTime : null))).toEqual(['2026-10-18T07:00:00.000Z', '2026-10-18T12:00:00.000Z']);
    const past = await runVNextTurn(base(createSession(USER, 'v7-13'), []), interpreter(ops([
      op({ opId: 'op-1', action: 'create', target: { kind: 'new', localId: 'a' }, changes: { title: 'call mom' }, constraints: [{ kind: 'clock', value: '08:00', role: 'start' }] }),
    ])));
    expect(past.response.outcome).toBe('clarify');
    expect(past.response.assistantMessage).toBe('Ця година вже минула. Назвіть день.');
  });
});
