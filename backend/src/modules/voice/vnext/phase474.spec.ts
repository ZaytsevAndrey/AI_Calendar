import { validateSemanticEnvelope } from './contracts/validate';
import type { SemanticEnvelopeV1, SemanticOperationV1 } from './contracts/types';
import { parseWithOneRepair } from './repair/repair';
import { runVNextTurn } from './pipeline';
import { withStructuredConfirmation } from './eval/structured-test-turn';
import type { EntityRecord } from './reference/reference-resolver';
import { createSession, type VNextSession } from './session/session';
import { resolveConstraints } from './temporal/temporal-resolver';

const NOW = '2026-10-18T06:00:00.000Z';
const USER = 'user-1';

function operation(partial: Partial<SemanticOperationV1> & Pick<SemanticOperationV1, 'opId' | 'action' | 'target'>): SemanticOperationV1 {
  return { changes: {}, constraints: [], dependsOn: [], source: { text: 'hello' }, ...partial };
}

function envelope(operations: SemanticOperationV1[]): SemanticEnvelopeV1 {
  return { version: '1', kind: 'operations', operations };
}

async function turn(
  session: VNextSession,
  value: SemanticEnvelopeV1,
  extra: { nowIso?: string; timeZone?: string; entities?: EntityRecord[]; wakeHm?: string; sleepHm?: string; planContext?: { tasks: []; slots: []; timeZone: string; nowIso: string; defaultDurationMinutes: number } } = {},
) {
  const confirmed = withStructuredConfirmation(session, value, extra);
  return runVNextTurn(
    {
      transcript: value.control === 'confirm_pending' ? 'Так' : 'hello',
      userId: USER,
      session,
      nowIso: extra.nowIso ?? NOW,
      timeZone: extra.timeZone ?? 'Europe/Kyiv',
      wakeHm: extra.wakeHm ?? '08:00',
      sleepHm: extra.sleepHm ?? '23:00',
      defaultDurationMinutes: 30,
      language: 'uk',
      arm: 'A',
      entities: extra.entities ?? [],
      ...(extra.planContext ? { planContext: extra.planContext } : {}),
      ...confirmed,
    },
    {
      arm: 'A',
      interpret: async () => ({ ok: true, envelope: value, reads: [], usage: { calls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 }, specialist: null, promptHash: 'phase474' }),
    },
  );
}

describe('Phase 4.7.4 contract alignment', () => {
  it('normalizes only an unambiguous control object', () => {
    const text = 'Так';
    const valid = validateSemanticEnvelope(JSON.stringify({ version: '1', kind: 'control', operations: [], control: { action: 'confirm_pending' } }), text);
    expect(valid.ok && valid.envelope.control).toBe('confirm_pending');
    const cancel = validateSemanticEnvelope(JSON.stringify({ version: '1', kind: 'control', operations: [], control: { action: 'cancel_pending' } }), text);
    expect(cancel.ok && cancel.envelope.control).toBe('cancel_pending');
    const answer = validateSemanticEnvelope(JSON.stringify({ version: '1', kind: 'control', operations: [], control: { action: 'answer_pending' } }), text);
    expect(answer.ok && answer.envelope.control).toBe('answer_pending');
    const extra = validateSemanticEnvelope(JSON.stringify({ version: '1', kind: 'control', operations: [], control: { action: 'confirm_pending', force: true } }), text);
    expect(extra.ok).toBe(false);
    const junk = validateSemanticEnvelope(JSON.stringify({ version: '1', kind: 'control', operations: [], control: { action: 'delete_everything' } }), text);
    expect(junk.ok).toBe(false);
  });

  it('asks again in Ukrainian when repair emits the English fallback', async () => {
    const repaired = await parseWithOneRepair(
      {
        complete: async ({ system }) => ({
          text: system.includes('failed validation')
            ? JSON.stringify({ version: '1', kind: 'clarification', operations: [], clarification: { question: 'Please repeat that.', operationIds: [], missing: ['valid_command'] } })
            : 'not-json',
          inputTokens: 1,
          outputTokens: 1,
          latencyMs: 1,
        }),
      },
      'system',
      'Write any user-facing question in Ukrainian.',
      'Так',
    );
    expect(repaired.result.ok).toBe(true);
    if (repaired.result.ok && repaired.result.envelope.kind === 'clarification') {
      expect(repaired.result.envelope.clarification?.question).toBe('Не зрозумів команду. Скажіть інакше.');
    }
  });

  it('answers that nothing is waiting when confirm has no preview', async () => {
    const session = createSession(USER, 'empty');
    const result = await turn(session, { version: '1', kind: 'control', operations: [], control: 'confirm_pending' });
    expect(result.serverWrites).toBe(0);
    expect(result.response.outcome).toBe('answer');
    expect(result.response.intents).toEqual([]);
    expect(result.response.assistantMessage).toContain('Немає дії');
  });

  it('asks for a date when a bare clock is already past and keeps a future clock', () => {
    const clock = { nowIso: NOW, timeZone: 'Europe/Kyiv', wakeHm: '08:00', sleepHm: '23:00' };
    const future = resolveConstraints([{ kind: 'clock', value: '15:00', role: 'start' }], clock);
    expect(future.some((row) => row.status === 'instant' && row.iso === '2026-10-18T12:00:00.000Z')).toBe(true);
    const past = resolveConstraints([{ kind: 'clock', value: '07:00', role: 'start' }], clock);
    expect(past.some((row) => row.status === 'past')).toBe(true);
    expect(past.some((row) => row.status === 'instant')).toBe(false);
    const explicit = resolveConstraints(
      [
        { kind: 'date', value: '2026-10-17', precision: 'day' },
        { kind: 'clock', value: '07:00', role: 'start' },
      ],
      clock,
    );
    expect(explicit.some((row) => row.status === 'instant')).toBe(true);
    const early = resolveConstraints([{ kind: 'clock', value: '10:00', role: 'start' }], { ...clock, nowIso: '2026-10-18T01:00:00.000Z' });
    expect(early.some((row) => row.status === 'past')).toBe(true);
    const gap = resolveConstraints(
      [
        { kind: 'date', value: '2026-03-08', precision: 'day' },
        { kind: 'clock', value: '02:30', role: 'start' },
      ],
      { ...clock, nowIso: '2026-03-08T06:00:00.000Z', timeZone: 'America/New_York' },
    );
    expect(gap.some((row) => row.status === 'gap')).toBe(true);
    const fold = resolveConstraints(
      [
        { kind: 'date', value: '2026-11-01', precision: 'day' },
        { kind: 'clock', value: '01:30', role: 'start' },
      ],
      { ...clock, nowIso: '2026-11-01T05:00:00.000Z', timeZone: 'America/New_York' },
    );
    expect(fold.some((row) => row.status === 'fold')).toBe(true);
  });

  it('previews a dated all-day event across the real wake to sleep interval', async () => {
    const session = createSession(USER, 'all-day');
    const result = await turn(session, envelope([
      operation({
        opId: 'op-1',
        action: 'create',
        target: { kind: 'new', localId: 'trip' },
        changes: { title: 'відрядження' },
        constraints: [
          { kind: 'date', value: '2026-10-19', precision: 'day' },
          { kind: 'all_day' },
        ],
      }),
    ]));
    expect(result.serverWrites).toBe(0);
    expect(result.response.outcome).toBe('confirm');
    expect(result.response.intents[0]).toMatchObject({
      type: 'create',
      task: {
        scheduledStartTime: '2026-10-19T08:00:00+03:00',
        scheduledEndTime: '2026-10-19T23:00:00+03:00',
        eventType: 'fixed',
        isUnscheduled: false,
      },
    });
    const missing = await turn(createSession(USER, 'all-day-open'), envelope([
      operation({
        opId: 'op-1',
        action: 'create',
        target: { kind: 'new', localId: 'trip' },
        changes: { title: 'відрядження' },
        constraints: [{ kind: 'all_day' }],
      }),
    ]));
    expect(missing.response.intents).toEqual([]);
    expect(missing.blocked).toContain('needs_day');
    const overnight = await turn(createSession(USER, 'all-day-night'), envelope([
      operation({
        opId: 'op-1',
        action: 'create',
        target: { kind: 'new', localId: 'trip' },
        changes: { title: 'відрядження' },
        constraints: [
          { kind: 'date', value: '2026-10-19', precision: 'day' },
          { kind: 'all_day' },
        ],
      }),
    ]), { wakeHm: '22:00', sleepHm: '07:00' });
    expect(overnight.response.intents[0]).toMatchObject({
      type: 'create',
      task: {
        scheduledStartTime: '2026-10-19T22:00:00+03:00',
        scheduledEndTime: '2026-10-20T07:00:00+03:00',
      },
    });
  });

  it('moves an existing task to a named day inside wake to sleep without inventing a start', async () => {
    const task: EntityRecord = { id: 'task-1', userId: USER, type: 'task', name: 'Звіт', status: 'open' };
    const result = await turn(createSession(USER, 'move-day'), envelope([
      operation({
        opId: 'op-1',
        action: 'move',
        target: { kind: 'existing', description: 'Звіт' },
        constraints: [{ kind: 'date', value: '2026-10-23', precision: 'day' }],
      }),
    ]), { entities: [task] });
    expect(result.response.outcome).toBe('confirm');
    expect(result.response.intents[0]).toMatchObject({
      type: 'command',
      command: {
        kind: 'window',
        taskId: 'task-1',
        earliestStartTime: '2026-10-23T08:00:00+03:00',
        deadline: '2026-10-23T23:00:00+03:00',
        scheduledStartTime: null,
      },
    });
  });

  it('keeps a rename and a move in one update', async () => {
    const task: EntityRecord = { id: 'task-1', userId: USER, type: 'task', name: 'Звіт', status: 'open' };
    const result = await turn(createSession(USER, 'rename'), envelope([
      operation({
        opId: 'op-1',
        action: 'update',
        target: { kind: 'existing', description: 'Звіт' },
        changes: { title: 'Підсумок' },
        constraints: [
          { kind: 'date', value: '2026-10-23', precision: 'day' },
          { kind: 'clock', value: '10:00', role: 'start' },
        ],
      }),
    ]), { entities: [task] });
    expect(result.response.intents).toHaveLength(1);
    expect(result.response.intents[0]).toMatchObject({
      type: 'command',
      command: {
        kind: 'update',
        taskId: 'task-1',
        patch: { name: 'Підсумок', scheduledStartTime: '2026-10-23T07:00:00.000Z' },
      },
    });
  });

  it('does not turn evening into a clock', async () => {
    const result = await turn(createSession(USER, 'evening'), envelope([
      operation({
        opId: 'op-1',
        action: 'create',
        target: { kind: 'new', localId: 'walk' },
        changes: { title: 'Прогулянка' },
        constraints: [{ kind: 'time_of_day', label: 'evening', bound: 'at' }],
      }),
    ]));
    expect(result.response.intents[0]).toMatchObject({ type: 'create' });
    const task = result.response.intents[0].type === 'create' ? result.response.intents[0].task : {};
    expect(task.scheduledStartTime).toBeUndefined();
    expect(result.preservedLabels).toContain('evening');
  });

  it('uses a predecessor end and asks when that end is missing', async () => {
    const ready: EntityRecord = { id: 'task-a', userId: USER, type: 'task', name: 'Нарада', status: 'open', scheduledEnd: '2026-10-18T10:00:00.000Z' };
    const open: EntityRecord = { id: 'task-b', userId: USER, type: 'task', name: 'Дзвінок', status: 'open' };
    const after = await turn(createSession(USER, 'after'), envelope([
      operation({
        opId: 'op-1',
        action: 'create',
        target: { kind: 'new', localId: 'next' },
        changes: { title: 'Протокол' },
        constraints: [{ kind: 'ordering', relation: 'after', target: { kind: 'existing', description: 'Нарада' } }],
        dependsOn: [],
      }),
    ]), { entities: [ready] });
    expect(after.response.intents[0]).toMatchObject({
      type: 'create',
      task: { earliestStartTime: '2026-10-18T10:00:00.000Z', dependsOn: ['task-a'] },
    });
    const missing = await turn(createSession(USER, 'after-open'), envelope([
      operation({
        opId: 'op-1',
        action: 'create',
        target: { kind: 'new', localId: 'next' },
        changes: { title: 'Протокол' },
        constraints: [{ kind: 'ordering', relation: 'after', target: { kind: 'existing', description: 'Дзвінок' } }],
      }),
    ]), { entities: [open] });
    expect(missing.response.intents).toEqual([]);
    expect(missing.blocked).toContain('missing_predecessor');
  });

  it('keeps a dated reminder and asks for the start of a daily reminder', async () => {
    const dated = await turn(createSession(USER, 'remind-day'), envelope([
      operation({
        opId: 'op-1',
        action: 'remind',
        target: { kind: 'new', localId: 'pills' },
        changes: { reminder: { op: 'create', name: 'ліки', dueYmd: '2026-10-20' } },
        constraints: [],
      }),
    ]));
    expect(dated.response.intents[0]).toMatchObject({
      type: 'command',
      command: { kind: 'remind_create', dueYmd: '2026-10-20', notificationTime: null },
    });
    const daily = await turn(createSession(USER, 'remind-daily'), envelope([
      operation({
        opId: 'op-1',
        action: 'remind',
        target: { kind: 'new', localId: 'pills' },
        changes: { reminder: { op: 'create', name: 'ліки', recurrencePattern: 'DAILY' } },
        constraints: [{ kind: 'recurrence', expression: 'daily' }],
      }),
    ]));
    expect(daily.response.intents).toEqual([]);
    expect(daily.blocked).toContain('missing_day');
    const dailySession = createSession(USER, 'remind-daily-dated');
    const datedDaily = await turn(dailySession, envelope([
      operation({
        opId: 'op-1',
        action: 'remind',
        target: { kind: 'new', localId: 'pills' },
        changes: { reminder: { op: 'create', name: 'ліки', dueYmd: '2026-10-20', recurrencePattern: 'DAILY' } },
        constraints: [{ kind: 'recurrence', expression: 'daily' }],
      }),
    ]));
    expect(datedDaily.response.outcome).toBe('confirm');
    expect(datedDaily.response.intents[0]).toMatchObject({
      type: 'command',
      command: { kind: 'remind_create', dueYmd: '2026-10-20', recurrencePattern: 'DAILY' },
    });
    const confirmed = await turn(dailySession, { version: '1', kind: 'control', operations: [], control: 'cancel_pending' });
    expect(confirmed.response.outcome).toBe('answer');
    expect(confirmed.response.intents).toEqual([]);
    expect(dailySession.pendingIntents).toBeNull();
  });

  it('keeps recurrence on an unscheduled recurring task', async () => {
    const result = await turn(createSession(USER, 'series'), envelope([
      operation({
        opId: 'op-1',
        action: 'create',
        target: { kind: 'new', localId: 'run' },
        changes: { title: 'Пробіжка' },
        constraints: [{ kind: 'recurrence', expression: 'weekly' }],
      }),
    ]));
    expect(result.response.intents[0]).toMatchObject({
      type: 'create',
      task: { isRecurring: true, recurrencePattern: 'WEEKLY', isUnscheduled: true },
    });
    expect(result.response.intents[0].type === 'create' ? result.response.intents[0].task.scheduledStartTime : 'set').toBeUndefined();
  });

  it('asks for series scope and does not treat a bulk set as a series', async () => {
    const series: EntityRecord = { id: 'task-1', userId: USER, type: 'task', name: 'Пробіжка', status: 'open', recurring: true };
    const missing = await turn(createSession(USER, 'scope'), envelope([
      operation({
        opId: 'op-1',
        action: 'delete',
        target: { kind: 'existing', description: 'Пробіжка' },
      }),
    ]), { entities: [series] });
    expect(missing.blocked).toContain('missing_series_scope');
    const following = await turn(createSession(USER, 'scope-set'), envelope([
      operation({
        opId: 'op-1',
        action: 'delete',
        target: { kind: 'existing', description: 'Пробіжка' },
        seriesScope: 'from_day',
      }),
    ]), { entities: [series] });
    expect(following.response.intents[0]).toMatchObject({
      type: 'command',
      command: { kind: 'delete', taskId: 'task-1', seriesScope: 'series' },
    });
    const bulk = await turn(createSession(USER, 'bulk-not-series'), envelope([
      operation({
        opId: 'op-1',
        action: 'delete',
        target: { kind: 'existing', description: 'Пробіжка' },
        scope: 'all',
      }),
    ]), { entities: [series] });
    expect(bulk.response.intents).toEqual([]);
    expect(bulk.blocked).not.toContain('missing_series_scope');
    expect(bulk.blocked).toContain('completeness_unknown');
  });

  it('replaces a pending preview and does not apply the old revision', async () => {
    const session = createSession(USER, 'correct');
    const created = await turn(session, envelope([
      operation({
        opId: 'op-1',
        action: 'create',
        target: { kind: 'new', localId: 'bread' },
        changes: { title: 'Хліб' },
        constraints: [
          { kind: 'date', value: '2026-10-19', precision: 'day' },
          { kind: 'clock', value: '10:00', role: 'start' },
        ],
      }),
    ]));
    expect(created.response.outcome).toBe('confirm');
    const revised = await turn(session, envelope([
      operation({
        opId: 'op-2',
        action: 'move',
        target: { kind: 'existing', description: 'Хліб' },
        changes: { title: 'Хліб' },
        constraints: [{ kind: 'date', value: '2026-10-22', precision: 'day' }],
      }),
    ]));
    expect(revised.response.outcome).toBe('confirm');
    const task = revised.response.intents[0].type === 'create' ? revised.response.intents[0].task : {};
    expect(task.scheduledStartTime).toBe('2026-10-22T07:00:00.000Z');
    const applied = await turn(session, { version: '1', kind: 'control', operations: [], control: 'confirm_pending' });
    expect(applied.response.outcome).toBe('act');
    expect(applied.serverWrites).toBe(0);
    const again = await turn(session, { version: '1', kind: 'control', operations: [], control: 'confirm_pending' });
    expect(again.response.outcome).toBe('answer');
    expect(again.response.intents).toEqual([]);
  });

  it('keeps the pending preview when the correction is ambiguous and cancels it on request', async () => {
    const session = createSession(USER, 'ambiguous');
    const created = await turn(session, envelope([
      operation({
        opId: 'op-1',
        action: 'create',
        target: { kind: 'new', localId: 'a' },
        changes: { title: 'Звіт' },
        constraints: [{ kind: 'clock', value: '10:00', role: 'start' }],
      }),
      operation({
        opId: 'op-2',
        action: 'create',
        target: { kind: 'new', localId: 'b' },
        changes: { title: 'Звіт' },
        constraints: [{ kind: 'clock', value: '11:00', role: 'start' }],
      }),
    ]));
    const pending = session.pendingIntents;
    const ambiguous = await turn(session, envelope([
      operation({
        opId: 'op-3',
        action: 'move',
        target: { kind: 'existing', description: 'Звіт' },
        changes: { title: 'Звіт' },
        constraints: [{ kind: 'date', value: '2026-10-22', precision: 'day' }],
      }),
    ]));
    expect(ambiguous.blocked).toContain('ambiguous_correction');
    expect(session.pendingIntents).toEqual(pending);
    const canceled = await turn(session, { version: '1', kind: 'control', operations: [], control: 'cancel_pending' });
    expect(canceled.response.intents).toEqual([]);
    expect(session.pendingIntents).toBeNull();
  });

  it('leaves an unresolved reference unresolved and does not rewrite an inflected name', async () => {
    const reports: EntityRecord[] = [
      { id: 'task-a', userId: USER, type: 'task', name: 'Звіт', status: 'open' },
      { id: 'task-b', userId: USER, type: 'task', name: 'Звіт', status: 'open' },
    ];
    const pronoun = await turn(createSession(USER, 'it'), envelope([
      operation({
        opId: 'op-1',
        action: 'move',
        target: { kind: 'unresolved', phrase: 'його' },
        constraints: [{ kind: 'time_of_day', label: 'evening', bound: 'at' }],
      }),
    ]));
    expect(pronoun.blocked).toContain('unresolved');
    expect(pronoun.response.intents).toEqual([]);
    const inflected = await turn(createSession(USER, 'case'), envelope([
      operation({
        opId: 'op-1',
        action: 'move',
        target: { kind: 'existing', description: 'звіту' },
        constraints: [{ kind: 'date', value: '2026-10-19', precision: 'day' }],
      }),
    ]), { entities: [reports[0]] });
    expect(inflected.response.intents[0]).toMatchObject({ type: 'command', command: { kind: 'window', taskId: 'task-a', taskName: 'Звіт' } });
    const exact = await turn(createSession(USER, 'exact'), envelope([
      operation({
        opId: 'op-1',
        action: 'delete',
        target: { kind: 'existing', description: 'Звіт' },
      }),
    ]), { entities: [reports[0]] });
    expect(exact.response.intents[0]).toMatchObject({ type: 'command', command: { kind: 'delete', taskId: 'task-a' } });
    const both = await turn(createSession(USER, 'both'), envelope([
      operation({
        opId: 'op-1',
        action: 'delete',
        target: { kind: 'existing', description: 'Звіт' },
      }),
    ]), { entities: reports });
    expect(both.blocked).toContain('ambiguous');
    const external: EntityRecord = { id: 'ext-1', userId: USER, type: 'external_event', name: 'Конференція', status: 'open' };
    const readonly = await turn(createSession(USER, 'ext'), envelope([
      operation({
        opId: 'op-1',
        action: 'delete',
        target: { kind: 'existing', description: 'Конференція' },
      }),
    ]), { entities: [external] });
    expect(readonly.blocked).toContain('external_readonly');
    expect(readonly.response.intents).toEqual([]);
  });

  it('edits an open day plan and cancels that draft', async () => {
    const plan = createSession(USER, 'plan');
    const context = { tasks: [] as [], slots: [] as [], timeZone: 'Europe/Kyiv', nowIso: NOW, defaultDurationMinutes: 30 };
    const started = await turn(plan, {
      version: '1',
      kind: 'day_plan',
      operations: [],
      dayPlan: { phase: 'start', day: '2026-10-18' },
    }, { planContext: context });
    expect(plan.planDraft?.day).toBe('2026-10-18');
    const edited = await turn(plan, {
      version: '1',
      kind: 'day_plan',
      operations: [],
      dayPlan: {
        phase: 'edit',
        edits: [{ op: 'add_task', name: 'Прогулянка', durationMinutes: null, preferredHm: null, earliestHm: null, deadlineHm: null, qualitative: 'evening' }],
      },
    }, { planContext: context });
    expect(edited.response.intents).toEqual([]);
    expect(plan.planDraft?.items.some((item) => item.name === 'Прогулянка')).toBe(true);
    expect(Object.values(plan.qualitativeByItemId)).toContain('evening');
    const canceled = await turn(plan, {
      version: '1',
      kind: 'day_plan',
      operations: [],
      dayPlan: { phase: 'cancel' },
    }, { planContext: context });
    expect(plan.planDraft).toBeNull();
    expect(canceled.response.intents).toEqual([]);
  });
});
