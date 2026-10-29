import { mkdirSync, appendFileSync, readFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createHash, randomUUID } from 'crypto';
import type { DayPlanProposal, PlanDraft } from '../../voice-agent.types';
import type { EntityRecord } from '../reference/reference-resolver';
import { runVNextTurn, type PipelineResult } from '../pipeline';
import { createSession, type VNextSession } from '../session/session';
import { runInterpreterA } from '../interpreters/run-interpreter';
import { PROMPT_A_HASH } from '../interpreters/prompts';
import { domainReadBroker, exhaustiveCatalog } from './domain-calendar';
import { createDeepSeekComplete, newSpend, type LiveSpend } from '../llm/live-complete';
import type { LlmComplete } from '../repair/repair';
import { LIVE_CONVERSATIONS, LIVE_SINGLES, type LiveConversation, type LiveSingle, type WorldName } from './phase477-fixtures';
import { HOLDOUT_CONVERSATIONS, HOLDOUT_SINGLES } from './phase478-holdout';
import { FRESH_CONVERSATIONS, FRESH_SINGLES } from './phase479-holdout';
import { ADVERSARIAL_CONVERSATIONS, ADVERSARIAL_SINGLES } from './phase4710-holdout';
import { INDEPENDENT_CONVERSATIONS, INDEPENDENT_SINGLES } from './phase4711-holdout';
import { conversationSucceeded, judgeTurn, PHASE4711_SCORER, PHASE4711_SUITE, type ObservedTurn, type TurnVerdict } from './phase477-score';

const NOW = '2026-10-18T06:00:00.000Z';
const ZONE = 'Europe/Kyiv';
const MAX_USD = 2;
const MAX_CALLS = 1200;

export type Phase477RunOptions = {
  outputDir: string;
  budgetUsd?: number;
  maxCalls?: number;
  limit?: number;
  ids?: string[];
  group?: 'single' | 'conversation' | 'all';
  suite?: 'frozen' | 'holdout' | 'fresh' | 'adversarial' | 'independent';
  resume?: boolean;
  spend?: LiveSpend;
  complete?: LlmComplete;
};

type ScenarioRow = {
  kind: 'single' | 'conversation';
  id: string;
  turns: Array<{ utterance: string; expect: LiveSingle['expect'] }>;
  world: WorldName;
  zone?: string;
  nowIso?: string;
};

function entity(id: string, name: string, extra: Partial<EntityRecord> = {}): EntityRecord {
  return { id, userId: 'user-1', type: 'task', name, status: 'open', revision: 1, ...extra };
}

export function worldOf(name: WorldName = 'default'): EntityRecord[] {
  const report = entity('task-report', 'Звіт');
  const finance = entity('task-finance', 'Фінансовий звіт');
  const morning = entity('design-am', 'Ранкова зустріч із дизайнером', { scheduledStart: '2026-10-19T07:00:00.000Z', calendarId: 'work' });
  const afternoon = entity('design-pm', 'Зустріч із дизайнером після обіду', { scheduledStart: '2026-10-19T13:00:00.000Z', calendarId: 'work' });
  const client = entity('task-client', 'Нарада з клієнтом', { scheduledStart: '2026-10-19T09:00:00.000Z' });
  const client2 = entity('task-client-2', 'Нарада з клієнтом щодо бюджету', { scheduledStart: '2026-10-20T09:00:00.000Z' });
  const review = entity('task-review', 'Design review');
  const review2 = entity('task-review-2', 'Design review follow-up');
  if (name === 'empty') return [];
  if (name === 'one-report') return [report];
  if (name === 'readonly-flight') return [entity('ext-flight', 'політ', { type: 'external_event', calendarId: 'google' })];
  if (name === 'writable-flight') return [entity('ext-flight-w', 'політ', { type: 'external_event', writable: true, calendarId: 'google' })];
  if (name === 'done') return [entity('task-done', 'Архів', { status: 'completed' })];
  return [report, finance, morning, afternoon, client, client2, review, review2];
}

function scenarios(options: Phase477RunOptions): ScenarioRow[] {
  const group = options.group ?? 'all';
  const source = options.suite === 'holdout'
    ? { singles: HOLDOUT_SINGLES, conversations: HOLDOUT_CONVERSATIONS }
    : options.suite === 'fresh'
      ? { singles: FRESH_SINGLES, conversations: FRESH_CONVERSATIONS }
      : options.suite === 'adversarial'
        ? { singles: ADVERSARIAL_SINGLES, conversations: ADVERSARIAL_CONVERSATIONS }
        : options.suite === 'independent'
          ? { singles: INDEPENDENT_SINGLES, conversations: INDEPENDENT_CONVERSATIONS }
          : { singles: LIVE_SINGLES, conversations: LIVE_CONVERSATIONS };
  const singles: ScenarioRow[] = source.singles.map((row) => ({
    kind: 'single',
    id: row.id,
    turns: [{ utterance: row.utterance, expect: row.expect }],
    world: row.world ?? 'default',
    zone: row.zone,
    nowIso: row.nowIso,
  }));
  const conversations: ScenarioRow[] = source.conversations.map((row: LiveConversation) => ({
    kind: 'conversation',
    id: row.id,
    turns: row.turns,
    world: row.world ?? 'default',
    zone: row.zone,
    nowIso: row.nowIso,
  }));
  let rows = group === 'single' ? singles : group === 'conversation' ? conversations : [...singles, ...conversations];
  if (options.ids?.length) {
    const wanted = new Set(options.ids);
    rows = rows.filter((row) => wanted.has(row.id));
  }
  if (options.limit != null) rows = rows.slice(0, options.limit);
  return rows;
}

/**
 * Interpreter/session fixture only. Hours are the item index plus 9.
 * This does not consult gaps, duration, timezone, or existing commitments.
 * Integrated planning uses the real planner in the offline day-plan specs.
 */
export function fixtureEchoProposal(draft: PlanDraft): DayPlanProposal {
  return {
    day: draft.day,
    stage: draft.stage,
    revision: draft.revision,
    changedItemIds: draft.items.map((item) => item.id),
    unplaced: [],
    items: draft.items.map((item, index) => {
      const hour = String(9 + index).padStart(2, '0');
      return {
        itemId: item.id,
        taskId: item.taskId,
        source: item.source,
        name: item.name,
        start: `${draft.day}T${hour}:00:00+03:00`,
        end: `${draft.day}T${hour}:30:00+03:00`,
        durationMinutes: item.durationMinutes,
      };
    }),
  };
}

function observe(result: PipelineResult, session: VNextSession, timeZone: string): ObservedTurn {
  return {
    outcome: result.response.outcome,
    blocked: result.blocked,
    intents: result.response.intents,
    serverWrites: result.serverWrites,
    assistantMessage: result.response.assistantMessage,
    draftNames: session.planDraft?.items.map((item) => item.name) ?? [],
    pendingCount: session.pendingIntents?.length ?? 0,
    timeZone,
  };
}

function doneIds(path: string, promptHash: string): Set<string> {
  if (!existsSync(path)) return new Set();
  const ids = new Set<string>();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as { id?: string; complete?: boolean; promptHash?: string };
      if (row.id && row.complete && row.promptHash === promptHash) ids.add(row.id);
    } catch {
      /* a torn last line is ignored and that scenario runs again */
    }
  }
  return ids;
}

export function phase477Plan(options: Pick<Phase477RunOptions, 'group' | 'limit' | 'ids' | 'suite'> = {}): { scenarios: number; turns: number; suite: string; scorer: string; promptHash: string; scenarioSuite: string } {
  const rows = scenarios({ outputDir: '', ...options });
  return {
    scenarios: rows.length,
    turns: rows.reduce((sum, row) => sum + row.turns.length, 0),
    suite: PHASE4711_SUITE,
    scorer: PHASE4711_SCORER,
    promptHash: PROMPT_A_HASH,
    scenarioSuite: options.suite ?? 'frozen',
  };
}

export async function runPhase477(options: Phase477RunOptions): Promise<{ status: string; file: string; modelCalls: number; usd: number | null }> {
  const budget = options.budgetUsd ?? MAX_USD;
  const maxCalls = options.maxCalls ?? MAX_CALLS;
  if (budget > MAX_USD || maxCalls > MAX_CALLS) {
    throw new Error('phase 4.7.11 refuses a budget above $2 or 1200 calls');
  }
  const spend = options.spend ?? newSpend();
  const inner = options.complete ?? createDeepSeekComplete(spend);
  const complete: LlmComplete = {
    async complete(input) {
      if (spend.calls.length >= maxCalls || (spend.usd ?? 0) >= budget) {
        throw new Error('budget');
      }
      return inner.complete(input);
    },
  };
  mkdirSync(options.outputDir, { recursive: true });
  const jsonl = join(options.outputDir, 'turns.jsonl');
  const finished = options.resume === false ? new Set<string>() : doneIds(jsonl, PROMPT_A_HASH);
  const runId = randomUUID();
  const rows = scenarios(options).filter((row) => !finished.has(row.id));
  let stopped = '';
  for (const row of rows) {
    if (spend.calls.length >= maxCalls || (spend.usd ?? 0) >= budget) {
      stopped = 'budget';
      break;
    }
    const session = createSession('user-1', `${row.id}-${runId.slice(0, 8)}`);
    const entities = worldOf(row.world);
    const zone = row.zone ?? ZONE;
    const nowIso = row.nowIso ?? NOW;
    const verdicts: TurnVerdict[] = [];
    const transcript: unknown[] = [];
    for (let index = 0; index < row.turns.length; index += 1) {
      if (spend.calls.length >= maxCalls || (spend.usd ?? 0) >= budget) {
        stopped = 'budget';
        break;
      }
      const turn = row.turns[index];
      const before = spend.calls.length;
      let envelope: unknown = null;
      let interpretError = '';
      const result = await runVNextTurn(
        {
          transcript: turn.utterance,
          userId: 'user-1',
          session,
          nowIso,
          timeZone: zone,
          wakeHm: '08:00',
          sleepHm: '23:00',
          defaultDurationMinutes: 30,
          defaultReminderTime: '09:00',
          language: 'uk',
          arm: 'A',
          entities,
          planContext: { tasks: [], slots: [], timeZone: zone, nowIso, defaultDurationMinutes: 30 },
          proposeDay: async (_userId, draft) => fixtureEchoProposal(draft),
          catalogSearch: exhaustiveCatalog(entities),
        },
        {
          arm: 'A',
          interpret: async (user, transcriptText) => {
            try {
              const output = await runInterpreterA(complete, domainReadBroker({ entities, nowIso, timeZone: zone, wakeHm: '08:00', sleepHm: '23:00' }), user, transcriptText);
              envelope = output.envelope ?? null;
              return output;
            } catch (err) {
              interpretError = err instanceof Error ? err.message : String(err);
              if (interpretError === 'budget') stopped = 'budget';
              const code = /timeout|aborted/i.test(interpretError)
                ? 'timeout'
                : /503|429|unavailable/i.test(interpretError)
                  ? 'provider_unavailable'
                  : 'provider_or_transport_error';
              return { ok: false, reads: [], usage: { calls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 }, specialist: null, promptHash: PROMPT_A_HASH, code };
            }
          },
        },
      );
      const observed = observe(result, session, zone);
      const verdict = judgeTurn(observed, turn.expect);
      if (interpretError) {
        verdict.semantic = false;
        verdict.completion = false;
        verdict.safety = observed.serverWrites === 0;
        verdict.category = 'provider_or_transport_error';
      }
      verdicts.push(verdict);
      const call = spend.calls[spend.calls.length - 1];
      transcript.push({
        turn: index,
        utterance: turn.utterance,
        envelope,
        outcome: observed.outcome,
        blocked: observed.blocked,
        assistantMessage: observed.assistantMessage,
        intents: observed.intents,
        draftNames: observed.draftNames,
        pendingCount: observed.pendingCount,
        serverWrites: observed.serverWrites,
        verdict,
        calls: spend.calls.length - before,
        latencyMs: call?.latencyMs ?? result.usage.latencyMs,
        error: interpretError || null,
      });
      if (stopped) break;
    }
    appendFileSync(jsonl, `${JSON.stringify({
      id: row.id,
      kind: row.kind,
      runId,
      suite: PHASE4711_SUITE,
      scorer: PHASE4711_SCORER,
      promptHash: PROMPT_A_HASH,
      model: 'deepseek-flash',
      executionMode: 'live',
      conversationSuccess: row.kind === 'conversation' ? conversationSucceeded(verdicts) && verdicts.length === row.turns.length : undefined,
      complete: verdicts.length === row.turns.length,
      verdicts,
      transcript,
    })}\n`, 'utf8');
    if (stopped) break;
  }
  const summary = summarize(jsonl, spend, runId, stopped);
  const file = join(options.outputDir, 'summary.json');
  writeFileSync(file, JSON.stringify(summary, null, 2));
  return { status: summary.status, file, modelCalls: spend.calls.length, usd: spend.usd };
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function summarize(jsonl: string, spend: LiveSpend, runId: string, stopped: string) {
  const raw = existsSync(jsonl) ? readFileSync(jsonl, 'utf8') : '';
  const parsed: Array<{
    id: string;
    kind: string;
    complete?: boolean;
    conversationSuccess?: boolean;
    verdicts: TurnVerdict[];
    transcript: Array<{ latencyMs?: number; calls?: number }>;
  }> = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      parsed.push(JSON.parse(line) as (typeof parsed)[number]);
    } catch {
      /* torn line */
    }
  }
  const latest = new Map<string, (typeof parsed)[number]>();
  for (const row of parsed) latest.set(row.id, row);
  const rows = [...latest.values()];
  const turns = rows.flatMap((row) => row.verdicts);
  const singles = rows.filter((row) => row.kind === 'single');
  const conversations = rows.filter((row) => row.kind === 'conversation');
  const latencies = rows.flatMap((row) => row.transcript.map((turn) => turn.latencyMs ?? 0)).filter((value) => value > 0);
  const categories: Record<string, number> = {};
  for (const turn of turns) {
    if (!turn.category) continue;
    categories[turn.category] = (categories[turn.category] ?? 0) + 1;
  }
  const singleTurns = singles.flatMap((row) => row.verdicts);
  return {
    status: stopped ? 'partial' : 'complete',
    stopped: stopped || null,
    runId,
    suite: PHASE4711_SUITE,
    scorer: PHASE4711_SCORER,
    promptHash: PROMPT_A_HASH,
    executionMode: 'live',
    plannerMode: 'fixture-echo',
    model: 'deepseek-flash',
    temperature: 0.1,
    thinking: false,
    hashOfSummaryInputs: createHash('sha256').update(JSON.stringify({ prompt: PROMPT_A_HASH, suite: PHASE4711_SUITE, scorer: PHASE4711_SCORER })).digest('hex'),
    scenarios: rows.length,
    singleScenarios: singles.length,
    conversations: conversations.length,
    turns: turns.length,
    singleSemantic: singleTurns.filter((turn) => turn.semantic).length,
    singleSafety: singleTurns.filter((turn) => turn.safety).length,
    singleCompletion: singleTurns.filter((turn) => turn.completion).length,
    unnecessaryClarification: turns.filter((turn) => turn.category === 'model_unnecessary_clarification').length,
    perTurnSuccess: turns.filter((turn) => turn.completion).length,
    conversationSuccess: conversations.filter((row) => row.conversationSuccess).length,
    unsafeTurns: turns.filter((turn) => !turn.safety).length,
    serverWrites: 0,
    categories,
    modelCalls: spend.calls.length,
    inputTokens: spend.inputTokens,
    outputTokens: spend.outputTokens,
    usd: spend.usd,
    peak: spend.peak,
    latencyP50: percentile(latencies, 50),
    latencyP95: percentile(latencies, 95),
    incomplete: rows.filter((row) => row.complete === false).map((row) => row.id),
  };
}
