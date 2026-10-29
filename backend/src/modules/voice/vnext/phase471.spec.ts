import { localDateTimeIso } from '../voice-local-date.util';
import { ScheduleState, TaskStatus, type Task } from '../../tasks/entities/task.entity';
import type { ScheduledTask } from '../../schedule/schedule.entity';
import type { UserSettings } from '../../user-settings/entities/user-settings.entity';
import { VoiceAgentTools, type VoiceToolContext } from '../voice-agent.tools';
import { ApplyOutcomeError, applyPreview, resumeLedger } from './apply/apply-preview';
import type { SemanticEnvelopeV1, SemanticOperationV1 } from './contracts/types';
import { errorCategory } from './errors';
import { scoreSemanticOutcome } from './eval/semantic-outcome';
import { summarizeSemanticGold } from './eval/semantic-gold';
import { runVNextTurn, type TurnInput } from './pipeline';
import { withStructuredConfirmation } from './eval/structured-test-turn';
import { domainReadExecutor } from './read/domain-executor';
import { ReadBroker } from './broker/read-broker';
import { runInterpreterA } from './interpreters/run-interpreter';
import type { EntityRecord } from './reference/reference-resolver';
import { createSession, exportSession, intentKey, restoreSession, type VNextSession } from './session/session';

const NOW = '2026-10-18T06:00:00.000Z';

function operation(partial: Partial<SemanticOperationV1> & Pick<SemanticOperationV1, 'opId' | 'action' | 'target'>): SemanticOperationV1 {
  return { changes: {}, constraints: [], dependsOn: [], source: { text: partial.opId }, ...partial };
}

function createOp(opId: string, title: string, constraints: SemanticOperationV1['constraints'] = []): SemanticOperationV1 {
  return operation({
    opId,
    action: 'create',
    target: { kind: 'new', localId: opId },
    changes: { title },
    constraints,
    source: { text: title },
  });
}

function envelope(operations: SemanticOperationV1[]): SemanticEnvelopeV1 {
  return { version: '1', kind: 'operations', operations };
}

function scripted(value: SemanticEnvelopeV1) {
  return {
    arm: 'A' as const,
    interpret: async () => ({
      ok: true as const,
      envelope: value,
      reads: [],
      usage: { calls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 },
      specialist: null,
      promptHash: 'phase471',
    }),
  };
}

async function turn(session: VNextSession, value: SemanticEnvelopeV1, extra: Partial<TurnInput> = {}) {
  extra = withStructuredConfirmation(session, value, extra);
  return runVNextTurn(
    {
      transcript: extra.transcript ?? (value.control === 'confirm_pending' ? 'Так' : 'hello'),
      userId: 'user-1',
      session,
      nowIso: NOW,
      timeZone: 'Europe/Kyiv',
      wakeHm: '08:00',
      sleepHm: '23:00',
      defaultDurationMinutes: 30,
      language: 'uk',
      arm: 'A',
      entities: extra.entities ?? [],
      ...extra,
    },
    scripted(value),
  );
}

function createIntent(summary: string) {
  return { type: 'create' as const, summary, task: { name: summary } };
}

describe('Phase 4.7.1 apply safety', () => {
  it('records success only after the write resolves and retries a failed write', async () => {
    const ledger = new Map();
    const writes: string[] = [];
    let fail = true;
    const item = { intent: createIntent('Зустріч') };
    const failed = await applyPreview({
      items: [item],
      ledger,
      write: async () => {
        if (fail) throw new Error('provider_unavailable');
        writes.push('Зустріч');
      },
    });
    expect(failed.results[0].status).toBe('failed');
    expect(writes).toEqual([]);
    fail = false;
    const retried = await applyPreview({
      items: [item],
      ledger,
      write: async () => { writes.push('Зустріч'); },
    });
    expect(retried.results[0].status).toBe('succeeded');
    expect(writes).toEqual(['Зустріч']);
  });

  it('rejects before execution and does not retry an unknown outcome', async () => {
    const ledger = new Map();
    const item = { intent: createIntent('Дзвінок') };
    const before = await applyPreview({
      items: [item],
      ledger,
      write: async () => { throw new ApplyOutcomeError('failed', 'timeout_before'); },
    });
    expect(before.results[0]).toMatchObject({ status: 'failed', error: 'timeout_before' });
    let calls = 0;
    const afterLedger = new Map();
    const after = await applyPreview({
      items: [item],
      ledger: afterLedger,
      write: async () => {
        calls += 1;
        throw new ApplyOutcomeError('unknown', 'timeout_after');
      },
    });
    expect(after.results[0].status).toBe('unknown');
    const retry = await applyPreview({
      items: [item],
      ledger: afterLedger,
      write: async () => { calls += 1; },
    });
    expect(retry.results[0]).toMatchObject({ status: 'skipped', error: 'unknown_apply' });
    expect(calls).toBe(1);
  });

  it('lets one in-flight apply proceed and reports the rest of a broken batch', async () => {
    const ledger = new Map();
    const first = createIntent('Чернетка');
    const second = createIntent('Ревʼю');
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let calls = 0;
    const running = applyPreview({
      items: [{ intent: first }],
      ledger,
      write: async () => {
        calls += 1;
        await gate;
      },
    });
    const concurrent = await applyPreview({
      items: [{ intent: first }],
      ledger,
      write: async () => { calls += 1; },
    });
    expect(concurrent.results[0]).toMatchObject({ status: 'skipped', error: 'in_flight' });
    release();
    expect((await running).results[0].status).toBe('succeeded');
    expect(calls).toBe(1);

    const batch = new Map();
    const written: string[] = [];
    const partial = await applyPreview({
      items: [{ intent: first }, { intent: second, dependsOn: [intentKey(first)] }],
      ledger: batch,
      write: async (intent) => {
        if (intent.summary === 'Чернетка') throw new Error('provider_unavailable');
        written.push(intent.summary);
      },
    });
    expect(partial.results.map((row) => row.status)).toEqual(['failed', 'blocked']);
    expect(written).toEqual([]);
  });

  it('treats an interrupted pending write as unknown', () => {
    const ledger = resumeLedger([{ key: 'k1', status: 'pending' }]);
    expect(ledger.get('k1')?.status).toBe('unknown');
  });
});

describe('Phase 4.7.1 calendar reads', () => {
  function context(tasks: Task[], slots: ScheduledTask[]): VoiceToolContext {
    return {
      userId: 'user-1',
      timeZone: 'Europe/Kyiv',
      nowIso: NOW,
      settings: { wakeTime: '08:00', sleepTime: '23:00' } as UserSettings,
      tasks,
      slots,
      phases: [],
      reminders: [{ name: 'Ліки', dueYmd: '2026-10-18', overdueDays: 0, notificationTime: '20:00', recurrencePattern: null }],
    };
  }

  const meeting = { id: 'task-1', name: 'Зустріч', status: TaskStatus.TODO, isUnscheduled: false, scheduleState: ScheduleState.NONE } as Task;
  const parked = { id: 'task-2', name: 'Чернетка', status: TaskStatus.TODO, isUnscheduled: true, scheduleState: ScheduleState.PROBLEMATIC } as Task;
  const slot = {
    taskId: 'task-1',
    scheduledStartTime: new Date('2026-10-18T07:00:00.000Z'),
    scheduledEndTime: new Date('2026-10-18T08:00:00.000Z'),
  } as ScheduledTask;

  it('reads agenda, next item, named task, unscheduled, gaps, and reminders through VoiceAgentTools', async () => {
    const tools = new VoiceAgentTools({ listVisibleEvents: async () => [] } as never);
    const execute = domainReadExecutor(tools, context([meeting, parked], [slot]), async () => undefined);
    const agenda = await execute('get_day_agenda', { day: '2026-10-18' }) as { count: number; items: Array<{ name: string }> };
    expect(agenda.count).toBe(1);
    expect(agenda.items[0].name).toBe('Зустріч');
    const empty = await execute('get_day_agenda', { day: '2026-10-19' }) as { count: number; error?: string };
    expect(empty.count).toBe(0);
    expect(empty.error).toBeUndefined();
    const next = await execute('get_now_next', {}) as { next: { name: string } | null };
    expect(next.next?.name).toBe('Зустріч');
    const named = await execute('match_task', { query: 'Зустріч' }) as { matches: Array<{ taskId: string }> };
    expect(named.matches.map((row) => row.taskId)).toEqual(['task-1']);
    const unscheduled = await execute('list_unscheduled', {}) as { items: Array<{ name: string }> };
    expect(unscheduled.items.map((row) => row.name)).toEqual(['Чернетка']);
    const problematic = await execute('list_problematic', {}) as { items: Array<{ name: string }> };
    expect(problematic.items.map((row) => row.name)).toEqual(['Чернетка']);
    const gaps = await execute('find_free_gaps', { day: '2026-10-18' }) as { gaps: unknown[]; error?: string };
    expect(gaps.error).toBeUndefined();
    expect(gaps.gaps.length).toBeGreaterThan(0);
    const reminders = await execute('list_reminders', {}) as { reminders: Array<{ name: string }> };
    expect(reminders.reminders[0].name).toBe('Ліки');
    const missing = await execute('get_task', { taskId: 'missing' }) as { error?: string };
    expect(missing.error).toBeTruthy();
  });

  it('reports a provider failure instead of an empty day and keeps the local day boundary', async () => {
    const tools = new VoiceAgentTools({ listVisibleEvents: async () => { throw new Error('timeout'); } } as never);
    const execute = domainReadExecutor(tools, context([meeting], [slot]), async () => {
      throw new Error('timeout');
    });
    const failed = await execute('get_day_agenda', { day: '2026-10-18' }) as { error?: string; items?: unknown[] };
    expect(failed.error).toBe('provider_timeout');
    expect(failed.items).toBeUndefined();
    const late = { taskId: 'task-1', scheduledStartTime: new Date('2026-10-18T22:00:00.000Z'), scheduledEndTime: new Date('2026-10-18T22:30:00.000Z') } as ScheduledTask;
    const local = new VoiceAgentTools({ listVisibleEvents: async () => [] } as never);
    const today = await domainReadExecutor(local, context([meeting], [late]), async () => undefined)('get_day_agenda', { day: '2026-10-18' }) as { count: number };
    expect(today.count).toBe(0);
  });

  it('passes a VoiceAgentTools agenda through the read broker without inventing events', async () => {
    const tools = new VoiceAgentTools({ listVisibleEvents: async () => [] } as never);
    const interpreted = await runInterpreterA(
      { complete: async ({ user }) => ({
        text: user.includes('\nReads:')
          ? '{"version":"1","kind":"answer","operations":[],"answer":{"text":"Завтра немає подій.","evidenceRefs":["r1"]}}'
          : '{"version":"1","kind":"answer","operations":[],"requestedReads":[{"requestId":"r1","name":"get_day_agenda","args":{"day":"2026-10-19"}}],"answer":{"text":"","evidenceRefs":[]}}',
        inputTokens: 1,
        outputTokens: 1,
        latencyMs: 1,
      }) },
      new ReadBroker(domainReadExecutor(tools, context([], []), async () => undefined)),
      'user',
      'Що в мене завтра?',
    );
    expect(interpreted.ok).toBe(true);
    expect(interpreted.reads[0]).toMatchObject({ name: 'get_day_agenda', ok: true });
    expect(interpreted.reads[0].result).toMatchObject({ count: 0, items: [] });
    expect(interpreted.envelope?.answer?.text).toContain('немає');
  });
});

describe('Phase 4.7.1 conversation and calendar identity', () => {
  it('merges a same-title correction and cancels one pending item without dropping the other', async () => {
    const session = createSession('user-1', 'correct');
    const created = await turn(session, envelope([
      createOp('op-1', 'Зустріч', [{ kind: 'date', value: '2026-10-19', precision: 'day' }, { kind: 'clock', value: '10:00', role: 'start' }]),
      createOp('op-2', 'Звіт', [{ kind: 'date', value: '2026-10-19', precision: 'day' }]),
    ]));
    expect(created.response.intents).toHaveLength(2);
    const moved = await turn(session, envelope([
      createOp('op-9', 'Зустріч', [{ kind: 'date', value: '2026-10-23', precision: 'day' }, { kind: 'clock', value: '15:00', role: 'start' }]),
    ]));
    expect(moved.response.outcome).toBe('confirm');
    expect(moved.response.intents).toHaveLength(2);
    const meeting = moved.response.intents.find((intent) => intent.summary === 'Зустріч');
    expect(meeting?.type).toBe('create');
    if (meeting?.type === 'create') {
      expect(Date.parse(String(meeting.task.scheduledStartTime))).toBe(Date.parse(localDateTimeIso('2026-10-23', '15:00', 'Europe/Kyiv')));
    }
    const canceled = await turn(session, envelope([
      operation({ opId: 'op-8', action: 'cancel', target: { kind: 'new', localId: 'op-8' }, changes: { title: 'Звіт' } }),
    ]));
    expect(canceled.response.outcome).toBe('confirm');
    expect(canceled.response.intents.map((intent) => intent.summary)).toEqual(['Зустріч']);
  });

  it('keeps both pending operations when a correction does not say which one', async () => {
    const session = createSession('user-1', 'which');
    await turn(session, envelope([
      createOp('op-1', 'Зустріч', [{ kind: 'date', value: '2026-10-19', precision: 'day' }]),
      createOp('op-2', 'Звіт', [{ kind: 'date', value: '2026-10-19', precision: 'day' }]),
    ]));
    const ambiguous = await turn(session, envelope([
      createOp('op-9', '', [{ kind: 'clock', value: '15:00', role: 'start' }]),
    ]));
    expect(ambiguous.response.outcome).toBe('clarify');
    expect(ambiguous.response.intents).toEqual([]);
    expect(session.pendingOperations).toHaveLength(2);
    expect(ambiguous.blocked).toContain('ambiguous_correction');
  });

  it('does not preview a bulk delete from an incomplete search', async () => {
    const entities: EntityRecord[] = [
      { id: 'task-a', userId: 'user-1', type: 'task', name: 'Нарада', status: 'open', calendarId: 'work' },
      { id: 'task-b', userId: 'user-1', type: 'task', name: 'Нарада', status: 'open', calendarId: 'work' },
    ];
    const truncated = await turn(createSession('user-1', 'bulk'), envelope([
      operation({
        opId: 'op-1',
        action: 'delete',
        target: { kind: 'existing', description: 'Нарада', calendarId: 'work' },
        scope: 'all',
      }),
    ]), { entities, searchReceipt: { complete: false, truncated: true, ids: ['task-a'] } });
    expect(truncated.response.intents).toEqual([]);
    expect(truncated.blocked).toContain('search_truncated');
    const complete = await turn(createSession('user-1', 'bulk-ok'), envelope([
      operation({
        opId: 'op-1',
        action: 'delete',
        target: { kind: 'existing', description: 'Нарада', calendarId: 'work' },
        scope: 'all',
      }),
    ]), { entities, searchReceipt: { complete: true, ids: ['task-a', 'task-b'] } });
    expect(complete.response.intents).toHaveLength(2);
  });

  it('uses the named calendar and stops when the provider row changed', async () => {
    const entities: EntityRecord[] = [
      { id: 'home-1', userId: 'user-1', type: 'task', name: 'Нарада', status: 'open', calendarId: 'home', revision: 1 },
      { id: 'work-1', userId: 'user-1', type: 'task', name: 'Нарада', status: 'open', calendarId: 'work', revision: 1 },
    ];
    const chosen = await turn(createSession('user-1', 'cal'), envelope([
      operation({
        opId: 'op-1',
        action: 'delete',
        target: { kind: 'existing', description: 'Нарада', calendarId: 'work' },
      }),
    ]), { entities });
    expect(chosen.response.intents).toHaveLength(1);
    expect(chosen.response.intents[0].type === 'command' ? chosen.response.intents[0].command.taskId : null).toBe('work-1');
    const ambiguous = await turn(createSession('user-1', 'cal-2'), envelope([
      operation({ opId: 'op-1', action: 'delete', target: { kind: 'existing', description: 'Нарада' } }),
    ]), { entities });
    expect(ambiguous.response.intents).toEqual([]);
    const readonly = await turn(createSession('user-1', 'cal-3'), envelope([
      operation({
        opId: 'op-1',
        action: 'delete',
        target: { kind: 'existing', proposedId: 'ext-1', description: 'Нарада' },
      }),
    ]), { entities: [{ id: 'ext-1', userId: 'user-1', type: 'external_event', name: 'Нарада', status: 'open', calendarId: 'work' }] });
    expect(readonly.response.intents).toEqual([]);
    expect(readonly.blocked).toContain('external_readonly');

    const session = createSession('user-1', 'fresh');
    const preview = await turn(session, envelope([
      operation({ opId: 'op-1', action: 'delete', target: { kind: 'existing', proposedId: 'work-1', description: 'Нарада', calendarId: 'work' } }),
    ]), { entities });
    expect(preview.response.outcome).toBe('confirm');
    const stale = await turn(session, { version: '1', kind: 'control', operations: [], control: 'confirm_pending' }, {
      entities,
      readEntity: async () => ({ exists: true, revision: 2, calendarId: 'work' }),
    });
    expect(stale.response.outcome).toBe('clarify');
    expect(stale.response.intents).toEqual([]);
    expect(stale.blocked).toContain('stale_provider');
    expect(stale.serverWrites).toBe(0);
  });

  it('restores a session without executing the pending write', () => {
    const session = createSession('user-1', 'resume');
    session.pendingIntents = [createIntent('Зустріч')];
    session.pendingOperations = [createOp('op-1', 'Зустріч')];
    session.applyLedger = [{ key: 'k1', status: 'pending' }];
    const raw = exportSession(session, NOW);
    const restored = restoreSession(raw, NOW);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.session.pendingIntents).toHaveLength(1);
    expect(restored.session.applyLedger[0].status).toBe('unknown');
    expect(restoreSession('not-json', NOW)).toEqual({ ok: false, reason: 'invalid' });
    const expired = exportSession(session, '2026-10-01T00:00:00.000Z');
    expect(restoreSession(expired, NOW).ok).toBe(false);
  });

  it('reissues a failed write and does not reissue an unknown one', async () => {
    const entities: EntityRecord[] = [{ id: 'work-1', userId: 'user-1', type: 'task', name: 'Нарада', status: 'open', revision: 1, calendarId: 'work' }];
    const deleteOp = envelope([
      operation({ opId: 'op-1', action: 'delete', target: { kind: 'existing', proposedId: 'work-1', description: 'Нарада', calendarId: 'work' } }),
    ]);
    const failed = createSession('user-1', 'retry-confirm');
    const preview = await turn(failed, deleteOp, { entities });
    expect(preview.response.outcome).toBe('confirm');
    const key = intentKey(preview.response.intents[0]);
    failed.applyLedger = [{ key, status: 'failed', error: 'provider_unavailable' }];
    const again = await turn(failed, { version: '1', kind: 'control', operations: [], control: 'confirm_pending' }, { entities });
    expect(again.response.outcome).toBe('act');
    expect(again.response.intents).toHaveLength(1);
    expect(again.serverWrites).toBe(0);

    const unknown = createSession('user-1', 'unknown-confirm');
    await turn(unknown, deleteOp, { entities });
    unknown.applyLedger = [{ key, status: 'unknown', error: 'interrupted' }];
    const held = await turn(unknown, { version: '1', kind: 'control', operations: [], control: 'confirm_pending' }, { entities });
    expect(held.response.outcome).toBe('answer');
    expect(held.response.intents).toEqual([]);
    expect(held.blocked).toContain('unknown_apply');
    expect(held.serverWrites).toBe(0);
  });
});

describe('Phase 4.7.1 semantic scoring and gold', () => {
  const left = { type: 'create', summary: 'Зустріч', task: { name: 'Зустріч', scheduledStartTime: '2026-10-19T07:00:00.000Z', estimatedTimeInMinutes: 30 } };
  const right = { type: 'create', summary: 'Звіт', task: { name: 'Звіт', scheduledStartTime: '2026-10-19T12:00:00.000Z', estimatedTimeInMinutes: 60 } };

  it('matches each expected operation to one actual operation', () => {
    const expectation = {
      acceptable: ['confirm' as const],
      operations: [
        { action: 'create' as const, name: 'Зустріч', scheduledStart: '2026-10-19T07:00:00.000Z', durationMinutes: 30 },
        { action: 'create' as const, name: 'Звіт', scheduledStart: '2026-10-19T12:00:00.000Z', durationMinutes: 60 },
      ],
    };
    expect(scoreSemanticOutcome({ schemaValid: true, outcome: 'confirm', intents: [right, left], blocked: [], serverWrites: 0, expectation }).correct).toBe(true);
    const swapped = scoreSemanticOutcome({
      schemaValid: true,
      outcome: 'confirm',
      intents: [
        { ...left, task: { ...left.task, scheduledStartTime: right.task.scheduledStartTime } },
        { ...right, task: { ...right.task, scheduledStartTime: left.task.scheduledStartTime } },
      ],
      blocked: [],
      serverWrites: 0,
      expectation,
    });
    expect(swapped.correct).toBe(false);
    expect(swapped.reason).toBe('wrong_time');
    const extra = scoreSemanticOutcome({ schemaValid: true, outcome: 'confirm', intents: [left], blocked: [], serverWrites: 0, expectation });
    expect(extra.reason).toBe('missing_operation');
    const refused = scoreSemanticOutcome({
      schemaValid: true,
      outcome: 'refuse',
      intents: [],
      blocked: ['unsupported_all_day'],
      serverWrites: 0,
      expectation: { acceptable: ['refuse'], refusalAllowed: true },
    });
    expect(refused.supportedExecution).toBe(false);
    expect(errorCategory('stale_provider')).toBe('stale_provider_entity');
    expect(errorCategory('unknown_apply')).toBe('unknown_apply_outcome');
  });

  it('counts field-level gold separately from unverified fixtures', () => {
    const summary = summarizeSemanticGold();
    expect(summary.fixtureCount).toBe(77);
    expect(summary.complete + summary.partial + summary.ambiguous + summary.unsupported + summary.unverified).toBe(summary.total);
    expect(summary.scored).toBe(summary.complete);
    expect(summary.unverified).toBeGreaterThan(0);
    expect(summary.complete).toBeGreaterThan(0);
  });
});
