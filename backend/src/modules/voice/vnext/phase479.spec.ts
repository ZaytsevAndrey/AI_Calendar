import type { SemanticEnvelopeV1, SemanticOperationV1 } from './contracts/types';
import { judgeTurn } from './eval/phase477-score';
import { relatedName, type EntityRecord } from './reference/reference-resolver';
import { keepTitleToken, recoverRename, recoverWeekday } from './session/corrections';
import { runVNextTurn, type TurnInput } from './pipeline';
import { withStructuredConfirmation } from './eval/structured-test-turn';
import { createSession, type VNextSession } from './session/session';

const NOW = '2026-10-18T06:00:00.000Z';
const REPORT: EntityRecord = { id: 'task-report', userId: 'user-1', type: 'task', name: 'Звіт', status: 'open', revision: 1 };
const FINANCE: EntityRecord = { id: 'task-finance', userId: 'user-1', type: 'task', name: 'Фінансовий звіт', status: 'open', revision: 1 };
const MORNING: EntityRecord = { id: 'design-am', userId: 'user-1', type: 'task', name: 'Ранкова зустріч із дизайнером', status: 'open', revision: 1, scheduledStart: '2026-10-19T07:00:00.000Z' };
const AFTERNOON: EntityRecord = { id: 'design-pm', userId: 'user-1', type: 'task', name: 'Зустріч із дизайнером після обіду', status: 'open', revision: 1, scheduledStart: '2026-10-19T13:00:00.000Z' };
const FLIGHT: EntityRecord = { id: 'ext-flight', userId: 'user-1', type: 'external_event', name: 'політ', status: 'open', revision: 1 };

function operation(partial: Pick<SemanticOperationV1, 'opId' | 'action' | 'target'> & Partial<SemanticOperationV1>): SemanticOperationV1 {
  return { changes: {}, constraints: [], dependsOn: [], source: { text: 'x' }, ...partial };
}

function envelope(operations: SemanticOperationV1[], control?: SemanticEnvelopeV1['control']): SemanticEnvelopeV1 {
  return { version: '1', kind: control ? 'control' : 'operations', operations, ...(control ? { control } : {}) };
}

async function turn(session: VNextSession, value: SemanticEnvelopeV1 | null, extra: Partial<TurnInput> = {}) {
  extra = withStructuredConfirmation(session, value, extra);
  return runVNextTurn(
    {
      transcript: value?.control === 'confirm_pending' ? 'Так' : 'x',
      userId: 'user-1',
      session,
      nowIso: NOW,
      timeZone: 'Europe/Kyiv',
      wakeHm: '08:00',
      sleepHm: '23:00',
      defaultDurationMinutes: 30,
      defaultReminderTime: '09:00',
      language: 'uk',
      arm: 'A',
      entities: [REPORT],
      ...extra,
    },
    {
      arm: 'A',
      interpret: async () => value
        ? { ok: true, envelope: value, reads: [], usage: { calls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 }, specialist: null, promptHash: 'test' }
        : { ok: false, reads: [], usage: { calls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 }, specialist: null, promptHash: 'test', code: 'invalid_model_output' },
    },
  );
}

describe('phase 4.7.9 operation identity', () => {
  it('updates the only report when the user changes it and does not say add', async () => {
    const session = createSession('user-1', 'duration');
    const preview = await turn(session, envelope([operation({
      opId: 'op-1',
      action: 'create',
      target: { kind: 'new', localId: 'new-1' },
      changes: { title: 'Звіт' },
      constraints: [
        { kind: 'date', value: '2026-10-21', precision: 'day' },
        { kind: 'clock', value: '10:00', role: 'start' },
        { kind: 'duration', minutes: 60 },
      ],
    })]), { transcript: 'Зроби звіт на годину 21 жовтня о 10:00.' });
    expect(preview.response.outcome).toBe('confirm');
    expect(JSON.stringify(preview.response.intents)).toContain('task-report');
    expect(JSON.stringify(preview.response.intents)).toContain('60');
    const shorter = await turn(session, envelope([operation({
      opId: 'op-1',
      action: 'create',
      target: { kind: 'new', localId: 'new-1' },
      changes: { title: 'Звіт' },
      constraints: [
        { kind: 'date', value: '2026-10-21', precision: 'day' },
        { kind: 'clock', value: '10:00', role: 'start' },
        { kind: 'duration', minutes: 90 },
      ],
    })]), { transcript: 'Не на годину, а на півтори.' });
    expect(shorter.response.outcome).toBe('confirm');
    expect(JSON.stringify(shorter.response.intents)).toContain('task-report');
    expect(JSON.stringify(shorter.response.intents)).toContain('90');
    expect(shorter.serverWrites).toBe(0);
  });

  it('still creates when the user explicitly adds a task', async () => {
    const session = createSession('user-1', 'add');
    const preview = await turn(session, envelope([operation({
      opId: 'op-1',
      action: 'create',
      target: { kind: 'new', localId: 'new-1' },
      changes: { title: 'звіт' },
    })]), { transcript: 'Додай задачу звіт.' });
    expect(preview.response.outcome).toBe('confirm');
    expect(JSON.stringify(preview.response.intents)).not.toContain('task-report');
  });

  it('does not invent a title from the word task', async () => {
    const session = createSession('user-1', 'title');
    const preview = await turn(session, envelope([operation({
      opId: 'op-1',
      action: 'create',
      target: { kind: 'new', localId: 'new-1' },
      changes: { title: 'Задача' },
    })]), { transcript: 'Створи задачу.' });
    expect(preview.response.outcome).toBe('clarify');
    expect(preview.response.intents).toHaveLength(0);
  });

  it('keeps a year in the title and does not schedule today', () => {
    const kept = keepTitleToken(operation({
      opId: 'op-1',
      action: 'create',
      target: { kind: 'new', localId: 'new-1' },
      changes: { title: 'звіт' },
      constraints: [{ kind: 'date', value: '2026-10-18', precision: 'day' }],
    }), 'Додай задачу звіт 2026.');
    expect(kept.changes.title).toBe('звіт 2026');
    expect(kept.constraints.some((constraint) => constraint.kind === 'date')).toBe(false);
  });
});

describe('phase 4.7.9 preview edits', () => {
  it('replaces a pending move with completion of the same task', async () => {
    const session = createSession('user-1', 'replace');
    const preview = await turn(session, envelope([operation({
      opId: 'op-1',
      action: 'move',
      target: { kind: 'existing', description: 'звіт' },
      constraints: [{ kind: 'weekday', weekday: 4, which: 'next' }],
    })]), { transcript: 'Перенеси звіт на четвер.' });
    expect(preview.response.outcome).toBe('confirm');
    const replaced = await turn(session, envelope([
      operation({ opId: 'op-1', action: 'move', target: { kind: 'existing', description: 'звіт' }, constraints: [{ kind: 'weekday', weekday: 4, which: 'next' }] }),
      operation({ opId: 'op-2', action: 'cancel', target: { kind: 'operation_result', opId: 'op-1' } }),
    ]), { transcript: 'Краще просто закрий його.' });
    expect(replaced.response.outcome).toBe('confirm');
    expect(JSON.stringify(replaced.response.intents)).toContain('task-report');
    expect(JSON.stringify(replaced.response.intents)).toContain('complete');
    expect(JSON.stringify(replaced.response.intents)).not.toContain('2026-10-22');
  });

  it('drops one pending create and keeps the other', async () => {
    const session = createSession('user-1', 'reject');
    await turn(session, envelope([
      operation({ opId: 'op-1', action: 'create', target: { kind: 'new', localId: 'a' }, changes: { title: 'хліб' } }),
      operation({ opId: 'op-2', action: 'create', target: { kind: 'new', localId: 'b' }, changes: { title: 'молоко' } }),
    ]), { transcript: 'Додай задачу хліб і задачу молоко.', entities: [] });
    const kept = await turn(session, envelope([
      operation({ opId: 'op-1', action: 'create', target: { kind: 'new', localId: 'a' }, changes: { title: 'хліб' } }),
      operation({ opId: 'op-2', action: 'create', target: { kind: 'new', localId: 'b' }, changes: { title: 'молоко' } }),
      operation({ opId: 'op-2', action: 'cancel', target: { kind: 'operation_result', opId: 'op-2' } }),
    ]), { transcript: 'Молоко не треба, хліб залиш.', entities: [] });
    expect(kept.response.outcome).toBe('confirm');
    const body = JSON.stringify(kept.response.intents);
    expect(body).toContain('хліб');
    expect(body).not.toContain('молоко');
    expect(kept.response.intents).toHaveLength(1);
  });

  it('renames the pending task and keeps its identity', async () => {
    const session = createSession('user-1', 'rename');
    await turn(session, envelope([operation({
      opId: 'op-1',
      action: 'create',
      target: { kind: 'new', localId: 'letter' },
      changes: { title: 'лист' },
    })]), { transcript: 'Додай задачу лист.', entities: [] });
    const renamed = await turn(session, envelope([operation({
      opId: 'op-1',
      action: 'create',
      target: { kind: 'new', localId: 'letter' },
      changes: { title: 'лист' },
    })]), { transcript: 'Перейменуй її на лист адвокату.', entities: [] });
    expect(renamed.response.outcome).toBe('confirm');
    expect(JSON.stringify(renamed.response.intents)).toContain('адвокату');
    expect(recoverRename(session.pendingOperations, 'Перейменуй її на лист адвокату.')?.[0].changes.title).toBe('лист адвокату');
  });

  it('revises the weekday when the model output is missing', async () => {
    const session = createSession('user-1', 'thursday');
    await turn(session, envelope([operation({
      opId: 'op-1',
      action: 'move',
      target: { kind: 'existing', description: 'звіт' },
      constraints: [{ kind: 'weekday', weekday: 3, which: 'next' }],
    })]), { transcript: 'Перенеси звіт на середу.' });
    const revised = await turn(session, null, { transcript: 'Так, але тільки на четвер.' });
    expect(revised.response.outcome).toBe('confirm');
    expect(JSON.stringify(revised.response.intents)).toContain('task-report');
    expect(revised.response.outcome).not.toBe('act');
    expect(recoverWeekday(session.pendingOperations, 'Так, але тільки на четвер.')).not.toBeNull();
  });

  it('does not leave a question open after a read-only refusal', async () => {
    const session = createSession('user-1', 'flight');
    const refused = await turn(session, envelope([operation({
      opId: 'op-1',
      action: 'move',
      target: { kind: 'existing', description: 'політ' },
      constraints: [{ kind: 'clock', value: '15:00', role: 'start' }],
    })]), { transcript: 'Перенеси політ на завтра о 15:00.', entities: [FLIGHT] });
    expect(refused.response.outcome).toBe('clarify');
    expect(refused.response.intents).toHaveLength(0);
    expect(session.openQuestion).toBeNull();
    const yes = await turn(session, envelope([], 'confirm_pending'), { transcript: 'Так, підтверджую.', entities: [FLIGHT] });
    expect(yes.response.outcome).not.toBe('act');
    expect(yes.response.intents).toHaveLength(0);
  });

  it('binds a later clock to the only report after an unanswered ordering question', async () => {
    const session = createSession('user-1', 'order');
    await turn(session, {
      version: '1',
      kind: 'clarification',
      operations: [],
      clarification: { question: 'Яку нараду?', operationIds: [], missing: ['target_task'] },
    }, { transcript: 'Постав звіт після наради.' });
    const next = await turn(session, envelope([operation({
      opId: 'op-1',
      action: 'create',
      target: { kind: 'new', localId: 'new-report' },
      changes: { title: 'Звіт' },
      constraints: [
        { kind: 'date', value: '2026-10-21', precision: 'day' },
        { kind: 'clock', value: '17:00', role: 'start' },
      ],
    })]), { transcript: 'Тоді просто на 21 жовтня о 17:00.' });
    expect(next.response.outcome).toBe('confirm');
    expect(JSON.stringify(next.response.intents)).toContain('task-report');
    expect(JSON.stringify(next.response.intents)).toContain('2026-10-21T14:00:00.000Z');
  });

  it('does not leave a confirmable question when the model reports a read-only target', async () => {
    const session = createSession('user-1', 'readonly-question');
    const refused = await turn(session, {
      version: '1',
      kind: 'clarification',
      operations: [],
      clarification: { question: 'Політ лише для читання.', operationIds: [], missing: ['writable_target'] },
    }, { transcript: 'Перенеси політ на завтра о 15:00.', entities: [FLIGHT] });
    expect(refused.response.outcome).toBe('clarify');
    expect(session.openQuestion).toBeNull();
    const yes = await turn(session, envelope([], 'confirm_pending'), { transcript: 'Так, підтверджую.', entities: [FLIGHT] });
    expect(yes.response.outcome).toBe('answer');
    expect(yes.response.intents).toHaveLength(0);
  });

  it('removes the named draft item when the model JSON is invalid', async () => {
    const session = createSession('user-1', 'draft-remove');
    session.planDraft = {
      day: '2026-10-19',
      stage: 'interview',
      interviewAsked: 0,
      revision: 1,
      nextNewId: 3,
      lastProposal: null,
      items: [
        { id: 'new:1', taskId: null, source: 'new', name: 'хліб', durationMinutes: 30, preferredHm: null, earliestHm: null, deadlineHm: null },
        { id: 'new:2', taskId: null, source: 'new', name: 'прогулянка', durationMinutes: 30, preferredHm: null, earliestHm: null, deadlineHm: null },
      ],
    };
    const removed = await turn(session, null, { transcript: 'Прибери прогулянку.', entities: [] });
    expect(removed.response.outcome).not.toBe('refuse');
    expect(session.planDraft?.items.map((item) => item.name)).toEqual(['хліб']);
  });

  it('keeps an explicitly timeless task when the model also emits a dateless reminder', async () => {
    const session = createSession('user-1', 'doctor');
    const result = await turn(session, envelope([operation({
      opId: 'op-1',
      action: 'create',
      target: { kind: 'new', localId: 't1' },
      changes: { title: 'зателефонувати лікарю', reminder: { op: 'create' } },
    })]), { transcript: 'Нагадай мені завдання зателефонувати лікарю, поки без часу.', entities: [] });
    expect(result.response.outcome).toBe('confirm');
    expect(JSON.stringify(result.response.intents)).toContain('лікар');
    expect(result.blocked).not.toContain('missing_day');
  });

  it('does not ask for a clock after the user already named the weekday', async () => {
    const session = createSession('user-1', 'friday');
    const result = await turn(session, {
      version: '1',
      kind: 'clarification',
      operations: [],
      clarification: { question: 'На яку годину в п\'ятницю створити follow-up?', operationIds: [], missing: ['clock'] },
    }, { transcript: 'У п\'ятницю зроби follow-up.', entities: [] });
    expect(result.response.outcome).toBe('confirm');
    expect(JSON.stringify(result.response.intents)).toContain('follow-up');
    expect(JSON.stringify(result.response.intents)).toContain('2026-10-23');
  });

  it('creates the quoted task when the model asks for a day the user did not mention', async () => {
    const session = createSession('user-1', 'priority');
    const result = await turn(session, {
      version: '1',
      kind: 'clarification',
      operations: [],
      clarification: { question: 'На який день додати задачу «підготувати презентацію»?', operationIds: [], missing: ['day'] },
    }, { transcript: 'Додай важливу задачу підготувати презентацію.', entities: [] });
    expect(result.response.outcome).toBe('confirm');
    expect(JSON.stringify(result.response.intents)).toContain('презентац');
  });

  it('switches a pending completion to the afternoon meeting', async () => {
    const session = createSession('user-1', 'switch');
    await turn(session, envelope([operation({
      opId: 'op-1',
      action: 'complete',
      target: { kind: 'existing', description: 'ранкову зустріч із дизайнером' },
    })]), { transcript: 'Закрий ранкову зустріч із дизайнером.', entities: [MORNING, AFTERNOON] });
    const switched = await turn(session, envelope([operation({
      opId: 'op-1',
      action: 'complete',
      target: { kind: 'existing', proposedId: 'design-am', description: 'ранкову зустріч із дизайнером' },
    })]), { transcript: 'Ні, іншу, після обіду.', entities: [MORNING, AFTERNOON] });
    expect(JSON.stringify(switched.response.intents)).toContain('design-pm');
    expect(JSON.stringify(switched.response.intents)).not.toContain('design-am');
    const other = createSession('user-1', 'switch-tu');
    await turn(other, envelope([operation({
      opId: 'op-1',
      action: 'complete',
      target: { kind: 'existing', description: 'ранкову зустріч із дизайнером' },
    })]), { transcript: 'Познач виконаною ранкову зустріч із дизайнером.', entities: [MORNING, AFTERNOON] });
    const afternoon = await turn(other, envelope([operation({
      opId: 'op-1',
      action: 'complete',
      target: { kind: 'existing', proposedId: 'design-am', description: 'ранкову зустріч із дизайнером' },
    })]), { transcript: 'Ні, ту після обіду.', entities: [MORNING, AFTERNOON] });
    expect(JSON.stringify(afternoon.response.intents)).toContain('design-pm');
    expect(JSON.stringify(afternoon.response.intents)).not.toContain('design-am');
  });

  it('revises duration when the correction JSON is missing', async () => {
    const session = createSession('user-1', 'half');
    await turn(session, envelope([operation({
      opId: 'op-1',
      action: 'update',
      target: { kind: 'existing', description: 'Звіт' },
      constraints: [
        { kind: 'date', value: '2026-10-21', precision: 'day' },
        { kind: 'clock', value: '10:00', role: 'start' },
        { kind: 'duration', minutes: 60 },
      ],
    })]), { transcript: 'Зроби звіт на годину 21 жовтня о 10:00.' });
    const longer = await turn(session, null, { transcript: 'Не на годину, а на півтори.' });
    expect(longer.response.outcome).toBe('confirm');
    expect(JSON.stringify(longer.response.intents)).toContain('90');
    expect(JSON.stringify(longer.response.intents)).toContain('task-report');
  });

  it('keeps the pending reminder when a later clock is phrased as a new create', async () => {
    const session = createSession('user-1', 'meds');
    await turn(session, envelope([operation({
      opId: 'op-1',
      action: 'remind',
      target: { kind: 'new', localId: 'meds' },
      changes: { title: 'ліки', reminder: { op: 'create', name: 'ліки', dueYmd: '2026-10-21', notificationTime: '08:00' } },
      constraints: [{ kind: 'date', value: '2026-10-21', precision: 'day' }, { kind: 'clock', value: '08:00', role: 'start' }],
    })]), { transcript: 'Нагадай 21 жовтня о 08:00 про ліки.', entities: [] });
    const later = await turn(session, envelope([operation({
      opId: 'op-1',
      action: 'create',
      target: { kind: 'new', localId: 'rem-1' },
      changes: { title: 'ліки', reminder: { op: 'update', name: 'ліки', dueYmd: '2026-10-21', notificationTime: '08:30' } },
    })]), { transcript: 'Краще о 08:30.', entities: [] });
    expect(later.response.outcome).toBe('confirm');
    expect(later.response.intents).toHaveLength(1);
    expect(JSON.stringify(later.response.intents)).toContain('08:30');
  });

  it('keeps the reminder day when a clock correction has no date constraint', async () => {
    const session = createSession('user-1', 'meds-day');
    await turn(session, envelope([operation({
      opId: 'op-1',
      action: 'remind',
      target: { kind: 'new', localId: 'meds' },
      changes: { title: 'ліки', reminder: { op: 'create', name: 'ліки', dueYmd: '2026-10-21', notificationTime: '08:00' } },
    })]), { transcript: 'Нагадай 21 жовтня о 08:00 про ліки.', entities: [] });
    const later = await turn(session, envelope([operation({
      opId: 'op-1',
      action: 'remind',
      target: { kind: 'operation_result', opId: 'op-1' },
      changes: { title: 'ліки', reminder: { op: 'create', name: 'ліки', dueYmd: '2026-10-21', notificationTime: '08:30' } },
    })]), { transcript: 'Краще о 08:30.', entities: [] });
    expect(later.response.outcome).toBe('confirm');
    expect(JSON.stringify(later.response.intents)).toContain('2026-10-21');
    expect(later.blocked).not.toContain('past');
  });

  it('answers a repeated yes when nothing is pending', async () => {
    const session = createSession('user-1', 'again');
    const result = await turn(session, {
      version: '1',
      kind: 'clarification',
      operations: [],
      clarification: { question: 'Що саме повторити?', operationIds: [], missing: [] },
    }, { transcript: 'Так ще раз.', entities: [] });
    expect(result.response.outcome).toBe('answer');
    expect(result.response.intents).toHaveLength(0);
  });

  it('treats close ok as a task reference, not a cancellation', async () => {
    const session = createSession('user-1', 'ok');
    const result = await turn(session, envelope([], 'cancel_pending'), { transcript: 'Закрий ок.', entities: [] });
    expect(result.response.outcome).toBe('clarify');
    expect(result.response.assistantMessage).not.toContain('Скасував');
  });
});

describe('phase 4.7.9 references and scoring', () => {
  it('matches the afternoon meeting from the compound word', () => {
    expect(relatedName('післяобідню зустріч із дизайнером', AFTERNOON.name)).toBe(true);
    expect(relatedName('післяобідню зустріч із дизайнером', MORNING.name)).toBe(false);
  });

  it('rejects a clock that belongs to a different operation than the id', () => {
    const verdict = judgeTurn({
      outcome: 'confirm',
      blocked: [],
      intents: [
        { type: 'command', summary: 'Звіт', command: { taskId: 'task-report', scheduledStartTime: '2026-10-21T07:00:00.000Z' } },
        { type: 'command', summary: 'інше', command: { taskId: 'task-other', scheduledStartTime: '2026-10-21T12:00:00.000Z' } },
      ],
      serverWrites: 0,
      assistantMessage: '15:00 task-report',
      draftNames: [],
      pendingCount: 2,
      timeZone: 'Europe/Kyiv',
    }, { outcomes: ['confirm'], taskId: 'task-report', includes: '15:00' });
    expect(verdict.completion).toBe(false);
    expect(verdict.safety).toBe(false);
  });

  it('does not select the finance report for a plain report', () => {
    expect(relatedName('звіт', FINANCE.name)).toBe(true);
    expect(relatedName('звіт', REPORT.name)).toBe(true);
  });
});
