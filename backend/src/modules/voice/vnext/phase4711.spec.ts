import type { ProposalGroup } from './contracts/proposal';
import type { SemanticEnvelopeV1 } from './contracts/types';
import { judgeTurn } from './eval/phase477-score';
import { expectBlocked, expectFailClosed, scheduledEntity } from './eval/structured-test-harness';
import type { EntityRecord } from './reference/reference-resolver';
import { runVNextTurn, type TurnInput } from './pipeline';
import { withStructuredConfirmation } from './eval/structured-test-turn';
import { createSession, type VNextSession } from './session/session';
import type { PlanDraft } from '../voice-agent.types';

const NOW = '2026-10-18T06:00:00.000Z';
const OK: EntityRecord = scheduledEntity('task-ok', 'ок');
const OK_LATIN: EntityRecord = scheduledEntity('task-ok-latin', 'OK');
const REPORT: EntityRecord = scheduledEntity('task-report', 'Звіт');
const CONFIRM: SemanticEnvelopeV1 = { version: '1', kind: 'control', operations: [], control: 'confirm_pending' };

function draft(): PlanDraft {
  return {
    day: '2026-10-19',
    stage: 'interview',
    interviewAsked: 1,
    items: [{ id: 'new:1', taskId: null, source: 'new', name: 'пробіжка', durationMinutes: 30, preferredHm: null, earliestHm: null, deadlineHm: null }],
    revision: 1,
    nextNewId: 2,
    lastProposal: null,
  };
}

async function turn(
  session: VNextSession,
  value: SemanticEnvelopeV1 | ProposalGroup | null,
  extra: Partial<TurnInput> = {},
  code?: string,
) {
  const isGroup = Boolean(value && typeof value === 'object' && 'proposals' in value && !('kind' in value));
  const envelope = isGroup ? undefined : (value as SemanticEnvelopeV1 | null);
  const group = isGroup ? (value as ProposalGroup) : undefined;
  extra = withStructuredConfirmation(session, envelope ?? null, extra, group);
  let calls = 0;
  const result = await runVNextTurn(
    {
      transcript: 'x',
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
      entities: [OK],
      ...extra,
    },
    {
      arm: 'A',
      interpret: async () => {
        calls += 1;
        if (!value) return { ok: false, reads: [], usage: { calls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 }, specialist: null, promptHash: 'test', code: code ?? 'invalid_model_output' };
        return {
          ok: true,
          ...(group ? { group } : { envelope: envelope! }),
          reads: extra.entities ? [] : [],
          usage: { calls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 },
          specialist: null,
          promptHash: 'test',
        };
      },
    },
  );
  return { result, calls };
}

describe('phase 4.7.11 confirmation versus a short title', () => {
  it('confirms a preview with bare ок and does not invent a task when nothing is pending', async () => {
    const pending = createSession('user-1', 'bare-yes');
    await turn(pending, {
      version: '1',
      kind: 'operations',
      operations: [{
        opId: 'op-1', action: 'move',
        target: { kind: 'existing', proposedId: 'task-report', description: 'Звіт' },
        changes: {},
        constraints: [
          { kind: 'date', value: '2026-10-22', precision: 'day' },
          { kind: 'clock', value: '10:00', role: 'start' },
        ],
        dependsOn: [],
        source: { text: 'move' },
      }],
    }, { transcript: 'Перенеси звіт на четвер.', entities: [REPORT] });
    const confirmed = await turn(pending, CONFIRM, { transcript: 'ок', entities: [REPORT] });
    expect(confirmed.result.response.outcome).toBe('act');
    expect(JSON.stringify(confirmed.result.response.intents)).toContain('task-report');

    const idle = createSession('user-1', 'bare-no');
    const empty = await turn(idle, CONFIRM, { transcript: 'ок', entities: [] });
    expectFailClosed(empty.result, { intents: 0 });
    expect(empty.result.serverWrites).toBe(0);
  });

  it('completes the task named ок and does not treat the verb as confirmation', async () => {
    const session = createSession('user-1', 'close-ok');
    // Linguistic “закрій ок” vs confirm is semantic; deterministic fixture is an explicit complete.
    const result = await turn(session, {
      version: '1',
      kind: 'operations',
      operations: [{
        opId: 'op-1', action: 'complete',
        target: { kind: 'existing', proposedId: 'task-ok', description: 'ок' },
        changes: {}, constraints: [], dependsOn: [], source: { text: 'close' },
      }],
    }, { transcript: 'Закрий ок.' });
    expect(result.result.response.outcome).toBe('confirm');
    expect(JSON.stringify(result.result.response.intents)).toContain('task-ok');
    expect(JSON.stringify(result.result.response.intents)).toContain('"kind":"complete"');
  });

  it('resolves a Latin OK title and the other completion verbs', async () => {
    for (const utterance of ['Закрий OK', 'Заверши ок', 'Виконай ок', 'Закрий задачу ок']) {
      const session = createSession('user-1', utterance);
      const entities = utterance === 'Закрий OK' ? [OK_LATIN] : [OK];
      const targetId = utterance === 'Закрий OK' ? 'task-ok-latin' : 'task-ok';
      const result = await turn(session, {
        version: '1',
        kind: 'operations',
        operations: [{
          opId: 'op-1', action: 'complete',
          target: { kind: 'existing', proposedId: targetId, description: utterance === 'Закрий OK' ? 'OK' : 'ок' },
          changes: {}, constraints: [], dependsOn: [], source: { text: utterance },
        }],
      }, { transcript: utterance, entities });
      expect(result.result.response.outcome).toBe('confirm');
      const body = JSON.stringify(result.result.response.intents);
      expect(body).toContain(targetId);
      expect(body).toContain('"kind":"complete"');
    }
  });

  it('asks when the short title is missing or repeated', async () => {
    const missing = await turn(createSession('user-1', 'none'), {
      version: '1',
      kind: 'operations',
      operations: [{
        opId: 'op-1', action: 'complete',
        target: { kind: 'existing', description: 'ок' },
        changes: {}, constraints: [], dependsOn: [], source: { text: 'close' },
      }],
    }, { transcript: 'Закрий ок.', entities: [] });
    expectFailClosed(missing.result, { intents: 0, blocked: 'unresolved' });
    const two = await turn(createSession('user-1', 'two'), {
      version: '1',
      kind: 'operations',
      operations: [{
        opId: 'op-1', action: 'complete',
        target: { kind: 'existing', description: 'ок' },
        changes: {}, constraints: [], dependsOn: [], source: { text: 'close' },
      }],
    }, { transcript: 'Закрий ок.', entities: [OK, { ...OK, id: 'task-ok-2', googleEventId: 'g-ok-2' }] });
    expectFailClosed(two.result, { intents: 0, blocked: 'ambiguous' });
  });

  it('does not apply an unrelated preview when the user names a different task', async () => {
    const session = createSession('user-1', 'switch');
    await turn(session, {
      version: '1',
      kind: 'operations',
      operations: [{
        opId: 'op-1', action: 'move',
        target: { kind: 'existing', proposedId: 'task-report', description: 'Звіт' },
        changes: {},
        constraints: [
          { kind: 'date', value: '2026-10-22', precision: 'day' },
          { kind: 'clock', value: '10:00', role: 'start' },
        ],
        dependsOn: [],
        source: { text: 'move' },
      }],
    }, { transcript: 'Перенеси звіт на четвер.', entities: [REPORT, OK] });
    // Replace boundary swaps the open move for complete(ок); report must not remain in the preview.
    const next = await turn(session, {
      version: '1',
      control: 'none',
      previewBoundary: 'replace',
      patches: [],
      proposals: [{
        localRef: 'op-2',
        action: 'complete',
        entityType: 'task',
        target: { kind: 'entity', entityId: 'task-ok' },
        scheduling: 'unscheduled',
        changes: {},
        constraints: [],
        dependsOn: [],
        known: [],
        missing: [],
        source: { text: 'close' },
      }],
    }, { transcript: 'Закрий ок', entities: [REPORT, OK] });
    expect(next.result.response.outcome).toBe('confirm');
    const body = JSON.stringify(next.result.response.intents);
    expect(body).toContain('task-ok');
    expect(body).not.toContain('task-report');
    expect(next.result.serverWrites).toBe(0);
  });

  it('replaces a blocked evening label when the follow-up gives a date and clock', async () => {
    const session = createSession('user-1', 'evening');
    await turn(session, {
      version: '1',
      kind: 'operations',
      operations: [{
        opId: 'op-1',
        action: 'update',
        target: { kind: 'existing', proposedId: 'task-report', description: 'звіт' },
        changes: {},
        constraints: [{ kind: 'time_of_day', label: 'evening', bound: 'at' }],
        dependsOn: [],
        source: { text: 'Постав звіт на вечір, годину не став.' },
      }],
    }, { transcript: 'Постав звіт на вечір, годину не став.', entities: [REPORT] });
    const revised = await turn(session, {
      version: '1',
      kind: 'operations',
      operations: [{
        opId: 'op-1',
        action: 'create',
        target: { kind: 'new', localId: 'new-report' },
        changes: { title: 'Звіт' },
        constraints: [
          { kind: 'date', value: '2026-10-23', precision: 'day' },
          { kind: 'clock', value: '18:15', role: 'start' },
        ],
        dependsOn: [],
        source: { text: '23 жовтня о 18:15' },
      }],
    }, { transcript: 'Тоді просто 23 жовтня о 18:15.', entities: [REPORT] });
    expect(revised.result.blocked).not.toContain('unrelated_answer');
    expect(revised.result.response.outcome).toBe('confirm');
    const body = JSON.stringify(revised.result.response.intents);
    expect(body).toContain('task-report');
    expect(body).toContain('2026-10-23T15:15:00.000Z');
  });

  it('does not confirm a preview from a mixed sentence or after a failed correction', async () => {
    const session = createSession('user-1', 'mixed');
    await turn(session, {
      version: '1',
      kind: 'operations',
      operations: [{
        opId: 'op-1', action: 'move',
        target: { kind: 'existing', proposedId: 'task-report', description: 'Звіт' },
        changes: {},
        constraints: [
          { kind: 'date', value: '2026-10-22', precision: 'day' },
          { kind: 'clock', value: '10:00', role: 'start' },
        ],
        dependsOn: [],
        source: { text: 'move' },
      }],
    }, { transcript: 'Перенеси звіт на четвер.', entities: [REPORT] });
    const mixed = await turn(session, CONFIRM, {
      transcript: 'Так, але закрий іншу задачу',
      entities: [REPORT, OK],
      confirmation: null as unknown as undefined,
    });
    expect(mixed.result.response.outcome).not.toBe('act');
    expectBlocked(mixed.result, 'missing_confirmation_claim');
    session.previewSuspended = true;
    const after = await turn(session, CONFIRM, {
      transcript: 'так',
      entities: [REPORT],
      confirmation: null as unknown as undefined,
    });
    expect(after.result.response.outcome).not.toBe('act');
    expect(after.result.serverWrites).toBe(0);
  });
});

describe('phase 4.7.11 transport and draft preservation', () => {
  it('names a timeout, an HTTP failure, and provider unavailability without clearing the draft', async () => {
    const cases: Array<[string, string]> = [
      ['timeout', 'Час очікування'],
      ['provider_or_transport_error', 'Не вдалося зв'],
      ['provider_unavailable', 'тимчасово недоступна'],
    ];
    for (const [code, snippet] of cases) {
      const session = createSession('user-1', code);
      session.planDraft = draft();
      session.pendingIntents = [{ type: 'command', summary: 'Звіт', command: { kind: 'update', taskId: 'task-report' } }];
      const { result } = await turn(session, null, { transcript: 'Які завтра вільні проміжки?' }, code);
      expect(result.response.outcome).toBe('refuse');
      expect(result.response.assistantMessage).toContain(snippet);
      expect(result.response.assistantMessage).not.toContain('Не зрозумів');
      expect(session.planDraft?.items).toHaveLength(1);
      // Legacy pendingIntents may be null under structured; draft preservation is the invariant.
      expect(session.planDraft).not.toBeNull();
      expect(result.serverWrites).toBe(0);
    }
  });

  it('keeps the misunderstanding copy for invalid model output and preserves the draft', async () => {
    const session = createSession('user-1', 'json');
    session.planDraft = draft();
    const { result } = await turn(session, null, { transcript: 'Які завтра вільні проміжки?' }, 'invalid_model_output');
    expect(result.response.assistantMessage).toContain('Не зрозумів');
    expect(session.planDraft?.items.map((item) => item.name)).toEqual(['пробіжка']);
  });

  it('reports a failed read without claiming a gap and then accepts a later answer', async () => {
    const session = createSession('user-1', 'read');
    session.planDraft = draft();
    const failed = await runVNextTurn(
      {
        transcript: 'Які завтра вільні проміжки?',
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
        entities: [],
      },
      {
        arm: 'A',
        interpret: async () => ({
          ok: true,
          envelope: { version: '1', kind: 'answer', operations: [], answer: { text: 'Ось вільні проміжки.', evidenceRefs: ['r1'] } },
          reads: [{ requestId: 'r1', name: 'find_free_gaps', args: { day: '2026-10-19' }, ok: false, error: 'timeout' }],
          usage: { calls: 1, inputTokens: 1, outputTokens: 1, latencyMs: 1 },
          specialist: null,
          promptHash: 'test',
        }),
      },
    );
    expect(failed.blocked).toContain('tool_error');
    expect(failed.response.assistantMessage).not.toContain('Не зрозумів');
    expect(failed.response.assistantMessage).not.toContain('Ось вільні');
    expect(session.planDraft?.items).toHaveLength(1);
    const recovered = await turn(session, {
      version: '1',
      kind: 'answer',
      operations: [],
      answer: { text: 'Не бачу вільних проміжків у наявних даних.', evidenceRefs: [] },
    }, { transcript: 'Які завтра вільні проміжки?', entities: [] });
    expect(recovered.result.response.outcome).toBe('answer');
    expect(session.planDraft?.items).toHaveLength(1);
    expect(session.pendingOperations).toHaveLength(0);
  });
});

describe('phase 4.7.11 scorer', () => {
  it('rejects an extra target and a false completion claim', () => {
    const extra = judgeTurn({
      outcome: 'confirm',
      blocked: [],
      intents: [
        { type: 'command', summary: 'ок', command: { kind: 'complete', taskId: 'task-ok' } },
        { type: 'command', summary: 'Звіт', command: { kind: 'update', taskId: 'task-report' } },
      ],
      serverWrites: 0,
      assistantMessage: 'Прев’ю, ще не записано в календар',
      draftNames: [],
      pendingCount: 2,
      timeZone: 'Europe/Kyiv',
    }, { outcomes: ['confirm'], taskId: 'task-ok', action: 'complete' });
    expect(extra.safety).toBe(false);
    expect(extra.completion).toBe(false);
    const claim = judgeTurn({
      outcome: 'act',
      blocked: [],
      intents: [{ type: 'command', summary: 'ок', command: { kind: 'complete', taskId: 'task-ok' } }],
      serverWrites: 0,
      assistantMessage: 'Записано в календар.',
      draftNames: [],
      pendingCount: 0,
      timeZone: 'Europe/Kyiv',
    }, { outcomes: ['act'], taskId: 'task-ok', action: 'complete' });
    expect(claim.safety).toBe(false);
  });
});
