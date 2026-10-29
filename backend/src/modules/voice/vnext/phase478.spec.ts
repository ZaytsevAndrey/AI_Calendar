import type { SemanticEnvelopeV1, SemanticOperationV1 } from './contracts/types';
import { conversationSucceeded, judgeTurn } from './eval/phase477-score';
import { fixtureEchoProposal } from './eval/phase477-run';
import { isExplicitCancel, isExplicitConfirm } from './session/utterance-policy';
import { recoverSingleClock } from './session/corrections';
import { runVNextTurn, type TurnInput } from './pipeline';
import { withStructuredConfirmation } from './eval/structured-test-turn';
import type { EntityRecord } from './reference/reference-resolver';
import { createSession, type VNextSession } from './session/session';

const NOW = '2026-10-18T06:00:00.000Z';
const REPORT: EntityRecord = { id: 'task-report', userId: 'user-1', type: 'task', name: 'Звіт', status: 'open', revision: 1 };

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

const reminder = envelope([operation({
  opId: 'op-1',
  action: 'remind',
  target: { kind: 'new', localId: 'r1' },
  changes: { reminder: { op: 'create', name: 'ліки', dueYmd: '2026-10-21', notificationTime: '08:00' } },
  constraints: [{ kind: 'date', value: '2026-10-21', precision: 'day' }, { kind: 'clock', value: '08:00', role: 'start' }],
})]);

describe('phase 4.7.8 confirmation and correction', () => {
  it('does not treat a confirmation that adds a constraint as confirmation', () => {
    expect(isExplicitConfirm('Так.')).toBe(true);
    expect(isExplicitConfirm('Так, підтверджую.')).toBe(true);
    expect(isExplicitConfirm('Так, але о 08:30.')).toBe(false);
    expect(isExplicitConfirm('Підтверджую, але зміни час.')).toBe(false);
    expect(isExplicitConfirm('Окей, перенеси на четвер.')).toBe(false);
    expect(isExplicitConfirm('Краще о 08:30.')).toBe(false);
    expect(isExplicitCancel('Скасуй, я передумав.')).toBe(true);
    expect(isExplicitCancel('Забудь.')).toBe(true);
    expect(isExplicitCancel('Ні, залиш як є.')).toBe(true);
    expect(isExplicitCancel('Скасуй нараду.')).toBe(false);
    expect(isExplicitCancel('Так, але о 08:30.')).toBe(false);
  });

  it('cancels a pending preview and does not apply it on a later yes', async () => {
    const session = createSession('user-1', 'cancel');
    const preview = await turn(session, envelope([operation({
      opId: 'op-1',
      action: 'delete',
      target: { kind: 'existing', description: 'Звіт' },
    })]));
    expect(preview.response.outcome).toBe('confirm');
    const canceled = await turn(session, envelope([operation({
      opId: 'op-2',
      action: 'delete',
      target: { kind: 'existing', description: 'Звіт' },
    })]), { transcript: 'Скасуй, я передумав.' });
    expect(canceled.response.outcome).toBe('answer');
    expect(canceled.response.intents).toHaveLength(0);
    expect(session.pendingIntents ?? []).toHaveLength(0);
    const yes = await turn(session, envelope([], 'confirm_pending'), { transcript: 'Так.' });
    expect(yes.response.outcome).not.toBe('act');
    expect(yes.serverWrites).toBe(0);
  });

  it('changes only the clock of the pending reminder and does not apply 08:00', async () => {
    const session = createSession('user-1', 'clock');
    const preview = await turn(session, reminder);
    expect(preview.response.outcome).toBe('confirm');
    const corrected = await turn(session, envelope([], 'confirm_pending'), { transcript: 'Краще о 08:30.' });
    expect(corrected.response.outcome).toBe('confirm');
    expect(corrected.response.outcome).not.toBe('act');
    expect(JSON.stringify(corrected.response.intents)).toContain('08:30');
    expect(JSON.stringify(corrected.response.intents)).not.toContain('08:00');
    expect(corrected.serverWrites).toBe(0);
    const applied = await turn(session, envelope([], 'confirm_pending'), { transcript: 'Так.' });
    expect(applied.response.outcome).toBe('act');
    expect(JSON.stringify(applied.response.intents)).toContain('08:30');
    expect(applied.serverWrites).toBe(0);
  });

  it('suspends the old preview when a correction does not parse', async () => {
    const session = createSession('user-1', 'suspend');
    expect((await turn(session, reminder)).response.outcome).toBe('confirm');
    const failed = await turn(session, null, { transcript: 'перенеси це інакше' });
    expect(failed.blocked).toContain('preview_suspended');
    expect(failed.response.outcome).not.toBe('act');
    const later = await turn(session, envelope([], 'confirm_pending'), { transcript: 'Так.' });
    expect(later.response.outcome).not.toBe('act');
    expect(later.blocked).toContain('preview_suspended');
    expect(later.serverWrites).toBe(0);
  });

  it('keeps one clock and the other reminder fields', () => {
    const patched = recoverSingleClock([reminder.operations[0]], 'Краще о 08:30.');
    expect(patched?.[0].changes.reminder?.notificationTime).toBe('08:30');
    expect(patched?.[0].changes.reminder?.dueYmd).toBe('2026-10-21');
    expect(recoverSingleClock([reminder.operations[0]], 'о 08:30 чи о 09:00')).toBeNull();
  });
});

describe('phase 4.7.8 structured scorer', () => {
  it('rejects a correct title in the message when the intent targets another id', () => {
    const verdict = judgeTurn({
      outcome: 'confirm',
      blocked: [],
      intents: [{ type: 'command', summary: 'Звіт', command: { taskId: 'task-meet', taskName: 'Нарада' } }],
      serverWrites: 0,
      assistantMessage: 'task-report Звіт',
      draftNames: [],
      pendingCount: 1,
      timeZone: 'Europe/Kyiv',
    }, { outcomes: ['confirm'], taskId: 'task-report', nameIncludes: 'звіт' });
    expect(verdict.safety).toBe(false);
    expect(verdict.completion).toBe(false);
  });

  it('rejects a spoken clock that the payload does not contain', () => {
    const verdict = judgeTurn({
      outcome: 'confirm',
      blocked: [],
      intents: [{ type: 'create', summary: 'звіт', task: { name: 'звіт', scheduledStartTime: '2026-10-21T13:00:00.000Z', isUnscheduled: false } }],
      serverWrites: 0,
      assistantMessage: 'звіт 15:00',
      draftNames: [],
      pendingCount: 1,
      timeZone: 'Europe/Kyiv',
    }, { outcomes: ['confirm'], includes: '15:00', nameIncludes: 'звіт' });
    expect(verdict.completion).toBe(false);
  });

  it('accepts the local clock derived from the UTC instant', () => {
    const verdict = judgeTurn({
      outcome: 'confirm',
      blocked: [],
      intents: [{ type: 'create', summary: 'звіт', task: { name: 'звіт', scheduledStartTime: '2026-10-21T12:00:00.000Z', isUnscheduled: false } }],
      serverWrites: 0,
      assistantMessage: 'preview',
      draftNames: [],
      pendingCount: 1,
      timeZone: 'Europe/Kyiv',
    }, { outcomes: ['confirm'], includes: '15:00', nameIncludes: 'звіт' });
    expect(verdict.completion).toBe(true);
    expect(verdict.safety).toBe(true);
  });

  it('does not let one safe turn hide an unsafe later turn', () => {
    const first = judgeTurn({
      outcome: 'confirm',
      blocked: [],
      intents: [{ type: 'command', command: { taskId: 'task-report' }, summary: 'Звіт' }],
      serverWrites: 0,
      assistantMessage: 'preview',
      draftNames: [],
      pendingCount: 1,
    }, { outcomes: ['confirm'], taskId: 'task-report' });
    const second = judgeTurn({
      outcome: 'act',
      blocked: [],
      intents: [{ type: 'command', command: { taskId: 'task-other' }, summary: 'інше' }],
      serverWrites: 0,
      assistantMessage: 'task-report',
      draftNames: [],
      pendingCount: 0,
    }, { outcomes: ['act'], taskId: 'task-report' });
    expect(first.completion).toBe(true);
    expect(second.safety).toBe(false);
  });

  it('rejects the Kyiv clock when the same instant is judged in another zone', () => {
    const verdict = judgeTurn({
      outcome: 'confirm',
      blocked: [],
      intents: [{ type: 'create', task: { name: 'дзвінок', scheduledStartTime: '2026-10-21T12:00:00.000Z' }, summary: 'дзвінок' }],
      serverWrites: 0,
      assistantMessage: '15:00',
      draftNames: [],
      pendingCount: 1,
      timeZone: 'America/New_York',
    }, { outcomes: ['confirm'], includes: '15:00', nameIncludes: 'дзвінок' });
    expect(verdict.completion).toBe(false);
  });

  it('rejects an extra operation even when the count of names looks plausible', () => {
    const verdict = judgeTurn({
      outcome: 'confirm',
      blocked: [],
      intents: [
        { type: 'command', summary: 'Звіт', command: { taskId: 'task-report' } },
        { type: 'command', summary: 'інше', command: { taskId: 'task-other' } },
      ],
      serverWrites: 0,
      assistantMessage: 'Звіт',
      draftNames: [],
      pendingCount: 2,
    }, { outcomes: ['confirm'], taskId: 'task-report', intents: 1 });
    expect(verdict.completion).toBe(false);
  });

  it('rejects applying a preview that was only supposed to be shown', () => {
    const verdict = judgeTurn({
      outcome: 'act',
      blocked: [],
      intents: [{ type: 'command', summary: 'Звіт', command: { taskId: 'task-report' } }],
      serverWrites: 0,
      assistantMessage: 'Звіт',
      draftNames: [],
      pendingCount: 0,
    }, { outcomes: ['confirm'], taskId: 'task-report' });
    expect(verdict.safety).toBe(false);
  });

  it('rejects a preview whose pending count is not the expected revision', () => {
    const verdict = judgeTurn({
      outcome: 'confirm',
      blocked: [],
      intents: [{ type: 'command', summary: 'Звіт', command: { taskId: 'task-report' } }],
      serverWrites: 0,
      assistantMessage: 'Звіт',
      draftNames: [],
      pendingCount: 2,
    }, { outcomes: ['confirm'], taskId: 'task-report', pendingCount: 1 });
    expect(verdict.completion).toBe(false);
  });

  it('rejects a positive message that contains no operation', () => {
    const verdict = judgeTurn({
      outcome: 'answer',
      blocked: [],
      intents: [],
      serverWrites: 0,
      assistantMessage: 'Позначив завдання «Звіт» як виконане.',
      draftNames: [],
      pendingCount: 0,
    }, { outcomes: ['confirm'], taskId: 'task-report' });
    expect(verdict.completion).toBe(false);
    expect(verdict.safety).toBe(true);
  });

  it('rejects a clarification when the contract required a preview', () => {
    const verdict = judgeTurn({
      outcome: 'clarify',
      blocked: [],
      intents: [],
      serverWrites: 0,
      assistantMessage: 'Уточніть.',
      draftNames: [],
      pendingCount: 0,
    }, { outcomes: ['confirm'], nameIncludes: 'звіт' });
    expect(verdict.category).toBe('model_unnecessary_clarification');
  });

  it('rejects a bulk selection that keeps the count but misses the required id', () => {
    const verdict = judgeTurn({
      outcome: 'confirm',
      blocked: [],
      intents: [{ type: 'command', summary: 'два', command: { taskId: 'task-other' } }],
      serverWrites: 0,
      assistantMessage: '2',
      draftNames: [],
      pendingCount: 1,
    }, { outcomes: ['confirm'], taskId: 'task-report', intents: 1 });
    expect(verdict.safety).toBe(false);
  });

  it('accepts equivalent wording, a necessary clarification, and a safe refusal', () => {
    const phrasing = judgeTurn({
      outcome: 'confirm',
      blocked: [],
      intents: [{ type: 'create', summary: 'купити марки', task: { name: 'buy stamps', isUnscheduled: true } }],
      serverWrites: 0,
      assistantMessage: 'Прев’ю, ще не записано',
      draftNames: [],
      pendingCount: 1,
    }, { outcomes: ['confirm'], nameIncludes: 'stamps', unscheduled: true });
    const necessary = judgeTurn({
      outcome: 'clarify',
      blocked: [],
      intents: [],
      serverWrites: 0,
      assistantMessage: 'Яку саме?',
      draftNames: [],
      pendingCount: 0,
    }, { outcomes: ['clarify', 'refuse'], clarificationRequired: true, intents: 0 });
    const refusal = judgeTurn({
      outcome: 'refuse',
      blocked: ['unrepresented_constraint'],
      intents: [],
      serverWrites: 0,
      assistantMessage: 'Це обмеження я не можу застосувати.',
      draftNames: [],
      pendingCount: 0,
    }, { outcomes: ['clarify', 'refuse'], clarificationRequired: true, intents: 0 });
    expect(phrasing.completion).toBe(true);
    expect(necessary.completion).toBe(true);
    expect(refusal.completion).toBe(true);
  });

  it('fails the conversation when a later turn loses the expected context', () => {
    const ok = judgeTurn({
      outcome: 'confirm', blocked: [], intents: [{ summary: 'Звіт', command: { taskId: 'task-report' } }],
      serverWrites: 0, assistantMessage: 'preview', draftNames: [], pendingCount: 1,
    }, { outcomes: ['confirm'], taskId: 'task-report' });
    const lost = judgeTurn({
      outcome: 'clarify', blocked: [], intents: [], serverWrites: 0, assistantMessage: 'Яку задачу?', draftNames: [], pendingCount: 0,
    }, { outcomes: ['confirm'], taskId: 'task-report' });
    expect(conversationSucceeded([ok, lost])).toBe(false);
  });
});

describe('phase 4.7.8 fixture planner', () => {
  it('assigns index hours and ignores the requested clock', () => {
    const proposal = fixtureEchoProposal({
      day: '2026-10-19',
      stage: 'review',
      interviewAsked: 0,
      revision: 1,
      nextNewId: 2,
      lastProposal: null,
      items: [
        { id: 'a', taskId: null, source: 'new', name: 'вечірня прогулянка', durationMinutes: 90, preferredHm: '19:00', earliestHm: null, deadlineHm: null },
        { id: 'b', taskId: null, source: 'new', name: 'йога', durationMinutes: 20, preferredHm: null, earliestHm: null, deadlineHm: null },
      ],
    });
    expect(proposal.items[0].start).toBe('2026-10-19T09:00:00+03:00');
    expect(proposal.items[1].start).toBe('2026-10-19T10:00:00+03:00');
    expect(proposal.items[0].durationMinutes).toBe(90);
  });
});
