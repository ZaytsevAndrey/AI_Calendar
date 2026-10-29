import { localDateTimeIso } from '../voice-local-date.util';
import { ScheduleState, TaskStatus, type Task } from '../../tasks/entities/task.entity';
import type { ScheduledTask } from '../../schedule/schedule.entity';
import type { UserSettings } from '../../user-settings/entities/user-settings.entity';
import { VoiceAgentTools, type VoiceToolContext } from '../voice-agent.tools';
import { applyPreview } from './apply/apply-preview';
import { frontendApplyRequest } from './apply/frontend-contract';
import { validateSemanticEnvelope } from './contracts/validate';
import type { SemanticEnvelopeV1, SemanticOperationV1 } from './contracts/types';
import { scoreSemanticOutcome } from './eval/semantic-outcome';
import { validateGoldCorpus } from './eval/field-gold';
import { ReadBroker } from './broker/read-broker';
import { runInterpreterA } from './interpreters/run-interpreter';
import { runVNextTurn, type TurnInput } from './pipeline';
import { withStructuredConfirmation } from './eval/structured-test-turn';
import { domainReadExecutor } from './read/domain-executor';
import type { EntityRecord } from './reference/reference-resolver';
import { receiptFromMatches, receiptFromPages, type SearchReceipt } from './search/receipt';
import { createSession, exportSession, intentKey, restoreSession, type VNextSession } from './session/session';

const NOW = '2026-10-18T06:00:00.000Z';

function operation(partial: Partial<SemanticOperationV1> & Pick<SemanticOperationV1, 'opId' | 'action' | 'target'>): SemanticOperationV1 {
  return { changes: {}, constraints: [], dependsOn: [], source: { text: partial.opId }, ...partial };
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
      promptHash: 'phase472',
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

const MEETINGS: EntityRecord[] = [
  { id: 'a', userId: 'user-1', type: 'task', name: 'Нарада', status: 'open', calendarId: 'work', revision: 1, googleEventId: 'g-a', scheduledStart: '2026-10-18T12:00:00.000Z', scheduledEnd: '2026-10-18T13:00:00.000Z', writable: true },
  { id: 'b', userId: 'user-1', type: 'task', name: 'Нарада', status: 'open', calendarId: 'work', revision: 1, googleEventId: 'g-b', scheduledStart: '2026-10-18T14:00:00.000Z', scheduledEnd: '2026-10-18T15:00:00.000Z', writable: true },
];

function bulkDelete(extra: Partial<SemanticOperationV1> = {}): SemanticEnvelopeV1 {
  return envelope([operation({
    opId: 'op-1',
    action: 'delete',
    target: { kind: 'existing', description: 'Нарада', calendarId: 'work' },
    scope: 'all',
    ...extra,
  })]);
}

describe('Phase 4.7.2 bulk safety', () => {
  it('fails closed without a trusted receipt and keeps a single named delete', async () => {
    const missing = await turn(createSession('user-1', 'missing'), bulkDelete(), { entities: MEETINGS });
    expect(missing.response.intents).toEqual([]);
    expect(missing.blocked).toContain('completeness_unknown');
    expect(missing.serverWrites).toBe(0);

    // Structured path trusts an authorized proposedId; V1 title-disambiguation is not restored.
    const one = await turn(createSession('user-1', 'one'), envelope([operation({
      opId: 'op-1',
      action: 'delete',
      target: { kind: 'existing', proposedId: 'a', description: 'Нарада', calendarId: 'work' },
    })]), { entities: MEETINGS });
    expect(one.response.outcome).toBe('confirm');
    expect(one.response.intents).toHaveLength(1);
    expect(one.response.intents[0].type === 'command' ? one.response.intents[0].command.taskId : null).toBe('a');
    expect(one.serverWrites).toBe(0);
    const unique = await turn(createSession('user-1', 'unique'), envelope([operation({
      opId: 'op-1',
      action: 'delete',
      target: { kind: 'existing', proposedId: 'a', description: 'Планерка' },
    })]), { entities: [{ ...MEETINGS[0], name: 'Планерка' }] });
    expect(unique.response.intents).toHaveLength(1);
    expect(unique.response.intents[0].type === 'command' ? unique.response.intents[0].command.taskId : null).toBe('a');
    // Forged ids are refused; title-only recovery of a wrong proposedId is not restored.
    const forged = await turn(createSession('user-1', 'forged'), envelope([operation({
      opId: 'op-1',
      action: 'delete',
      target: { kind: 'existing', proposedId: 'other', description: 'Планерка' },
    })]), { entities: [{ ...MEETINGS[0], name: 'Планерка' }] });
    expect(forged.response.intents).toEqual([]);
    expect(forged.blocked).toContain('unauthorized_entity');
  });

  it('distinguishes incomplete, complete, empty, truncated, failed, and duplicate searches', async () => {
    const cases: Array<{ receipt: SearchReceipt; code?: string; count?: number }> = [
      { receipt: { complete: false, ids: ['a', 'b'] }, code: 'search_incomplete' },
      { receipt: { complete: true, ids: ['a', 'b'] }, count: 2 },
      { receipt: { complete: true, ids: [] }, code: 'scope_mismatch' },
      { receipt: { complete: false, ids: [] }, code: 'search_incomplete' },
      { receipt: receiptFromPages([{ ids: ['a'], nextPage: '2' }, { ids: ['b'], nextPage: null }]), count: 2 },
      { receipt: receiptFromPages([{ ids: ['a'], nextPage: '2' }, { ids: ['b'], nextPage: '3' }]), code: 'search_truncated' },
      { receipt: receiptFromPages([{ ids: ['a'], nextPage: '2' }, { ids: [], nextPage: null, failed: true }]), code: 'search_failed' },
      { receipt: receiptFromPages([{ ids: ['a', 'a'], nextPage: null }]), code: 'duplicate_targets' },
      { receipt: receiptFromMatches(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']), code: 'search_truncated' },
    ];
    for (const item of cases) {
      const result = await turn(createSession('user-1', item.code ?? 'ok'), bulkDelete(), { entities: MEETINGS, searchReceipt: item.receipt });
      expect(result.serverWrites).toBe(0);
      if (item.count != null) {
        expect(result.response.intents).toHaveLength(item.count);
        expect(result.response.outcome).toBe('confirm');
      } else {
        expect(result.response.intents).toEqual([]);
        expect(result.blocked).toContain(item.code);
      }
    }
    const empty = await turn(createSession('user-1', 'empty-complete'), bulkDelete(), {
      entities: [],
      searchReceipt: { complete: true, ids: [] },
    });
    expect(empty.response.intents).toEqual([]);
    expect(empty.blocked).toContain('empty_scope');
    expect(empty.serverWrites).toBe(0);
  });

  it('does not narrow a multi-calendar set and rejects a changed set before Apply', async () => {
    const both: EntityRecord[] = [
      { id: 'home-1', userId: 'user-1', type: 'task', name: 'Нарада', status: 'open', calendarId: 'home', revision: 1 },
      { id: 'work-1', userId: 'user-1', type: 'task', name: 'Нарада', status: 'open', calendarId: 'work', revision: 1 },
    ];
    const narrowed = await turn(createSession('user-1', 'narrow'), bulkDelete(), {
      entities: both,
      searchReceipt: { complete: true, ids: ['home-1', 'work-1'] },
    });
    expect(narrowed.response.intents).toEqual([]);
    expect(narrowed.blocked).toContain('scope_mismatch');

    const full = await turn(createSession('user-1', 'full'), envelope([operation({
      opId: 'op-1',
      action: 'delete',
      target: { kind: 'existing', description: 'Нарада' },
      scope: 'all',
    })]), { entities: both, searchReceipt: { complete: true, ids: ['home-1', 'work-1'] } });
    expect(full.response.intents.map((intent) => intent.type === 'command' ? intent.command.taskId : null).sort()).toEqual(['home-1', 'work-1']);

    const session = createSession('user-1', 'stale-set');
    const preview = await turn(session, bulkDelete(), { entities: MEETINGS, searchReceipt: { complete: true, ids: ['a', 'b'] } });
    expect(preview.response.intents).toHaveLength(2);
    expect(preview.serverWrites).toBe(0);
    const changed = await turn(session, { version: '1', kind: 'control', operations: [], control: 'confirm_pending' }, {
      entities: MEETINGS,
      searchReceipt: { complete: true, ids: ['a'] },
    });
    expect(changed.response.outcome).toBe('clarify');
    expect(changed.response.intents).toEqual([]);
    expect(changed.blocked).toContain('stale_scope');
    expect(changed.serverWrites).toBe(0);
  });

  it('moves every matched task, confirms once, and applies each id once', async () => {
    const session = createSession('user-1', 'move');
    const receipt = { complete: true, ids: ['a', 'b'] };
    const preview = await turn(session, envelope([operation({
      opId: 'op-1',
      action: 'move',
      target: { kind: 'existing', description: 'Нарада', calendarId: 'work' },
      scope: 'all',
      constraints: [{ kind: 'date', value: '2026-10-19', precision: 'day' }, { kind: 'clock', value: '15:00', role: 'start' }],
    })]), { entities: MEETINGS, searchReceipt: receipt });
    expect(preview.serverWrites).toBe(0);
    expect(preview.response.intents).toHaveLength(2);
    expect(preview.response.intents.every((intent) => intent.type === 'command' && intent.command.kind === 'move')).toBe(true);
    const confirmed = await turn(session, { version: '1', kind: 'control', operations: [], control: 'confirm_pending' }, {
      entities: MEETINGS,
      searchReceipt: receipt,
    });
    expect(confirmed.response.outcome).toBe('act');
    expect(confirmed.serverWrites).toBe(0);
    const payload = frontendApplyRequest(session.sessionId, confirmed.response.intents);
    const ledger = new Map();
    const writes: string[] = [];
    const first = await applyPreview({
      items: payload.intents.map((intent) => ({ intent })),
      ledger,
      write: async (intent) => { writes.push(intent.type === 'command' ? String(intent.command.taskId) : intent.summary); },
    });
    const second = await applyPreview({
      items: payload.intents.map((intent) => ({ intent })),
      ledger,
      write: async () => { writes.push('again'); },
    });
    expect(first.results.every((row) => row.status === 'succeeded')).toBe(true);
    expect(second.results.every((row) => row.status === 'skipped')).toBe(true);
    expect(writes.sort()).toEqual(['a', 'b']);
    session.pendingIntents = confirmed.response.intents;
    const repeated = await turn(session, { version: '1', kind: 'control', operations: [], control: 'confirm_pending' }, { entities: MEETINGS, searchReceipt: receipt });
    expect(repeated.blocked).toContain('already_applied');
    expect(repeated.serverWrites).toBe(0);
  });

  it('rejects an interpreter field that claims the search is complete', () => {
    const raw = JSON.stringify({
      version: '1',
      kind: 'operations',
      operations: [{
        opId: 'op-1',
        action: 'delete',
        target: { kind: 'existing', description: 'Нарада' },
        scope: 'all',
        searchComplete: true,
        changes: {},
        constraints: [],
        dependsOn: [],
        source: { text: 'Видали всі наради' },
      }],
    });
    const parsed = validateSemanticEnvelope(raw, 'Видали всі наради');
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors.some((issue) => issue.code === 'unknown_field')).toBe(true);
  });
});

describe('Phase 4.7.2 scorer', () => {
  const meeting = { type: 'create', summary: 'Зустріч', task: { name: 'Зустріч', scheduledStartTime: '2026-10-19T07:00:00.000Z', estimatedTimeInMinutes: 30, calendarId: 'work' } };
  const report = { type: 'create', summary: 'Звіт', task: { name: 'Звіт', scheduledStartTime: '2026-10-19T12:00:00.000Z', estimatedTimeInMinutes: 60, deadline: '2026-10-19T15:00:00.000Z', calendarId: 'home' } };
  const expected = {
    acceptable: ['confirm' as const],
    operations: [
      { action: 'create' as const, name: 'Зустріч', scheduledStart: '2026-10-19T07:00:00.000Z', durationMinutes: 30, calendarId: 'work' },
      { action: 'create' as const, name: 'Звіт', scheduledStart: '2026-10-19T12:00:00.000Z', durationMinutes: 60, deadline: '2026-10-19T15:00:00.000Z', calendarId: 'home' },
    ],
  };

  function score(intents: unknown[], expectation: Parameters<typeof scoreSemanticOutcome>[0]['expectation'], outcome = 'confirm') {
    return scoreSemanticOutcome({ schemaValid: true, outcome, intents, blocked: [], serverWrites: 0, expectation });
  }

  it('fails swapped and misplaced fields for a specific reason and passes a reordered pair', () => {
    expect(score([report, meeting], expected).correct).toBe(true);
    expect(score([
      { ...meeting, task: { ...meeting.task, scheduledStartTime: report.task.scheduledStartTime } },
      { ...report, task: { ...report.task, scheduledStartTime: meeting.task.scheduledStartTime } },
    ], expected).reason).toBe('wrong_time');
    expect(score([
      { ...meeting, task: { ...meeting.task, name: 'Звіт' } },
      { ...report, task: { ...report.task, name: 'Зустріч' } },
    ], expected).reason).toBe('wrong_calendar');
    expect(score([
      { ...meeting, task: { ...meeting.task, name: 'Інше' } },
    ], { acceptable: ['confirm'], operations: [{ name: 'Зустріч', scheduledStart: meeting.task.scheduledStartTime }] }).reason).toBe('wrong_target');
    expect(score([meeting, { ...report, task: { ...report.task, calendarId: 'work' } }], expected).reason).toBe('wrong_calendar');
    expect(score([meeting, { ...report, task: { ...report.task, deadline: meeting.task.scheduledStartTime } }], expected).reason).toBe('wrong_deadline');
    expect(score([meeting, { ...report, task: { ...report.task, estimatedTimeInMinutes: 15 } }], expected).reason).toBe('wrong_duration');
    expect(score([meeting], expected).reason).toBe('missing_operation');
    expect(score([meeting, report, { type: 'command', summary: 'Нарада', command: { kind: 'delete', taskId: 'a', taskName: 'Нарада' } }], expected).reason).toBe('extra_operation');
  });

  it('classifies reminders, dependencies, refusals, clarifications, and missing gold', () => {
    const withReminder = {
      acceptable: ['confirm' as const],
      operations: [{ name: 'Зустріч', reminder: '20:00' }, { name: 'Звіт' }],
    };
    expect(score([
      { type: 'create', summary: 'Зустріч', task: { name: 'Зустріч' } },
      { type: 'create', summary: 'Звіт', task: { name: 'Звіт', notificationTime: '20:00' } },
    ], withReminder).reason).toBe('wrong_reminder');
    expect(score([
      { type: 'create', summary: 'Зустріч', task: { name: 'Зустріч' } },
      { type: 'create', summary: 'Звіт', task: { name: 'Звіт' } },
    ], withReminder).reason).toBe('missing_reminder');
    expect(score([
      { type: 'create', summary: 'Звіт', task: { name: 'Звіт', dependsOn: ['other'] } },
    ], { acceptable: ['confirm'], operations: [{ name: 'Звіт', dependsOn: ['draft'] }] }).reason).toBe('wrong_dependency');
    expect(score([], { acceptable: ['confirm'], operations: [{ name: 'Звіт' }] }, 'refuse').klass).toBe('incorrect_refusal');
    expect(score([], { acceptable: ['confirm'], operations: [{ name: 'Звіт' }] }, 'clarify').klass).toBe('unnecessary_clarification');
    const asked = score([], { acceptable: ['clarify'], intentCount: 0 }, 'clarify');
    expect(asked.correct).toBe(true);
    expect(asked.klass).toBe('clarification');
    expect(asked.supportedExecution).toBe(false);
    const refused = score([], { acceptable: ['refuse'], refusalAllowed: true }, 'refuse');
    expect(refused.klass).toBe('unsupported_refusal');
    expect(refused.supportedExecution).toBe(false);
    expect(score([meeting], { acceptable: ['confirm'], unverified: true }).klass).toBe('unverified');
    expect(score([meeting], { acceptable: ['confirm'], intentCount: 2, operations: [{ name: 'Зустріч' }] }).reason).toBe('invalid_gold');
    expect(score([meeting, report], { acceptable: ['confirm'], operations: [{ name: 'Зустріч', scope: 'all' }, { name: 'Звіт' }] }).reason).toBe('wrong_scope');
  });
});

describe('Phase 4.7.2 gold and reads', () => {
  it('validates the corpus without treating unverified fixtures as scored', () => {
    const result = validateGoldCorpus();
    expect(result.problems).toEqual([]);
    expect(result.coverage.fixtures).toBe(77);
    expect(result.coverage.edges).toBe(39);
    expect(result.coverage.heldOut).toBe(16);
    expect(result.coverage.total).toBe(132);
    expect(result.coverage.duplicates).toBe(0);
    expect(result.coverage.scored).toBe(result.coverage.complete);
    expect(result.coverage.unverified).toBeGreaterThan(0);
    expect(result.coverage.complete + result.coverage.partial + result.coverage.ambiguous + result.coverage.unsupported + result.coverage.unverified).toBe(result.coverage.total);
  });

  it('grounds an agenda answer in VoiceAgentTools and keeps tomorrow empty distinct from a failure', async () => {
    const task = { id: 'task-1', name: 'Зустріч', status: TaskStatus.TODO, isUnscheduled: false, scheduleState: ScheduleState.NONE } as Task;
    const parked = { id: 'task-2', name: 'Чернетка', status: TaskStatus.TODO, isUnscheduled: true, scheduleState: ScheduleState.PROBLEMATIC } as Task;
    const slot = { taskId: 'task-1', scheduledStartTime: new Date('2026-10-18T07:00:00.000Z'), scheduledEndTime: new Date('2026-10-18T08:00:00.000Z') } as ScheduledTask;
    const context: VoiceToolContext = {
      userId: 'user-1',
      timeZone: 'Europe/Kyiv',
      nowIso: NOW,
      settings: { wakeTime: '08:00', sleepTime: '23:00' } as UserSettings,
      tasks: [task, parked],
      slots: [slot],
      phases: [],
      reminders: [],
    };
    const tools = new VoiceAgentTools({ listVisibleEvents: async () => [] } as never);
    const execute = domainReadExecutor(tools, context, async () => undefined);
    const today = await execute('get_day_agenda', { day: '2026-10-18' }) as { items: Array<{ name: string }> };
    const tomorrow = await execute('get_day_agenda', { day: '2026-10-19' }) as { count: number; error?: string };
    expect(today.items.map((item) => item.name)).toEqual(['Зустріч']);
    expect(tomorrow.count).toBe(0);
    expect(tomorrow.error).toBeUndefined();
    const interpreted = await runInterpreterA(
      { complete: async ({ user }) => ({
        text: user.includes('\nReads:')
          ? '{"version":"1","kind":"answer","operations":[],"answer":{"text":"Сьогодні: Зустріч.","evidenceRefs":["r1"]}}'
          : '{"version":"1","kind":"answer","operations":[],"requestedReads":[{"requestId":"r1","name":"get_day_agenda","args":{"day":"2026-10-18"}}],"answer":{"text":"","evidenceRefs":[]}}',
        inputTokens: 1,
        outputTokens: 1,
        latencyMs: 1,
      }) },
      new ReadBroker(execute),
      'user',
      'Що в мене сьогодні?',
    );
    expect(interpreted.reads[0]?.result).toMatchObject({ count: 1 });
    expect(interpreted.envelope?.answer?.text).toContain('Зустріч');
    const failedTools = new VoiceAgentTools({ listVisibleEvents: async () => { throw new Error('timeout'); } } as never);
    const failed = await domainReadExecutor(failedTools, context, async () => { throw new Error('timeout'); })('get_now_next', {}) as { error?: string };
    expect(failed.error).toBe('provider_timeout');
  });
});

describe('Phase 4.7.2 preview confirm apply', () => {
  it('previews a create, confirms it, and writes only inside Apply', async () => {
    const session = createSession('user-1', 'create');
    const preview = await turn(session, envelope([operation({
      opId: 'op-1',
      action: 'create',
      target: { kind: 'new', localId: 'op-1' },
      changes: { title: 'Зустріч' },
      constraints: [{ kind: 'date', value: '2026-10-19', precision: 'day' }, { kind: 'clock', value: '15:00', role: 'start' }],
    })]));
    expect(preview.response.outcome).toBe('confirm');
    expect(preview.serverWrites).toBe(0);
    expect(preview.response.intents).toHaveLength(1);
    const confirmed = await turn(session, { version: '1', kind: 'control', operations: [], control: 'confirm_pending' });
    expect(confirmed.response.outcome).toBe('act');
    expect(confirmed.serverWrites).toBe(0);
    const request = frontendApplyRequest('create', confirmed.response.intents);
    const ledger = new Map();
    let writes = 0;
    await applyPreview({ items: request.intents.map((intent) => ({ intent })), ledger, write: async () => { writes += 1; } });
    expect(writes).toBe(1);
    if (preview.response.intents[0]?.type === 'create') {
      expect(Date.parse(String(preview.response.intents[0].task.scheduledStartTime))).toBe(Date.parse(localDateTimeIso('2026-10-19', '15:00', 'Europe/Kyiv')));
    }
  });

  it('keeps the second task when the first is canceled and does not execute a stale delete', async () => {
    const session = createSession('user-1', 'pair');
    await turn(session, envelope([
      operation({ opId: 'op-1', action: 'create', target: { kind: 'new', localId: 'op-1' }, changes: { title: 'Зустріч' }, constraints: [{ kind: 'date', value: '2026-10-19', precision: 'day' }] }),
      operation({ opId: 'op-2', action: 'create', target: { kind: 'new', localId: 'op-2' }, changes: { title: 'Звіт' }, constraints: [{ kind: 'date', value: '2026-10-19', precision: 'day' }] }),
    ]));
    // Title-based draft cancel is not restored; structured replace keeps only the remaining create.
    const canceled = await runVNextTurn(
      {
        transcript: 'cancel meeting keep report',
        userId: 'user-1',
        session,
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
          reads: [],
          usage: { calls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 },
          specialist: null,
          promptHash: 'phase472-replace',
          group: {
            version: '1',
            control: 'none',
            previewBoundary: 'replace',
            proposals: [{
              localRef: 'op-2',
              action: 'create',
              entityType: 'task',
              target: { kind: 'new' },
              scheduling: 'unscheduled',
              changes: { title: 'Звіт' },
              constraints: [],
              dependsOn: [],
              known: ['title'],
              missing: [],
              source: { text: 'Звіт' },
            }],
            patches: [],
          },
        }),
      },
    );
    expect(canceled.response.intents.map((intent) => intent.summary)).toEqual(['Звіт']);
    expect(canceled.serverWrites).toBe(0);

    const entity: EntityRecord = { id: 'a', userId: 'user-1', type: 'task', name: 'Нарада', status: 'open', revision: 1 };
    const deleting = createSession('user-1', 'stale');
    await turn(deleting, envelope([operation({
      opId: 'op-1',
      action: 'delete',
      target: { kind: 'existing', proposedId: 'a', description: 'Нарада' },
    })]), { entities: [entity] });
    const stale = await turn(deleting, { version: '1', kind: 'control', operations: [], control: 'confirm_pending' }, {
      entities: [{ ...entity, revision: 2 }],
    });
    expect(stale.blocked).toContain('stale_preview');
    expect(stale.response.intents).toEqual([]);
    expect(stale.serverWrites).toBe(0);
    const raw = exportSession(deleting, NOW);
    expect(restoreSession(raw, NOW).ok).toBe(true);
    expect(restoreSession(exportSession(deleting, '2026-10-01T00:00:00.000Z'), NOW).ok).toBe(false);
  });

  it('does not write a dependent after a failed prerequisite or a read-only calendar', async () => {
    const first = { type: 'create' as const, summary: 'Чернетка', task: { name: 'Чернетка' } };
    const second = { type: 'create' as const, summary: 'Ревʼю', task: { name: 'Ревʼю' } };
    const ledger = new Map();
    const writes: string[] = [];
    const batch = await applyPreview({
      items: [{ intent: first }, { intent: second, dependsOn: [intentKey(first)] }],
      ledger,
      write: async (intent) => {
        if (intent.summary === 'Чернетка') throw new Error('provider_unavailable');
        writes.push(intent.summary);
      },
    });
    expect(batch.results.map((row) => row.status)).toEqual(['failed', 'blocked']);
    expect(writes).toEqual([]);
    const readonly = await turn(createSession('user-1', 'ro'), envelope([operation({
      opId: 'op-1',
      action: 'delete',
      target: { kind: 'existing', proposedId: 'ext-1', description: 'Нарада' },
    })]), { entities: [{ id: 'ext-1', userId: 'user-1', type: 'external_event', name: 'Нарада', status: 'open' }] });
    expect(readonly.response.intents).toEqual([]);
    expect(readonly.blocked).toContain('external_readonly');
    expect(readonly.serverWrites).toBe(0);
  });
});
