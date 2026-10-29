import { validateSemanticEnvelope } from './contracts/validate';
import type { SemanticEnvelopeV1, SemanticOperationV1 } from './contracts/types';
import { runVNextTurn } from './pipeline';
import type { EntityRecord } from './reference/reference-resolver';
import { createSession } from './session/session';
import { scoreSemanticOutcome } from './eval/semantic-outcome';

const NOW = '2026-10-18T06:00:00.000Z';
const TASK: EntityRecord = { id: 'task-1', userId: 'user-1', type: 'task', name: 'Нарада', status: 'open' };

function operation(partial: Partial<SemanticOperationV1> & Pick<SemanticOperationV1, 'opId' | 'action' | 'target'>): SemanticOperationV1 {
  return { changes: {}, constraints: [], dependsOn: [], source: { text: 'hello' }, ...partial };
}

async function turn(envelope: SemanticEnvelopeV1, transcript = 'hello') {
  return runVNextTurn(
    {
      transcript,
      userId: 'user-1',
      session: createSession('user-1', 'phase45'),
      nowIso: NOW,
      timeZone: 'Europe/Kyiv',
      wakeHm: '08:00',
      sleepHm: '23:00',
      defaultDurationMinutes: 30,
      language: 'uk',
      arm: 'A',
      entities: [TASK],
    },
    {
      arm: 'A',
      interpret: async () => ({ ok: true, envelope, reads: [], usage: { calls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 }, specialist: null, promptHash: 'phase45' }),
    },
  );
}

describe('Phase 4.5 contract and pipeline', () => {
  it('accepts a top-level question as a clarification and does not invent an operation', () => {
    const raw = '{"version":"1","kind":"clarification","question":"Яку зустріч видалити?"}';
    const parsed = validateSemanticEnvelope(raw, 'Видали всі зустрічі');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.envelope.operations).toEqual([]);
    expect(parsed.envelope.clarification?.question).toBe('Яку зустріч видалити?');
  });

  it('maps an unambiguous evening label and keeps an English label', () => {
    const text = 'Прогулянка ввечері';
    const raw = JSON.stringify({
      version: '1',
      kind: 'operations',
      operations: [{
        opId: 'op-1',
        action: 'create',
        target: { kind: 'new', localId: 'walk' },
        changes: { title: 'Прогулянка' },
        constraints: [{ kind: 'time_of_day', label: 'вечір', bound: 'at' }],
        dependsOn: [],
        source: { text },
      }],
    });
    const parsed = validateSemanticEnvelope(raw, text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.envelope.operations[0]?.constraints).toContainEqual({ kind: 'time_of_day', label: 'evening', bound: 'at' });
  });

  it('rejects an unknown action instead of turning it into create', () => {
    const raw = '{"version":"1","kind":"operations","operations":[{"opId":"op-1","action":"explode","target":{"kind":"new","localId":"x"},"changes":{"title":"X"},"constraints":[],"dependsOn":[],"source":{"text":"hello"}}]}';
    const parsed = validateSemanticEnvelope(raw, 'hello');
    expect(parsed.ok).toBe(false);
  });

  it('resolves now plus two hours without requiring a separate day', async () => {
    const result = await turn({
      version: '1',
      kind: 'operations',
      operations: [operation({
        opId: 'op-1',
        action: 'create',
        target: { kind: 'new', localId: 'call' },
        changes: { title: 'Дзвінок' },
        constraints: [{ kind: 'relative_time', anchor: 'now', direction: 'after', amount: 2, unit: 'hour' }],
        source: { text: 'Через дві години зателефонувати' },
      })],
    }, 'Через дві години зателефонувати');
    expect(result.serverWrites).toBe(0);
    expect(result.response.outcome).toBe('confirm');
    expect(result.response.intents[0]).toMatchObject({
      type: 'create',
      task: { scheduledStartTime: '2026-10-18T08:00:00.000Z', isUnscheduled: false },
    });
  });

  it('does not turn an all-day constraint into a 30 minute event', async () => {
    const text = 'У неділю цілий день конференція';
    const raw = JSON.stringify({
      version: '1',
      kind: 'operations',
      operations: [{
        opId: 'op-1',
        action: 'create',
        target: { kind: 'new', localId: 'conf' },
        changes: { title: 'Конференція', spanRole: 'all_day' },
        constraints: [{ kind: 'weekday', weekday: 0, which: 'next' }],
        dependsOn: [],
        source: { text },
      }],
    });
    const parsed = validateSemanticEnvelope(raw, text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const result = await turn(parsed.envelope, text);
    expect(result.serverWrites).toBe(0);
    expect(result.response.outcome).toBe('confirm');
    expect(result.response.intents[0]).toMatchObject({
      type: 'create',
      task: {
        scheduledStartTime: '2026-10-25T08:00:00+02:00',
        scheduledEndTime: '2026-10-25T23:00:00+02:00',
        estimatedTimeInMinutes: 900,
        isUnscheduled: false,
        eventType: 'fixed',
      },
    });
  });

  it('does not preview one delete for a bulk scope', async () => {
    const result = await turn({
      version: '1',
      kind: 'operations',
      operations: [operation({
        opId: 'op-1',
        action: 'delete',
        target: { kind: 'existing', proposedId: 'task-1', description: 'зустрічі' },
        scope: 'all',
        source: { text: 'Видали всі зустрічі' },
      })],
    }, 'Видали всі зустрічі');
    expect(result.serverWrites).toBe(0);
    expect(result.response.intents).toEqual([]);
    expect(result.blocked).toContain('completeness_unknown');
    expect(result.response.outcome).toBe('clarify');
  });

  it('keeps a clarification open and then accepts the follow-up command', async () => {
    const session = createSession('user-1', 'clarify-follow');
    const first = await runVNextTurn(
      {
        transcript: 'Перенеси звіт',
        userId: 'user-1',
        session,
        nowIso: NOW,
        timeZone: 'Europe/Kyiv',
        wakeHm: '08:00',
        sleepHm: '23:00',
        defaultDurationMinutes: 30,
        language: 'en',
        arm: 'A',
        entities: [TASK],
      },
      {
        arm: 'A',
        interpret: async () => ({
          ok: true,
          envelope: { version: '1', kind: 'clarification', operations: [], clarification: { question: 'Which day?', operationIds: [], missing: ['day'] } },
          reads: [],
          usage: { calls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 },
          specialist: null,
          promptHash: 'phase45',
        }),
      },
    );
    expect(first.response.outcome).toBe('clarify');
    expect(first.serverWrites).toBe(0);
    const second = await runVNextTurn(
      {
        transcript: 'On Friday',
        userId: 'user-1',
        session,
        nowIso: NOW,
        timeZone: 'Europe/Kyiv',
        wakeHm: '08:00',
        sleepHm: '23:00',
        defaultDurationMinutes: 30,
        language: 'en',
        arm: 'A',
        entities: [TASK],
      },
      {
        arm: 'A',
        interpret: async () => ({
          ok: true,
          envelope: {
            version: '1',
            kind: 'operations',
            operations: [operation({
              opId: 'op-1',
              action: 'create',
              target: { kind: 'new', localId: 'report' },
              changes: { title: 'Report' },
              constraints: [{ kind: 'weekday', weekday: 5, which: 'next' }],
              source: { text: 'On Friday' },
            })],
          },
          reads: [],
          usage: { calls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 },
          specialist: null,
          promptHash: 'phase45',
        }),
      },
    );
    expect(second.serverWrites).toBe(0);
    expect(second.response.outcome).toBe('confirm');
    expect(second.response.intents).toHaveLength(1);
  });

  it('does not count a schema failure as a correct refusal', () => {
    expect(scoreSemanticOutcome({
      schemaValid: false,
      outcome: 'refuse',
      intents: [],
      blocked: ['invalid_model_output'],
      serverWrites: 0,
      expectation: { acceptable: ['clarify', 'confirm'] },
    })).toMatchObject({ correct: false, critical: false, stage: 'schema' });
  });
});
