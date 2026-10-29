import { ScheduleState, TaskStatus, type Task } from '../../tasks/entities/task.entity';
import type { ScheduledTask } from '../../schedule/schedule.entity';
import { VoiceAgentTools } from '../voice-agent.tools';
import { wouldExceed } from './eval/arm-a-live';
import type { SemanticOperationV1 } from './contracts/types';
import { eligibleCompleteGold, expectationForEdge } from './eval/complete-gold';
import { domainReadBroker, exhaustiveCatalog, toolContextFromEntities } from './eval/domain-calendar';
import { EDGE_CASES } from './eval/edge-cases';
import { semanticGoldRows } from './eval/semantic-gold';
import { scoreSemanticOutcome } from './eval/semantic-outcome';
import { runVNextTurn } from './pipeline';
import type { EntityRecord } from './reference/reference-resolver';
import { createSession } from './session/session';
import { createDeepSeekComplete, newSpend } from './llm/live-complete';
import { redactSecrets } from './diagnostics/trace';

const NOW = '2026-10-18T06:00:00.000Z';
const MEETINGS: EntityRecord[] = [
  { id: 'a', userId: 'user-1', type: 'task', name: 'Нарада', status: 'open', calendarId: 'work' },
  { id: 'b', userId: 'user-1', type: 'task', name: 'Нарада', status: 'open', calendarId: 'work' },
];

function operation(partial: Partial<SemanticOperationV1> & Pick<SemanticOperationV1, 'opId' | 'action' | 'target'>): SemanticOperationV1 {
  return { changes: {}, constraints: [], dependsOn: [], source: { text: partial.opId }, ...partial };
}

describe('Phase 4.7.3 live runner gates', () => {
  it('reads unscheduled tasks through VoiceAgentTools', async () => {
    const broker = domainReadBroker({
      entities: [{ id: 'task-1', userId: 'user-1', type: 'task', name: 'Звіт', status: 'open' }],
      nowIso: NOW,
      timeZone: 'Europe/Kyiv',
      wakeHm: '08:00',
      sleepHm: '23:00',
    });
    const rows = await broker.run(1, [{ requestId: 'r1', name: 'list_unscheduled', args: {} }]);
    expect(rows[0].ok).toBe(true);
    expect(JSON.stringify(rows[0].result)).toContain('Звіт');
    const context = toolContextFromEntities({
      entities: [],
      nowIso: NOW,
      timeZone: 'Europe/Kyiv',
      wakeHm: '08:00',
      sleepHm: '23:00',
    });
    context.tasks = [{ id: 'task-1', name: 'Зустріч', status: TaskStatus.TODO, isUnscheduled: false, scheduleState: ScheduleState.NONE } as Task];
    context.slots = [{ taskId: 'task-1', scheduledStartTime: new Date('2026-10-18T07:00:00.000Z'), scheduledEndTime: new Date('2026-10-18T08:00:00.000Z') } as ScheduledTask];
    const agenda = await new VoiceAgentTools({ listVisibleEvents: async () => [] } as never).execute(
      { name: 'get_day_agenda', args: { day: '2026-10-18' } },
      context,
    ) as { items: Array<{ name: string }> };
    expect(agenda.items.map((item) => item.name)).toEqual(['Зустріч']);
  });

  it('accepts an exhaustive catalog receipt and rejects missing, stale, and truncated ones', async () => {
    const envelope = {
      version: '1' as const,
      kind: 'operations' as const,
      operations: [operation({
        opId: 'op-1',
        action: 'delete',
        target: { kind: 'existing', description: 'Нарада', calendarId: 'work' },
        scope: 'all',
      })],
    };
    const base = {
      transcript: 'Видали всі наради',
      userId: 'user-1',
      nowIso: NOW,
      timeZone: 'Europe/Kyiv',
      wakeHm: '08:00',
      sleepHm: '23:00',
      defaultDurationMinutes: 30,
      language: 'uk' as const,
      arm: 'A' as const,
      entities: MEETINGS,
    };
    const interpret = {
      arm: 'A' as const,
      interpret: async () => ({
        ok: true as const,
        envelope,
        reads: [],
        usage: { calls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 },
        specialist: null,
        promptHash: 'phase473',
      }),
    };
    const full = await runVNextTurn({ ...base, session: createSession('user-1', 'full'), catalogSearch: exhaustiveCatalog(MEETINGS) }, interpret);
    expect(full.response.intents).toHaveLength(2);
    expect(full.serverWrites).toBe(0);
    const missing = await runVNextTurn({ ...base, session: createSession('user-1', 'missing') }, interpret);
    expect(missing.response.intents).toEqual([]);
    expect(missing.blocked).toContain('completeness_unknown');
    const stale = await runVNextTurn({
      ...base,
      session: createSession('user-1', 'stale'),
      searchReceipt: { complete: true, ids: ['a'] },
    }, interpret);
    expect(stale.response.intents).toEqual([]);
    expect(stale.blocked).toContain('scope_mismatch');
    const truncated = await runVNextTurn({
      ...base,
      session: createSession('user-1', 'cut'),
      catalogSearch: () => ({ complete: false, truncated: true, ids: ['a', 'b'] }),
    }, interpret);
    expect(truncated.response.intents).toEqual([]);
    expect(truncated.blocked).toContain('search_truncated');
  });

  it('keeps unverified fixtures out of the semantic denominator', () => {
    const gold = semanticGoldRows();
    const selected = eligibleCompleteGold();
    expect(gold).toHaveLength(132);
    expect(selected.eligible).toHaveLength(32);
    expect(selected.excluded.filter((row) => row.gold === 'complete').map((row) => row.id).sort()).toEqual([
      'edge-dependency-remind',
    ]);
    expect(selected.eligible.length).toBeLessThanOrEqual(gold.filter((row) => row.gold === 'complete').length);
    expect(selected.eligible.every((id) => EDGE_CASES.some((edge) => edge.id === id))).toBe(true);
    expect(selected.excluded.some((row) => row.gold === 'unverified')).toBe(true);
    expect(selected.eligible.length + selected.excluded.length).toBe(132);
    const sample = EDGE_CASES.find((edge) => edge.id === selected.eligible[0]);
    expect(sample && expectationForEdge(sample)).toBeTruthy();
    const wrong = scoreSemanticOutcome({
      schemaValid: true,
      outcome: 'confirm',
      intents: [{ type: 'create', summary: 'Звіт', task: { name: 'Звіт', scheduledStartTime: '2026-10-19T07:00:00.000Z' } }],
      blocked: [],
      serverWrites: 0,
      expectation: { acceptable: ['confirm'], intentCount: 1, includesDate: '2026-10-23' },
    });
    expect(wrong.correct).toBe(false);
    expect(wrong.reason).toBe('wrong_time');
    expect(wouldExceed(0.9, 0.2, 1)).toBe('the next call reserve would exceed the budget');
  });

  it('retries one transient DeepSeek failure, keeps the priced model, and redacts the key', async () => {
    const previousKey = process.env.DEEPSEEK_API_KEY;
    const previousModel = process.env.DEEPSEEK_PLANNER_MODEL;
    process.env.DEEPSEEK_API_KEY = 'phase473-test-key';
    process.env.DEEPSEEK_PLANNER_MODEL = 'deepseek-flash';
    const original = global.fetch;
    let calls = 0;
    let seenModel = '';
    global.fetch = (async (_url: string, init?: RequestInit) => {
      calls += 1;
      seenModel = JSON.parse(String(init?.body)).model;
      if (calls === 1) {
        return { status: 429, json: async () => ({ error: { message: 'phase473-test-key rate limit' } }) } as Response;
      }
      return {
        status: 200,
        json: async () => ({
          choices: [{ message: { content: '{"ok":true}' } }],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5, prompt_cache_miss_tokens: 3 },
        }),
      } as Response;
    }) as typeof fetch;
    try {
      const at = new Date('2026-10-28T12:00:00.000Z');
      const spend = newSpend(at);
      const result = await createDeepSeekComplete(spend, at).complete({ system: 's', user: 'u' });
      expect(seenModel).toBe('deepseek-flash');
      expect(calls).toBe(2);
      expect(result.text).toBe('{"ok":true}');
      expect(spend.usd).not.toBeNull();
      expect(JSON.stringify(spend)).not.toContain('phase473-test-key');
    } finally {
      global.fetch = original;
      if (previousKey == null) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = previousKey;
      if (previousModel == null) delete process.env.DEEPSEEK_PLANNER_MODEL;
      else process.env.DEEPSEEK_PLANNER_MODEL = previousModel;
    }
  });

  it('redacts API keys without hiding task ids', () => {
    expect(redactSecrets('move task-zvit and sk-live-secret')).toBe('move task-zvit and [redacted]');
    expect(redactSecrets('Bearer phase473-test-key')).toBe('Bearer [redacted]');
  });
});
