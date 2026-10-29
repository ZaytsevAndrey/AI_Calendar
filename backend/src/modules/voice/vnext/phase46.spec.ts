import type { SemanticEnvelopeV1, SemanticOperationV1 } from './contracts/types';
import { buildTurnUser } from './interpreters/prompts';
import { runVNextTurn, type TurnInput } from './pipeline';
import { withStructuredConfirmation } from './eval/structured-test-turn';
import type { EntityRecord } from './reference/reference-resolver';
import { createSession, exportSession, restoreSession, type VNextSession } from './session/session';

const NOW = '2026-10-18T06:00:00.000Z';

function operation(partial: Partial<SemanticOperationV1> & Pick<SemanticOperationV1, 'opId' | 'action' | 'target'>): SemanticOperationV1 {
  return { changes: {}, constraints: [], dependsOn: [], source: { text: 'hello' }, ...partial };
}

function createEnvelope(title: string): SemanticEnvelopeV1 {
  return {
    version: '1',
    kind: 'operations',
    operations: [operation({
      opId: 'op-1',
      action: 'create',
      target: { kind: 'new', localId: 'item' },
      changes: { title },
      source: { text: title },
    })],
  };
}

function control(name: 'confirm_pending' | 'cancel_pending'): SemanticEnvelopeV1 {
  return { version: '1', kind: 'control', operations: [], control: name };
}

async function turn(session: VNextSession, envelope: SemanticEnvelopeV1, extra: Partial<TurnInput> = {}) {
  extra = withStructuredConfirmation(session, envelope, extra);
  return runVNextTurn(
    {
      transcript: extra.transcript ?? 'hello',
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
    {
      arm: 'A',
      interpret: async () => ({ ok: true, envelope, reads: [], usage: { calls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 }, specialist: null, promptHash: 'phase46' }),
    },
  );
}

describe('Phase 4.6 session context and safety', () => {
  it('puts recent dialogue and the pending preview in the interpreter prompt', () => {
    const prompt = buildTurnUser({
      transcript: 'Ні, перенеси на 12.',
      nowLocal: '2026-10-18 09:00',
      timeZone: 'Europe/Kyiv',
      wakeHm: '08:00',
      sleepHm: '23:00',
      scheduleToday: '2026-10-18',
      tomorrow: '2026-10-19',
      weekdays: 'Sunday 2026-10-18',
      defaultDurationMinutes: 30,
      language: 'uk',
      owned: [],
      openQuestion: null,
      pending: true,
      history: [
        { role: 'user', text: 'Створи зустріч завтра о 10.' },
        { role: 'assistant', text: 'Зустріч' },
      ],
      pendingSummary: 'Зустріч',
      canceledOpIds: [],
      appliedCount: 0,
    });
    expect(prompt).toContain('Створи зустріч завтра о 10.');
    expect(prompt).toContain('Pending preview: Зустріч');
    expect(prompt).not.toContain('task-foreign');
  });

  it('sends the previous turn, not the current utterance, on the next call', async () => {
    const session = createSession('user-1', 'dialogue');
    const prompts: string[] = [];
    const interpret = async (user: string) => {
      prompts.push(user);
      return {
        ok: true as const,
        envelope: prompts.length === 1 ? createEnvelope('Зустріч') : control('cancel_pending'),
        reads: [],
        usage: { calls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 },
        specialist: null,
        promptHash: 'phase46',
      };
    };
    const base: TurnInput = {
      transcript: 'Створи зустріч завтра о 10.',
      userId: 'user-1',
      session,
      nowIso: NOW,
      timeZone: 'Europe/Kyiv',
      wakeHm: '08:00',
      sleepHm: '23:00',
      defaultDurationMinutes: 30,
      language: 'uk',
      arm: 'A',
      entities: [],
    };
    const created = await runVNextTurn(base, { arm: 'A', interpret });
    expect(created.response.outcome).toBe('confirm');
    expect(created.serverWrites).toBe(0);
    await runVNextTurn({ ...base, transcript: 'Ні, перенеси на 12.' }, { arm: 'A', interpret });
    // Structured pending context is JSON (protocol + preview claim), not the prior Ukrainian utterance.
    expect(prompts[1]).toMatch(/Pending preview:|"protocol":"structured"|"pending":true/);
    expect(prompts[1]).toContain('executionId');
    expect(prompts[1]).not.toContain('Utterance:\nНі, перенеси на 12.\nНі, перенеси на 12.');
  });

  it('previews every exact name match and does not keep one proposed id', async () => {
    const entities: EntityRecord[] = [
      { id: 'task-a', userId: 'user-1', type: 'task', name: 'Нарада', status: 'open' },
      { id: 'task-b', userId: 'user-1', type: 'task', name: 'Нарада', status: 'open' },
    ];
    const result = await turn(createSession('user-1', 'bulk'), {
      version: '1',
      kind: 'operations',
      operations: [operation({
        opId: 'op-1',
        action: 'delete',
        target: { kind: 'existing', proposedId: 'task-a', description: 'Нарада' },
        scope: 'all',
        source: { text: 'Видали всі наради' },
      })],
    }, { transcript: 'Видали всі наради', entities, searchReceipt: { complete: true, ids: ['task-a', 'task-b'] } });
    expect(result.serverWrites).toBe(0);
    expect(result.response.outcome).toBe('confirm');
    expect(result.response.intents).toHaveLength(2);
    const ids = result.response.intents.map((intent) => intent.type === 'command' ? intent.command.taskId : null);
    expect(ids).toEqual(['task-a', 'task-b']);
  });

  it('does not apply the same preview twice', async () => {
    const session = createSession('user-1', 'idem');
    const entities: EntityRecord[] = [{ id: 'task-a', userId: 'user-1', type: 'task', name: 'Нарада', status: 'open', revision: 1 }];
    const preview = await turn(session, {
      version: '1',
      kind: 'operations',
      operations: [operation({
        opId: 'op-1',
        action: 'delete',
        target: { kind: 'existing', proposedId: 'task-a', description: 'Нарада' },
        source: { text: 'Видали нараду' },
      })],
    }, { transcript: 'Видали нараду', entities });
    expect(preview.response.outcome).toBe('confirm');
    const applied = await turn(session, control('confirm_pending'), { transcript: 'Так', entities });
    expect(applied.response.outcome).toBe('act');
    expect(applied.serverWrites).toBe(0);
    session.pendingIntents = applied.response.intents;
    session.pendingSummary = applied.response.assistantMessage;
    const retry = await turn(session, control('confirm_pending'), { transcript: 'Так', entities });
    expect(retry.response.outcome).toBe('answer');
    expect(retry.response.intents).toEqual([]);
    expect(retry.blocked).toContain('already_applied');
    expect(retry.serverWrites).toBe(0);
  });

  it('stops a confirmation when the previewed record changed', async () => {
    const session = createSession('user-1', 'stale');
    const entity: EntityRecord = { id: 'task-a', userId: 'user-1', type: 'task', name: 'Нарада', status: 'open', revision: 1 };
    const preview = await turn(session, {
      version: '1',
      kind: 'operations',
      operations: [operation({
        opId: 'op-1',
        action: 'delete',
        target: { kind: 'existing', proposedId: 'task-a', description: 'Нарада' },
        source: { text: 'Видали нараду' },
      })],
    }, { transcript: 'Видали нараду', entities: [entity] });
    expect(preview.response.outcome).toBe('confirm');
    entity.revision = 2;
    const confirmed = await turn(session, control('confirm_pending'), { transcript: 'Так', entities: [entity] });
    expect(confirmed.response.outcome).toBe('clarify');
    expect(confirmed.response.intents).toEqual([]);
    expect(confirmed.blocked).toContain('stale_preview');
    expect(confirmed.serverWrites).toBe(0);
  });

  it('restores a pending question and rejects an expired snapshot', () => {
    const session = createSession('user-1', 'resume');
    session.openQuestion = 'На який день?';
    session.canceledOpIds = ['op-9'];
    session.pendingIntents = null;
    const raw = exportSession(session, NOW);
    const restored = restoreSession(raw, NOW);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.session.openQuestion).toBe('На який день?');
    expect(restored.session.canceledOpIds).toEqual(['op-9']);
    expect(restored.session.pendingIntents).toBeNull();
    expect(restoreSession(raw, '2026-10-20T06:00:00.000Z')).toEqual({ ok: false, reason: 'expired' });
  });

  it('does not answer from a failed calendar read', async () => {
    const result = await runVNextTurn(
      {
        transcript: 'Що в мене завтра?',
        userId: 'user-1',
        session: createSession('user-1', 'read'),
        nowIso: NOW,
        timeZone: 'Europe/Kyiv',
        wakeHm: '08:00',
        sleepHm: '23:00',
        defaultDurationMinutes: 30,
        language: 'uk',
        arm: 'A',
        entities: [],
      },
      {
        arm: 'A',
        interpret: async () => ({
          ok: true,
          envelope: {
            version: '1',
            kind: 'answer',
            operations: [],
            answer: { text: 'Нічого немає.', evidenceRefs: ['r1'] },
          },
          reads: [{ requestId: 'r1', name: 'get_day_agenda', args: {}, ok: false, error: 'timeout' }],
          usage: { calls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 },
          specialist: null,
          promptHash: 'phase46',
        }),
      },
    );
    expect(result.response.outcome).toBe('refuse');
    expect(result.blocked).toContain('tool_error');
    expect(result.response.assistantMessage).not.toContain('Нічого немає');
    expect(result.serverWrites).toBe(0);
  });
});
