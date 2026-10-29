/**
 * Planner C2 on Gemini. DeepSeek is not called.
 *
 *   npx ts-node --transpile-only benchmark/planner-c2-gemini/runner.ts
 *     configuration and the call forecast. No API call.
 *
 *   npx ts-node --transpile-only benchmark/planner-c2-gemini/runner.ts --confirm-llm
 *     the priority list, at most 20 Gemini generateContent calls.
 *     Writes gemini-c2-run.json here. Does not overwrite saved DeepSeek raw.
 *
 * Production, Planner C2, fixtures, gold, and scorers are imported and not edited.
 * There is no retry loop. Each fetch counts as one call, including a failed attempt.
 */
import { createHash } from 'crypto';
import { config as loadEnv } from 'dotenv';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { buildPlannerPromptC2 } from '../../.tmp/planner-c2.prompt';
import {
  DEFAULT_GEMINI_PLANNER_MODEL,
  geminiPlannerCall,
  geminiPlannerResult,
  type GeminiPlannerPayload,
} from '../../src/modules/voice/gemini-planner';
import { parsePlannerDecision, type PlannerDecision } from '../../src/modules/voice/voice-agent.planner';
import type { VoiceToolCall } from '../../src/modules/voice/voice-agent.tools';
import { FOLD_SCENARIOS, type FoldScenario } from '../fold-experiment/scenarios';
import { parseFoldRaw, scoreChannel, type ChannelScore } from '../fold-experiment/score';
import { EVALUATION, type EvalClass } from '../evaluation';
import { BENCH_SCENARIOS, type BenchScenario } from '../voice-regression/scenarios';
import { scoreBench, type BenchScore, type BenchTrace } from '../voice-regression/score';
import { CLOCK, executeTool, interviewPlan, userPrompt } from '../voice-regression/world';

const BUDGET = 20;
const MAX_TOOL_ROUNDS = 2;
const MAX_TOOL_CALLS = 6;
const RESERVE = 1 + MAX_TOOL_ROUNDS;
const TIMEOUT_MS = 25_000;
const C2_SHA256 = '6a43727a2d4f77f62a7d87d185275ae4dc647a0e0358a2dbd24012f1cfb20c88';
const PRIORITY = [
  'dep-create-then-time',
  'dep-several-changes',
  'date-tickets',
  'pronoun-taxi',
  'plan-not-a-list',
  'time-past-morning',
  'pronoun-bare',
  'ctx-unsettled-pointer',
  'tool-now',
  'tool-when-named',
  'dep-create-cancel',
  'dep-independent',
  'dep-same-name',
  'dep-existing-two-fields',
  'ctx-bare-pronoun',
  'several-yoga',
] as const;

const OUT_FILE = join(__dirname, 'gemini-c2-run.json');
const C2_FILE = join(__dirname, '..', 'planner-bc', 'c2-only-subset-run.json');
const SAVED_RAW = [
  join(__dirname, '..', 'voice-regression', 'last-run.json'),
  join(__dirname, '..', 'voice-regression', 'wave-1-ab.json'),
  join(__dirname, '..', 'voice-regression', 'wave-1-rescore.json'),
  join(__dirname, '..', 'fold-experiment', 'last-run.json'),
  join(__dirname, '..', 'fold-experiment', 'fold-rescore.json'),
  join(__dirname, '..', 'planner-b-control', 'b-control-run.json'),
  join(__dirname, '..', 'planner-bc', 'bc-run.json'),
  join(__dirname, '..', 'planner-bc', 'c-only-run.json'),
  join(__dirname, '..', 'planner-bc', 'c-only-subset-run.json'),
  join(__dirname, '..', 'planner-bc', 'c2-only-run.json'),
  C2_FILE,
  join(__dirname, '..', 'planner-bc', 'c3-only-run.json'),
  join(__dirname, '..', 'planner-bc', 'c3-only-subset-run.json'),
];

type Verdict = 'pass' | 'fail' | 'review';
type ScenarioRef =
  | { source: 'voice-regression'; scenario: BenchScenario }
  | { source: 'fold-experiment'; scenario: FoldScenario };

type CallLog = {
  scenarioId: string;
  round: number;
  attempt: number;
  startedAt: string;
  latencyMs: number;
  status: number | null;
  error: string | null;
  raw: string | null;
  content: string | null;
  usage: GeminiPlannerPayload['usageMetadata'] | null;
  tokens: number;
};

type RowLog = {
  id: string;
  source: ScenarioRef['source'] | null;
  evaluation: EvalClass | null;
  utterance: string | null;
  status: 'complete' | 'incomplete' | 'error';
  reason: string | null;
  deepseek: { verdict: Verdict; segments: string[]; answer: string } | null;
  rounds: CallLog[];
  toolCalls: Array<{ name: string; args?: Record<string, unknown> }>;
  segments: string[];
  answer: string;
  verdict: Verdict | null;
  score: BenchScore | ChannelScore | null;
};

function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function pace(system: string, user: string): number {
  return Math.ceil((system.length + user.length) / 3.5) + 800;
}

function loadC2Baseline(): Map<string, { verdict: Verdict; segments: string[]; answer: string }> {
  const saved = JSON.parse(readFileSync(C2_FILE, 'utf8')) as {
    rows: Array<{ id: string; C2?: { verdict: Verdict; segments: string[]; answer: string } }>;
  };
  const map = new Map<string, { verdict: Verdict; segments: string[]; answer: string }>();
  for (const row of saved.rows) {
    if (!row.C2) continue;
    map.set(row.id, { verdict: row.C2.verdict, segments: row.C2.segments, answer: row.C2.answer });
  }
  return map;
}

function resolveScenario(id: string): ScenarioRef {
  const voice = BENCH_SCENARIOS.find((item) => item.id === id);
  if (voice) return { source: 'voice-regression', scenario: voice };
  const fold = FOLD_SCENARIOS.find((item) => item.id === id);
  if (fold) return { source: 'fold-experiment', scenario: fold };
  throw new Error(`unknown scenario ${id}`);
}

function userFor(ref: ScenarioRef, toolResults: Array<{ name: string; result: unknown }> = []): string {
  if (ref.source === 'fold-experiment') {
    return userPrompt({ utterance: ref.scenario.utterance, toolResults });
  }
  const scenario = ref.scenario;
  return userPrompt({
    utterance: scenario.utterance,
    history: scenario.history,
    toolResults,
    pendingClarification: scenario.pendingClarification,
    pendingConfirmSummary: scenario.pendingConfirmSummary,
    planDraft: scenario.plan ? interviewPlan() : null,
  });
}

function floorCalls(ref: ScenarioRef): number {
  if (ref.source === 'voice-regression' && ref.scenario.tools?.length) return 2;
  return 1;
}

function configuration(prompt: string) {
  loadEnv({ path: join(__dirname, '..', '..', '.env') });
  const key = process.env.GEMINI_API_KEY?.trim() || '';
  const model = process.env.GEMINI_PLANNER_MODEL?.trim() || DEFAULT_GEMINI_PLANNER_MODEL;
  const call = geminiPlannerCall(model, prompt, 'forecast');
  return {
    keyPresent: key.length > 0,
    model,
    url: call.url,
    temperature: call.body.generationConfig.temperature,
    maxOutputTokens: call.body.generationConfig.maxOutputTokens,
    responseMimeType: call.body.generationConfig.responseMimeType,
    thinkingLevel: call.body.generationConfig.thinkingConfig.thinkingLevel,
    thinkingOffAvailable: false,
    retries: 0,
    timeoutMs: TIMEOUT_MS,
    budget: BUDGET,
    maxToolRounds: MAX_TOOL_ROUNDS,
    reservePerScenario: RESERVE,
  };
}

function forecast(prompt: string, baseline: Map<string, { verdict: Verdict }>) {
  const rows = PRIORITY.map((id) => {
    const ref = resolveScenario(id);
    const user = userFor(ref);
    return {
      id,
      source: ref.source,
      evaluation: EVALUATION[id] ?? null,
      declaredTools: ref.source === 'voice-regression' ? (ref.scenario.tools?.map((tool) => tool.name) ?? []) : [],
      floorCalls: floorCalls(ref),
      ceilingCalls: RESERVE,
      paceTokens: pace(prompt, user),
      deepseekVerdict: baseline.get(id)?.verdict ?? null,
    };
  });
  let spent = 0;
  let floorCompleted = 0;
  for (const row of rows) {
    if (BUDGET - spent < RESERVE) break;
    spent += row.floorCalls;
    if (spent <= BUDGET) floorCompleted += 1;
  }
  return {
    scenarios: rows.length,
    floorCalls: rows.reduce((sum, row) => sum + row.floorCalls, 0),
    ceilingCalls: rows.length * RESERVE,
    fullReserveStarts: Math.floor(BUDGET / RESERVE),
    floorPathCompleted: floorCompleted,
    paceTokens: rows.reduce((sum, row) => sum + row.paceTokens, 0),
    note: 'paceTokens uses the DeepSeek character estimate. Gemini totalTokenCount includes thinking and is known only after a call. A scenario starts only when at least 3 calls remain, because a model may request two tool rounds even when the fixture declares none.',
    rows,
  };
}

function traceOf(decision: PlannerDecision, toolCalls: BenchTrace['toolCalls']): BenchTrace {
  if (decision.type === 'steps') return { type: 'steps', segments: decision.segments, answer: decision.answer, edits: [], toolCalls };
  if (decision.type === 'final') {
    return { type: 'final', outcome: decision.outcome, segments: [], answer: decision.assistantMessage, edits: [], toolCalls };
  }
  if (decision.type === 'plan_start') {
    return { type: 'plan_start', segments: [], answer: decision.question, question: decision.question, day: decision.day, edits: [], toolCalls };
  }
  if (decision.type === 'plan_edits') {
    return { type: 'plan_edits', segments: [], answer: decision.answer, edits: decision.edits.map((edit) => JSON.stringify(edit)), toolCalls };
  }
  if (decision.type === 'plan_question') {
    return { type: 'plan_question', segments: [], answer: decision.question, question: decision.question, edits: [], toolCalls };
  }
  return { type: decision.type, segments: [], answer: '', edits: [], toolCalls };
}

function keepVerdict(verdict: Verdict): Verdict {
  return verdict;
}

async function geminiOnce(
  state: { spent: number },
  model: string,
  key: string,
  prompt: string,
  user: string,
  scenarioId: string,
  round: number,
): Promise<CallLog> {
  if (state.spent >= BUDGET) throw new Error('budget');
  state.spent += 1;
  const call = geminiPlannerCall(model, prompt, user);
  const started = Date.now();
  const log: CallLog = {
    scenarioId,
    round,
    attempt: state.spent,
    startedAt: new Date(started).toISOString(),
    latencyMs: 0,
    status: null,
    error: null,
    raw: null,
    content: null,
    usage: null,
    tokens: 0,
  };
  let response: Response;
  try {
    response = await fetch(call.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(call.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    log.latencyMs = Date.now() - started;
    log.error = error instanceof Error ? error.message : 'fetch failed';
    return log;
  }
  log.latencyMs = Date.now() - started;
  log.status = response.status;
  log.raw = await response.text();
  let payload: GeminiPlannerPayload = {};
  try {
    payload = JSON.parse(log.raw) as GeminiPlannerPayload;
  } catch {
    log.error = 'response was not JSON';
    return log;
  }
  log.usage = payload.usageMetadata ?? null;
  const parsed = geminiPlannerResult(payload);
  if (!response.ok || !parsed.ok) {
    log.error = parsed.ok ? `Gemini planner failed (${response.status})` : parsed.error;
    return log;
  }
  log.content = parsed.content;
  log.tokens = parsed.tokens;
  return log;
}

async function runLive(prompt: string, model: string, key: string): Promise<void> {
  if (SAVED_RAW.includes(OUT_FILE)) throw new Error('refusing to overwrite a saved run');
  const baseline = loadC2Baseline();
  const state = { spent: 0 };
  const rows: RowLog[] = [];
  const calls: CallLog[] = [];
  const persist = () => {
    mkdirSync(__dirname, { recursive: true });
    writeFileSync(OUT_FILE, JSON.stringify({
      arm: 'C2',
      provider: 'gemini',
      recordedAt: new Date().toISOString(),
      clock: CLOCK,
      budget: BUDGET,
      retries: 0,
      reservePerScenario: RESERVE,
      spent: state.spent,
      prompt: { chars: prompt.length, sha256: hash(prompt) },
      parameters: configuration(prompt),
      calls,
      rows,
      usage: {
        calls: calls.length,
        totalTokens: calls.reduce((sum, call) => sum + call.tokens, 0),
        note: 'Gemini usageMetadata.totalTokenCount. The client stores that total only.',
      },
    }, null, 2));
  };
  for (const id of PRIORITY) {
    const saved = baseline.get(id) ?? null;
    if (BUDGET - state.spent < RESERVE) {
      rows.push({
        id,
        source: null,
        evaluation: EVALUATION[id] ?? null,
        utterance: null,
        status: 'incomplete',
        reason: `budget ${BUDGET - state.spent} is below the reserve of ${RESERVE}`,
        deepseek: saved,
        rounds: [],
        toolCalls: [],
        segments: [],
        answer: '',
        verdict: null,
        score: null,
      });
      persist();
      console.log(JSON.stringify({ id, status: 'incomplete' }));
      continue;
    }
    const ref = resolveScenario(id);
    const toolCalls: RowLog['toolCalls'] = [];
    const toolResults: Array<{ name: string; result: unknown }> = [];
    const rounds: CallLog[] = [];
    let status: RowLog['status'] = 'complete';
    let reason: string | null = null;
    let content = '';
    let fault: string | undefined;
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
      if (state.spent >= BUDGET) {
        status = 'incomplete';
        reason = 'budget exhausted before the next round';
        break;
      }
      const logged = await geminiOnce(state, model, key, prompt, userFor(ref, toolResults), id, round);
      rounds.push(logged);
      calls.push(logged);
      persist();
      if (logged.error || !logged.content) {
        status = 'error';
        reason = logged.error || 'empty response';
        fault = reason;
        break;
      }
      content = logged.content;
      let decision: PlannerDecision;
      try {
        decision = parsePlannerDecision(content);
      } catch (error) {
        fault = error instanceof Error ? error.message : 'invalid json';
        break;
      }
      if (decision.type !== 'tools') break;
      if (!decision.calls.length || decision.calls.length > MAX_TOOL_CALLS || round === MAX_TOOL_ROUNDS) {
        fault = 'tool limit';
        break;
      }
      const world = ref.source === 'voice-regression' ? (ref.scenario.world ?? 'default') : 'default';
      for (const call of decision.calls as VoiceToolCall[]) {
        toolCalls.push({ name: call.name, args: call.args });
        toolResults.push({ name: call.name, result: executeTool(world, call) });
      }
    }
    let segments: string[] = [];
    let answer = '';
    let verdict: Verdict | null = null;
    let score: BenchScore | ChannelScore | null = null;
    if (status !== 'error' && status !== 'incomplete' && content) {
      if (ref.source === 'voice-regression') {
        let decision: PlannerDecision | null = null;
        try {
          decision = parsePlannerDecision(content);
        } catch (error) {
          fault = error instanceof Error ? error.message : 'invalid json';
        }
        const trace = decision
          ? { ...traceOf(decision, toolCalls), fault, toolRounds: rounds.length - 1 }
          : { segments: [], answer: '', edits: [], toolCalls, fault: fault || 'no decision' };
        score = scoreBench(ref.scenario, trace);
        verdict = keepVerdict(score.verdict);
        segments = trace.segments;
        answer = trace.answer;
      } else {
        const parsed = parseFoldRaw(content);
        if (fault) parsed.json = false;
        try {
          const body = JSON.parse(content) as { assistantMessage?: string; answer?: string; question?: string };
          answer = body.assistantMessage || body.answer || body.question || '';
        } catch {
          answer = '';
        }
        score = scoreChannel(ref.scenario, parsed.segments, {
          type: parsed.type,
          outcome: parsed.outcome,
          json: parsed.production && !fault,
          spoken: answer,
        });
        verdict = keepVerdict(score.verdict);
        segments = parsed.segments;
      }
    }
    rows.push({
      id,
      source: ref.source,
      evaluation: EVALUATION[id] ?? null,
      utterance: ref.scenario.utterance,
      status: fault && status === 'complete' ? 'error' : status,
      reason: fault && status === 'complete' ? fault : reason,
      deepseek: saved,
      rounds,
      toolCalls,
      segments,
      answer,
      verdict,
      score,
    });
    persist();
    console.log(JSON.stringify({ id, status: rows[rows.length - 1].status, verdict, spent: state.spent }));
  }
  persist();
  console.log(JSON.stringify({
    calls: state.spent,
    totalTokens: calls.reduce((sum, call) => sum + call.tokens, 0),
    file: OUT_FILE,
  }));
}

function main(): void {
  const prompt = buildPlannerPromptC2();
  if (hash(prompt) !== C2_SHA256) throw new Error('C2 hash drifted');
  if (CLOCK.nowIso !== '2026-10-18T06:00:00.000Z' || CLOCK.timeZone !== 'Europe/Kyiv') {
    throw new Error('clock drifted');
  }
  const shape = configuration(prompt);
  const baseline = loadC2Baseline();
  const confirm = process.argv.includes('--confirm-llm');
  console.log(JSON.stringify({
    selfCheck: 'pass',
    dryRun: !confirm,
    clock: { nowIso: CLOCK.nowIso, timeZone: CLOCK.timeZone, today: CLOCK.today, nowLocal: CLOCK.nowLocal },
    prompt: { chars: prompt.length, sha256: hash(prompt) },
    gemini: shape,
    deepseekBaseline: C2_FILE,
    missingDeepseekC2: PRIORITY.filter((id) => !baseline.has(id)),
    forecast: forecast(prompt, baseline),
    output: OUT_FILE,
    deepseekOverwrite: false,
    command: 'npx ts-node --transpile-only benchmark/planner-c2-gemini/runner.ts --confirm-llm',
  }, null, 2));
  if (!confirm) return;
  if (!shape.keyPresent) throw new Error('GEMINI_API_KEY missing');
  const key = process.env.GEMINI_API_KEY?.trim() || '';
  runLive(prompt, shape.model, key).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'gemini run failed');
    process.exit(1);
  });
}

main();
