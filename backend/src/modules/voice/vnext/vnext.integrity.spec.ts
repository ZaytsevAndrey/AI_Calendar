import { ReadBroker } from './broker/read-broker';
import type { SemanticEnvelopeV1, SemanticOperationV1 } from './contracts/types';
import { validateSemanticEnvelope } from './contracts/validate';
import { emptyTrace, redactSecrets, traceObserver } from './diagnostics/trace';
import { comparisonPlan } from './eval/live-run';
import { expectBlocked, expectFailClosed } from './eval/structured-test-harness';
import { runInterpreterA } from './interpreters/run-interpreter';
import type { LlmComplete } from './repair/repair';
import { runVNextTurn } from './pipeline';
import type { EntityRecord } from './reference/reference-resolver';
import { createSession } from './session/session';

const NOW = '2026-10-18T06:00:00.000Z';
const TASK: EntityRecord = {
  id: 'task-1',
  userId: 'user-1',
  type: 'task',
  name: 'Звіт',
  status: 'open',
  revision: 1,
  writable: true,
  calendarId: 'cal',
  googleEventId: 'g-task-1',
  scheduledStart: '2026-10-18T12:00:00.000Z',
  scheduledEnd: '2026-10-18T13:00:00.000Z',
};

function operation(partial: Pick<SemanticOperationV1, 'opId' | 'action' | 'target'> & Partial<SemanticOperationV1>): SemanticOperationV1 {
  return {
    changes: {},
    constraints: [],
    dependsOn: [],
    source: { text: 'hello' },
    ...partial,
  };
}

function envelope(operations: SemanticOperationV1[]): SemanticEnvelopeV1 {
  return { version: '1', kind: 'operations', operations };
}

async function turn(operations: SemanticOperationV1[], trace = emptyTrace({
  scenarioId: 'integrity',
  branch: 'A',
  model: 'scripted',
  modelParameters: {},
  clock: NOW,
  timezone: 'Europe/Kyiv',
})) {
  const session = createSession('user-1', 'integrity');
  const result = await runVNextTurn(
    {
      transcript: 'hello',
      userId: 'user-1',
      session,
      nowIso: NOW,
      timeZone: 'Europe/Kyiv',
      wakeHm: '08:00',
      sleepHm: '23:00',
      defaultDurationMinutes: 30,
      language: 'uk',
      entities: [TASK],
      arm: 'A',
      trace,
    },
    {
      arm: 'A',
      interpret: async () => ({
        ok: true,
        envelope: envelope(operations),
        reads: [],
        usage: { calls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 },
        specialist: null,
        promptHash: 'test',
      }),
    },
  );
  return { result, session, trace };
}

function scripted(responses: string[], users: string[]): LlmComplete {
  let index = 0;
  return {
    complete: async ({ user }) => {
      users.push(user);
      const text = responses[index] ?? responses[responses.length - 1];
      index += 1;
      return { text, inputTokens: 1, outputTokens: 1, latencyMs: 1 };
    },
  };
}

const TRANSCRIPT = 'hello';

function readRequest(requestId: string) {
  return { requestId, name: 'get_day_agenda', args: { day: '2026-10-18' } };
}

function withRead(reads: Array<{ requestId: string; name: string; args: Record<string, unknown> }>) {
  return JSON.stringify({
    version: '1',
    kind: 'operations',
    operations: [{
      opId: 'op-1',
      action: 'create',
      target: { kind: 'new', localId: 'local-1' },
      changes: { title: 'Note' },
      constraints: [],
      dependsOn: [],
      source: { text: TRANSCRIPT },
    }],
    requestedReads: reads,
  });
}

const ANSWER = JSON.stringify({ version: '1', kind: 'answer', operations: [], answer: { text: 'done' } });

describe('read tool facts', () => {
  it('passes a populated result, an empty result, and a failure without sibling fields', async () => {
    const users: string[] = [];
    const executor = jest.fn(async (name: string) => {
      if (name === 'list_unscheduled') return { items: [] };
      if (name === 'find_free_gaps') return { error: 'timeout', items: [{ start: '10:00' }] };
      return { items: [{ id: 'task-9', title: 'Standup' }] };
    });
    await runInterpreterA(
      scripted([
        withRead([
          readRequest('r-populated'),
          { requestId: 'r-empty', name: 'list_unscheduled', args: {} },
          { requestId: 'r-failed', name: 'find_free_gaps', args: { day: '2026-10-18' } },
        ]),
        ANSWER,
      ], users),
      new ReadBroker(executor),
      'hello',
      TRANSCRIPT,
    );
    const followUp = users[1];
    expect(followUp).toContain('Standup');
    expect(followUp).toContain('"requestId":"r-empty"');
    expect(followUp).toContain('"items":[]');
    expect(followUp).toContain('"requestId":"r-failed"');
    expect(followUp).toContain('timeout');
    expect(followUp).not.toContain('10:00');
    expect(followUp).toContain('"args"');
  });

  it('marks a missing result instead of inventing an empty calendar', async () => {
    const users: string[] = [];
    await runInterpreterA(
      scripted([withRead([readRequest('r-missing')]), ANSWER], users),
      new ReadBroker(async () => undefined),
      'hello',
      TRANSCRIPT,
    );
    expect(users[1]).toContain('missing_result');
    expect(users[1]).not.toContain('"result"');
  });

  it('withholds a large result instead of clipping it', async () => {
    const users: string[] = [];
    const marker = 'UNIQUE_PAYLOAD_MARKER';
    await runInterpreterA(
      scripted([withRead([readRequest('r-large')]), ANSWER], users),
      new ReadBroker(async () => ({ items: [{ title: marker.repeat(400) }] })),
      'hello',
      TRANSCRIPT,
    );
    expect(users[1]).toContain('result_too_large');
    expect(users[1]).not.toContain('UNIQUE_PAYLOAD_MARKER');
  });

  it('keeps the first result when a later reply asks for another read', async () => {
    const users: string[] = [];
    const output = await runInterpreterA(
      scripted([withRead([readRequest('r-1')]), withRead([{ requestId: 'r-2', name: 'list_reminders', args: {} }])], users),
      new ReadBroker(async () => ({ items: [{ title: 'Standup' }] })),
      'hello',
      TRANSCRIPT,
    );
    expect(users[1]).toContain('Standup');
    expect(users[1]).toContain('r-1');
    expect(output.ok).toBe(false);
    expect(output.code).toBe('tool_limit');
    expect(output.reads.find((read) => read.requestId === 'r-1')?.result).toEqual({ items: [{ title: 'Standup' }] });
  });

  it('refuses an answer when the read failed or the result was withheld', async () => {
    const failed = await runVNextTurn(
      {
        transcript: 'hello',
        userId: 'user-1',
        session: createSession('user-1', 'failed-read'),
        nowIso: NOW,
        timeZone: 'Europe/Kyiv',
        wakeHm: '08:00',
        sleepHm: '23:00',
        defaultDurationMinutes: 30,
        language: 'uk',
        entities: [],
        arm: 'A',
      },
      {
        arm: 'A',
        interpret: async () => ({
          ok: true,
          envelope: { version: '1', kind: 'answer', operations: [], answer: { text: 'Календар порожній' } },
          reads: [{ requestId: 'r-1', name: 'get_day_agenda', args: { day: '2026-10-18' }, ok: false, error: 'timeout' }],
          usage: { calls: 1, inputTokens: 1, outputTokens: 1, latencyMs: 1 },
          specialist: null,
          promptHash: 'test',
        }),
      },
    );
    expect(failed.response.outcome).toBe('refuse');
    expect(failed.response.assistantMessage).not.toContain('порожній');
    expect(failed.blocked).toContain('tool_error');
    expect(failed.serverWrites).toBe(0);

    const withheld = await runVNextTurn(
      {
        transcript: 'hello',
        userId: 'user-1',
        session: createSession('user-1', 'withheld-read'),
        nowIso: NOW,
        timeZone: 'Europe/Kyiv',
        wakeHm: '08:00',
        sleepHm: '23:00',
        defaultDurationMinutes: 30,
        language: 'uk',
        entities: [],
        arm: 'A',
      },
      {
        arm: 'A',
        interpret: async () => ({
          ok: true,
          envelope: { version: '1', kind: 'answer', operations: [], answer: { text: 'Немає подій' } },
          reads: [{ requestId: 'r-1', name: 'get_day_agenda', args: {}, ok: true, withheld: 'result_too_large' as const }],
          usage: { calls: 1, inputTokens: 1, outputTokens: 1, latencyMs: 1 },
          specialist: null,
          promptHash: 'test',
        }),
      },
    );
    expect(withheld.response.outcome).toBe('refuse');
    expect(withheld.blocked).toEqual(['result_too_large']);
    expect(withheld.serverWrites).toBe(0);
  });
});

describe('operation integrity', () => {
  it('does not turn a move without a start into an update', async () => {
    const { result, session } = await turn([
      operation({ opId: 'op-1', action: 'move', target: { kind: 'existing', proposedId: 'task-1', description: 'Звіт' } }),
    ]);
    expectFailClosed(result, { intents: 0, blocked: 'insufficient_move' });
    expect(JSON.stringify(session.heldIntents)).not.toContain('"kind":"update"');
    expect(JSON.stringify(result.response.intents)).not.toContain('"kind":"update"');
  });

  it('keeps an evening label and does not invent 18:00', async () => {
    const { result } = await turn([
      operation({
        opId: 'op-1',
        action: 'move',
        target: { kind: 'existing', proposedId: 'task-1', description: 'Звіт' },
        constraints: [{ kind: 'time_of_day', label: 'evening', bound: 'at' }],
      }),
    ]);
    expectBlocked(result, 'unmapped_time');
    expect(result.response.intents).toEqual([]);
    expect(JSON.stringify(result.response)).not.toContain('18:00');
  });

  it('rejects an empty patch and a schedule the update command cannot carry', async () => {
    const empty = await turn([
      operation({ opId: 'op-1', action: 'update', target: { kind: 'existing', proposedId: 'task-1', description: 'Звіт' } }),
    ]);
    // Expected structured invariant: empty field update must not preview. Currently may confirm — keep assertion.
    expect(empty.result.blocked).toEqual(['empty_patch']);
    expect(empty.result.response.intents).toEqual([]);

    const clock = await turn([
      operation({
        opId: 'op-1',
        action: 'update',
        target: { kind: 'existing', proposedId: 'task-1', description: 'Звіт' },
        constraints: [
          { kind: 'date', value: '2026-10-18', precision: 'day' },
          { kind: 'clock', value: '10:00', role: 'start' },
        ],
      }),
    ]);
    expect(clock.result.response.outcome).toBe('confirm');
    expect(JSON.stringify(clock.result.response)).toContain('scheduledStartTime');
    expect(clock.result.blocked).toEqual([]);
  });

  it('still emits a move when the start instant is present', async () => {
    const { result } = await turn([
      operation({
        opId: 'op-1',
        action: 'move',
        target: { kind: 'existing', proposedId: 'task-1', description: 'Звіт' },
        constraints: [
          { kind: 'date', value: '2026-10-18', precision: 'day' },
          { kind: 'clock', value: '10:00', role: 'start' },
        ],
      }),
    ]);
    expect(result.response.outcome).toBe('confirm');
    expect(result.response.intents).toHaveLength(1);
    expect(result.response.intents[0]).toMatchObject({ type: 'command', command: { kind: 'move' } });
    expect(JSON.stringify(result.response.intents[0])).not.toContain('"kind":"update"');
  });
});

describe('operation dependencies', () => {
  it('folds a later edit of a new object and does not invent a database id', async () => {
    const moved = await turn([
      operation({ opId: 'op-1', action: 'create', target: { kind: 'new', localId: 'local-1' }, changes: { title: 'Звіт' } }),
      operation({
        opId: 'op-2',
        action: 'move',
        target: { kind: 'operation_result', opId: 'op-1' },
        dependsOn: ['op-1'],
        constraints: [
          { kind: 'date', value: '2026-10-18', precision: 'day' },
          { kind: 'clock', value: '11:00', role: 'start' },
        ],
      }),
    ]);
    expect(moved.result.response.intents).toHaveLength(1);
    expect(moved.result.response.intents[0].type).toBe('create');
    expect(JSON.stringify(moved.result.response.intents)).not.toContain('"taskId":"task-');

    const edited = await turn([
      operation({ opId: 'op-1', action: 'create', target: { kind: 'new', localId: 'local-1' }, changes: { title: 'Чернетка' } }),
      operation({
        opId: 'op-2',
        action: 'update',
        target: { kind: 'operation_result', opId: 'op-1' },
        dependsOn: ['op-1'],
        changes: { title: 'Звіт' },
        constraints: [{ kind: 'duration', minutes: 60 }],
      }),
      operation({
        opId: 'op-3',
        action: 'update',
        target: { kind: 'operation_result', opId: 'op-1' },
        dependsOn: ['op-1'],
        changes: { priority: 'high' },
      }),
    ]);
    expect(edited.result.response.intents).toHaveLength(1);
    expect(edited.result.response.intents[0]).toMatchObject({
      type: 'create',
      task: { name: 'Звіт', estimatedTimeInMinutes: 60, priority: 'high' },
    });
  });

  it('keeps a reminder of a new object as a separate intent without a database id', async () => {
    const { result } = await turn([
      operation({ opId: 'op-1', action: 'create', target: { kind: 'new', localId: 'local-1' }, changes: { title: 'Звіт' } }),
      operation({
        opId: 'op-2',
        action: 'remind',
        target: { kind: 'operation_result', opId: 'op-1' },
        dependsOn: ['op-1'],
        changes: { reminder: { op: 'create', name: 'Звіт', dueYmd: '2026-10-19' } },
      }),
    ]);
    expect(result.response.outcome).toBe('confirm');
    expect(result.response.intents).toHaveLength(2);
    const reminder = result.response.intents[1];
    expect(reminder).toMatchObject({ type: 'command', command: { kind: 'remind_create', name: 'Звіт' } });
    expect(JSON.stringify(reminder)).not.toContain('reminderId');
    expect(JSON.stringify(reminder)).not.toContain('taskId');
  });

  it('cancels a create that is deleted in the same turn', async () => {
    const { result } = await turn([
      operation({ opId: 'op-1', action: 'create', target: { kind: 'new', localId: 'local-1' }, changes: { title: 'Звіт' } }),
      operation({
        opId: 'op-2',
        action: 'delete',
        target: { kind: 'operation_result', opId: 'op-1' },
        dependsOn: ['op-1'],
      }),
    ]);
    expect(result.response.outcome).toBe('answer');
    expect(result.response.intents).toEqual([]);
    expect(result.blocked).toEqual([]);
  });

  it('blocks a dependent when its prerequisite fails and holds an unrelated operation', async () => {
    const failed = await turn([
      operation({ opId: 'op-1', action: 'create', target: { kind: 'new', localId: 'local-1' } }),
      operation({
        opId: 'op-2',
        action: 'remind',
        target: { kind: 'operation_result', opId: 'op-1' },
        dependsOn: ['op-1'],
        changes: { reminder: { op: 'create', name: 'Звіт', dueYmd: '2026-10-19' } },
      }),
    ]);
    expect(failed.result.response.intents).toEqual([]);
    expect(failed.result.blocked).toEqual(['missing_title', 'prerequisite_failed']);
    expect(JSON.stringify(failed.session.heldIntents)).not.toContain('remind_create');

    const missing = await turn([
      operation({ opId: 'op-1', action: 'create', target: { kind: 'new', localId: 'local-1' }, changes: { title: 'Звіт' } }),
      operation({
        opId: 'op-2',
        action: 'update',
        target: { kind: 'operation_result', opId: 'op-missing' },
        dependsOn: ['op-missing'],
        changes: { title: 'Інше' },
      }),
    ]);
    expect(missing.result.response.outcome).toBe('clarify');
    expect(missing.result.response.intents).toEqual([]);
    expect(missing.result.blocked).toEqual(['missing_dependency']);
    expect(missing.result.blocked).not.toContain('cycle');
    expect(missing.session.heldIntents).toHaveLength(1);
    expect(missing.session.heldIntents[0].type).toBe('create');

    const cycle = await turn([
      operation({ opId: 'op-1', action: 'create', target: { kind: 'new', localId: 'local-1' }, changes: { title: 'А' }, dependsOn: ['op-2'] }),
      operation({ opId: 'op-2', action: 'create', target: { kind: 'new', localId: 'local-2' }, changes: { title: 'Б' }, dependsOn: ['op-1'] }),
    ]);
    expect(cycle.result.response.outcome).toBe('refuse');
    expect(cycle.result.blocked).toEqual(['cycle']);
    expect(cycle.result.response.intents).toEqual([]);
  });

  it('rejects a repeated operation id before any intent is built', async () => {
    const raw = JSON.stringify(envelope([
      operation({ opId: 'op-1', action: 'create', target: { kind: 'new', localId: 'local-1' }, changes: { title: 'А' } }),
      operation({ opId: 'op-1', action: 'create', target: { kind: 'new', localId: 'local-2' }, changes: { title: 'Б' } }),
    ]));
    const parsed = validateSemanticEnvelope(raw, 'hello');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors.some((error) => error.code === 'duplicate_op')).toBe(true);

    const { result, session } = await turn([
      operation({ opId: 'op-1', action: 'create', target: { kind: 'new', localId: 'local-1' }, changes: { title: 'А' } }),
      operation({ opId: 'op-1', action: 'create', target: { kind: 'new', localId: 'local-2' }, changes: { title: 'Б' } }),
      operation({ opId: 'op-3', action: 'create', target: { kind: 'new', localId: 'local-3' }, changes: { title: 'В' } }),
    ]);
    expect(result.response.intents).toEqual([]);
    expect(result.blocked.filter((code) => code === 'duplicate_op')).toHaveLength(2);
    expect(session.heldIntents).toHaveLength(1);
    expect(session.heldIntents[0]).toMatchObject({ type: 'create', task: { name: 'В' } });
  });

  it('does not bind an operation_result that cannot be folded', async () => {
    const { result } = await turn([
      operation({
        opId: 'op-1',
        action: 'update',
        target: { kind: 'existing', proposedId: 'task-1', description: 'Звіт' },
        changes: { title: 'Новий звіт' },
      }),
      operation({
        opId: 'op-2',
        action: 'move',
        target: { kind: 'operation_result', opId: 'op-1' },
        dependsOn: ['op-1'],
        constraints: [{ kind: 'clock', value: '12:00', role: 'start' }],
      }),
    ]);
    expect(result.response.intents).toEqual([]);
    expectBlocked(result, 'unsupported_binding');
    expect(JSON.stringify(result.response)).not.toContain('task-invented');
    expect(result.serverWrites).toBe(0);
  });
});

describe('benchmark trace', () => {
  it('records every stage of a blocked operation without a model call', async () => {
    const trace = emptyTrace({
      scenarioId: 'integrity-trace',
      branch: 'A',
      model: 'scripted',
      modelParameters: { temperature: 0.1 },
      clock: NOW,
      timezone: 'Europe/Kyiv',
    });
    const { result } = await turn([
      operation({
        opId: 'op-1',
        action: 'move',
        target: { kind: 'existing', proposedId: 'task-1', description: 'Звіт' },
        constraints: [{ kind: 'time_of_day', label: 'evening', bound: 'at' }],
      }),
    ], trace);
    expect(result.response.intents).toEqual([]);
    expect(trace.llmCalls).toEqual([]);
    expectBlocked(result, 'unmapped_time');
    expect(JSON.stringify(result.response)).not.toContain('18:00');
    expect(result.serverWrites).toBe(0);
    // V1 emitted per-stage adapter traces; structured may not fill the same arrays yet (document if empty).
    expect(trace.semanticOperations).toHaveLength(1);
    expect(trace.dependencyResolution).toHaveLength(1);
    expect(trace.referenceResolution).toHaveLength(1);
    expect(trace.policyDecisions).toHaveLength(1);
    expect(trace.adapterResults).toEqual([
      expect.objectContaining({ opId: 'op-1', intent: null }),
    ]);
    expect(trace.previewPayload).toEqual([]);
    expect(result.response.outcome).toBe('clarify');
  });

  it('keeps the trace when a model call fails after a tool result', async () => {
    const trace = emptyTrace({
      scenarioId: 'integrity-throw',
      branch: 'A',
      model: 'scripted',
      modelParameters: {},
      clock: NOW,
      timezone: 'Europe/Kyiv',
    });
    let calls = 0;
    const llm: LlmComplete = {
      complete: async () => {
        calls += 1;
        if (calls === 1) return { text: withRead([readRequest('r-1')]), inputTokens: 3, outputTokens: 4, latencyMs: 5 };
        throw new Error('Bearer sk-supersecretkey down');
      },
    };
    await expect(runInterpreterA(
      llm,
      new ReadBroker(async () => ({ items: [{ title: 'Standup' }] })),
      'hello',
      TRANSCRIPT,
      traceObserver(trace),
      (records) => {
        records.forEach((record) => trace.toolExecutions.push({
          request: { requestId: record.requestId, name: record.name, args: record.args },
          result: record.result ?? null,
          error: record.error ?? null,
        }));
      },
    )).rejects.toThrow('down');
    expect(trace.llmCalls).toHaveLength(2);
    expect(trace.llmCalls[0].rawResponse).toContain('r-1');
    expect(trace.llmCalls[0].tokenUsage).toEqual({ inputTokens: 3, outputTokens: 4 });
    expect(trace.llmCalls[1].error).toContain('[redacted]');
    expect(trace.llmCalls[1].error).not.toContain('supersecretkey');
    expect(trace.schemaValidation[0]).toMatchObject({ valid: true, errors: [] });
    expect(trace.toolExecutions[0].result).toEqual({ items: [{ title: 'Standup' }] });
    expect(redactSecrets('sk-supersecretkey')).toBe('[redacted]');
  });

  it('describes the next comparison without calling a model', () => {
    const plan = comparisonPlan();
    expect(plan.liveCalls).toBe(0);
    expect(plan.edgeCases).toHaveLength(39);
    expect(plan.originalScenarios).toBe(77);
    expect(plan.originalScenariosAreNotSemanticOracle).toBe(true);
    expect(plan.traces).toBe(true);
    expect(plan.arms).toEqual(['legacy', 'A', 'B']);
  });
});
