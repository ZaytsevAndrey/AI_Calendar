/**
 * Isolated Planner B vs Planner C comparison.
 *
 *   npx ts-node --transpile-only benchmark/planner-bc/runner.ts
 *     static checks and the token estimate. No model call.
 *
 *   npx ts-node --transpile-only benchmark/planner-bc/runner.ts --confirm-llm
 *     both arms, every existing voice-regression and fold scenario.
 *     Writes bc-run.json here. Does not overwrite saved raw runs.
 *
 *   npx ts-node --transpile-only benchmark/planner-bc/runner.ts --only-c --dry-run
 *     Planner C only. Prints the scenario list and the call estimate. No model call.
 *
 *   npx ts-node --transpile-only benchmark/planner-bc/runner.ts --only-c --confirm-llm
 *     Planner C only, all 77 scenarios. Writes c-only-run.json here.
 *     --ids selects a subset and writes c-only-subset-run.json instead.
 *     Quote the id list in PowerShell so commas stay in one argument.
 *
 *   npx ts-node --transpile-only benchmark/planner-bc/runner.ts --only-c2 --dry-run
 *     Planner C2 only. Same clock and model shape as C-only. No model call.
 *
 *   npx ts-node --transpile-only benchmark/planner-bc/runner.ts --only-c2 --confirm-llm
 *     Planner C2 only. Writes c2-only-run.json here.
 *     --ids writes c2-only-subset-run.json and does not replace the C-only raw file.
 *
 *   npx ts-node --transpile-only benchmark/planner-bc/runner.ts --only-c3 --confirm-llm --ids "<list>"
 *     Planner C3 only. Writes c3-only-subset-run.json and does not replace C2 raw.
 *
 * Production prompts, Planner B, scorers, and gold are imported and not edited.
 */
import { createHash } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { buildPlannerPromptA, buildPlannerPromptB } from '../../.tmp/planner-ab.prompt';
import { buildPlannerPromptC } from '../../.tmp/planner-c.prompt';
import { buildPlannerPromptC2 } from '../../.tmp/planner-c2.prompt';
import { buildPlannerPromptC3 } from '../../.tmp/planner-c3.prompt';
import { parsePlannerDecision, type PlannerDecision } from '../../src/modules/voice/voice-agent.planner';
import type { VoiceToolCall } from '../../src/modules/voice/voice-agent.tools';
import { DEFAULT_DEEPSEEK_PLANNER_MODEL, deepseekPlannerCall } from '../../src/modules/voice/deepseek-planner';
import { FOLD_SCENARIOS, type FoldScenario } from '../fold-experiment/scenarios';
import { parseFoldRaw, scoreChannel, type ChannelScore } from '../fold-experiment/score';
import { BENCH_SCENARIOS, type BenchScenario } from '../voice-regression/scenarios';
import { scoreBench, type BenchScore, type BenchTrace } from '../voice-regression/score';
import { assertEvaluation, EVALUATION, type EvalClass } from '../evaluation';
import { CLOCK, executeTool, interviewPlan, userPrompt } from '../voice-regression/world';

const MAX_TOOL_ROUNDS = 2;
const MAX_TOOL_CALLS = 6;
const OUT_FILE = join(__dirname, 'bc-run.json');
const C_ONLY_FILE = join(__dirname, 'c-only-run.json');
const C_ONLY_SUBSET_FILE = join(__dirname, 'c-only-subset-run.json');
const C2_ONLY_FILE = join(__dirname, 'c2-only-run.json');
const C2_ONLY_SUBSET_FILE = join(__dirname, 'c2-only-subset-run.json');
const C3_ONLY_FILE = join(__dirname, 'c3-only-run.json');
const C3_ONLY_SUBSET_FILE = join(__dirname, 'c3-only-subset-run.json');
const SAVED_RAW = [
  join(__dirname, '..', 'voice-regression', 'last-run.json'),
  join(__dirname, '..', 'voice-regression', 'wave-1-ab.json'),
  join(__dirname, '..', 'voice-regression', 'wave-1-rescore.json'),
  join(__dirname, '..', 'fold-experiment', 'last-run.json'),
  join(__dirname, '..', 'fold-experiment', 'fold-rescore.json'),
  join(__dirname, '..', 'planner-b-control', 'b-control-run.json'),
];

type ArmName = 'B' | 'C' | 'C2';
type SoloArm = 'C2' | 'C3';
type ControlRow = {
  id: string;
  source: 'voice-regression' | 'fold-experiment';
  evaluation: EvalClass;
  utterance: string;
  B?: ArmLog;
  C?: ArmLog;
  C2?: ArmLog;
  C3?: ArmLog;
};
type ArmLog = {
  rounds: Array<{ round: number; raw: string | null; error: string | null; decisionType?: string }>;
  toolCalls: Array<{ name: string; args?: Record<string, unknown> }>;
  segments: string[];
  segmentCount: number;
  answer: string;
  verdict: 'pass' | 'fail' | 'review';
  score: BenchScore | ChannelScore;
};

function pace(system: string, user: string): number {
  return Math.ceil((system.length + user.length) / 3.5) + 800;
}

function assertOutputPath(file = OUT_FILE): void {
  if (SAVED_RAW.includes(file)) throw new Error(`${file} would overwrite a saved run`);
  const allowed = new Set([
    OUT_FILE,
    C_ONLY_FILE,
    C_ONLY_SUBSET_FILE,
    C2_ONLY_FILE,
    C2_ONLY_SUBSET_FILE,
    C3_ONLY_FILE,
    C3_ONLY_SUBSET_FILE,
  ]);
  if (!allowed.has(file)) throw new Error(`${file} is not a planner-bc output`);
}

function staticChecks(a: string, b: string, c: string): string[] {
  const failures: string[] = [];
  const need = (text: string, needle: string, label: string) => {
    if (!text.includes(needle)) failures.push(`${label} missing: ${needle}`);
  };
  const ban = (text: string, needle: string, label: string) => {
    if (text.includes(needle)) failures.push(`${label} still has: ${needle}`);
  };
  if (a === b || b === c || a === c) failures.push('A, B, and C are not distinct');
  need(a, 'An event with neither a day nor a clock is that time question when nothing else was asked.', 'A');
  need(b, 'A delete that unambiguously targets that same create removes it', 'B');
  need(b, 'A stated length on a task they already named is that task\'s duration', 'B');
  need(b, 'A pronoun is not that selection', 'B');
  need(c, 'Intent preservation.', 'C');
  need(c, 'Final state.', 'C');
  need(c, 'Reference grounding.', 'C');
  need(c, 'Semantic identity.', 'C');
  need(c, 'Clarification ownership.', 'C');
  need(c, 'No invention.', 'C');
  need(c, 'Tools show which objects exist', 'C');
  need(c, 'A stated length is that object\'s duration', 'C');
  need(c, 'withdraws that object, so no operation remains', 'C');
  need(c, 'including a distinction that is not part of the title', 'C');
  for (const token of ['tools', 'steps', 'plan_start', 'plan_edits', 'plan_question', 'answer_pending', 'confirm_pending', 'cancel_pending', 'final']) {
    need(c, `"type":"${token}"`, 'C json');
  }
  for (const tool of ['get_now_next', 'get_day_agenda', 'list_unscheduled', 'match_task', 'get_task', 'list_reminders']) {
    need(c, tool, 'C tools');
  }
  need(c, 'At most 2 rounds', 'C');
  need(c, 'at most 6', 'C');
  need(c, 'Pending clarification', 'C');
  ban(c, 'A stated length on a task they already named', 'C');
  ban(c, 'A pronoun is not that selection', 'C');
  ban(c, 'A delete that unambiguously targets that same create removes it', 'C');
  ban(c, 'нагадай', 'C');
  for (const word of ['молоко', 'йога', 'нарада', 'чернет', 'його', 'її']) {
    ban(c, word, 'C');
  }
  if (BENCH_SCENARIOS.length !== 61) failures.push(`voice scenarios ${BENCH_SCENARIOS.length}`);
  if (FOLD_SCENARIOS.length !== 16) failures.push(`fold scenarios ${FOLD_SCENARIOS.length}`);
  failures.push(...assertEvaluation([...BENCH_SCENARIOS, ...FOLD_SCENARIOS].map((scenario) => scenario.id)));
  if (CLOCK.nowIso !== '2026-10-18T06:00:00.000Z' || CLOCK.timeZone !== 'Europe/Kyiv') failures.push('clock drifted');
  const call = deepseekPlannerCall(DEFAULT_DEEPSEEK_PLANNER_MODEL, c, 'same-user');
  if (call.body.model !== 'deepseek-flash' || call.body.temperature !== 0.1) failures.push('model shape drifted');
  if (call.body.thinking.type !== 'disabled' || call.body.response_format.type !== 'json_object') failures.push('call flags drifted');
  return failures;
}

function benchUser(scenario: BenchScenario, toolResults: Array<{ name: string; result: unknown }> = []): string {
  return userPrompt({
    utterance: scenario.utterance,
    history: scenario.history,
    toolResults,
    pendingClarification: scenario.pendingClarification,
    pendingConfirmSummary: scenario.pendingConfirmSummary,
    planDraft: scenario.plan ? interviewPlan() : null,
  });
}

function estimate(b: string, c: string) {
  const voice = BENCH_SCENARIOS.map((scenario) => {
    const calls = scenario.tools?.length ? 2 : 1;
    const user = benchUser(scenario);
    return calls * (pace(b, user) + pace(c, user));
  });
  const fold = FOLD_SCENARIOS.map((scenario) => {
    const user = userPrompt({ utterance: scenario.utterance });
    return pace(b, user) + pace(c, user);
  });
  const paceTokens = [...voice, ...fold].reduce((sum, value) => sum + value, 0);
  const voiceCalls = BENCH_SCENARIOS.reduce((sum, scenario) => sum + (scenario.tools?.length ? 2 : 1), 0);
  const calls = (voiceCalls + FOLD_SCENARIOS.length) * 2;
  return {
    scenarios: BENCH_SCENARIOS.length + FOLD_SCENARIOS.length,
    arms: 2,
    calls,
    paceTokens,
    likelyTokens: Math.round(paceTokens * 0.73),
  };
}

type COnlyPick = {
  voice: BenchScenario[];
  fold: FoldScenario[];
};

function idsFromArgv(argv: string[]): string[] {
  const at = argv.indexOf('--ids');
  if (at < 0) return [];
  const raw = argv[at + 1] ?? '';
  if (!raw || raw.startsWith('--')) throw new Error('--ids needs a comma-separated list');
  return raw.split(',').map((id) => id.trim()).filter(Boolean);
}

function selectCOnly(ids: string[]): COnlyPick {
  const voice = BENCH_SCENARIOS.filter((scenario) => !ids.length || ids.includes(scenario.id));
  const fold = FOLD_SCENARIOS.filter((scenario) => !ids.length || ids.includes(scenario.id));
  const known = new Set([...voice, ...fold].map((scenario) => scenario.id));
  const missing = ids.filter((id) => !known.has(id));
  if (missing.length) throw new Error(`unknown scenario ids: ${missing.join(', ')}`);
  return { voice, fold };
}

function estimateC(prompt: string, pick: COnlyPick) {
  const voiceCalls = pick.voice.reduce((sum, scenario) => sum + (scenario.tools?.length ? 2 : 1), 0);
  const voicePace = pick.voice.reduce((sum, scenario) => {
    const calls = scenario.tools?.length ? 2 : 1;
    return sum + calls * pace(prompt, benchUser(scenario));
  }, 0);
  const foldPace = pick.fold.reduce((sum, scenario) => sum + pace(prompt, userPrompt({ utterance: scenario.utterance })), 0);
  const paceTokens = voicePace + foldPace;
  return {
    scenarios: pick.voice.length + pick.fold.length,
    arms: 1,
    calls: voiceCalls + pick.fold.length,
    paceTokens,
    likelyTokens: Math.round(paceTokens * 0.73),
    note: 'Floor: one extra call only when the scenario declares tools. A model-chosen tool round can add calls.',
  };
}

function cOnlyOutput(ids: string[]): string {
  return ids.length ? C_ONLY_SUBSET_FILE : C_ONLY_FILE;
}

function c2Output(ids: string[]): string {
  return ids.length ? C2_ONLY_SUBSET_FILE : C2_ONLY_FILE;
}

function c3Output(ids: string[]): string {
  return ids.length ? C3_ONLY_SUBSET_FILE : C3_ONLY_FILE;
}

function staticChecksC2(c: string, c2: string): string[] {
  const failures: string[] = [];
  const need = (needle: string) => {
    if (!c2.includes(needle)) failures.push(`C2 missing: ${needle}`);
  };
  if (c === c2) failures.push('C2 is identical to C');
  for (const token of ['tools', 'steps', 'plan_start', 'plan_edits', 'plan_question', 'answer_pending', 'confirm_pending', 'cancel_pending', 'final']) {
    need(`"type":"${token}"`);
  }
  for (const tool of ['get_now_next', 'get_day_agenda', 'list_unscheduled', 'match_task', 'get_task', 'list_reminders']) {
    need(tool);
  }
  need('At most 2 rounds');
  need('at most 6');
  need('Pending clarification');
  need('A missing target, a missing parameter, and the absence of any operation are different.');
  need('Successive clauses are one operation when they build the final state of one object');
  need('Do not read the digits of a UTC timestamp as local time.');
  const shape = deepseekPlannerCall(DEFAULT_DEEPSEEK_PLANNER_MODEL, c2, 'same-user').body;
  if (shape.model !== 'deepseek-flash' || shape.temperature !== 0.1) failures.push('C2 model shape drifted');
  if (shape.thinking.type !== 'disabled' || shape.response_format.type !== 'json_object') failures.push('C2 call flags drifted');
  return failures;
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

function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

async function runLive(prompts: { B: string; C: string }): Promise<void> {
  process.env.VOICE_LLM_PROVIDER = 'deepseek';
  process.env.DEEPSEEK_PLANNER_MODEL = 'deepseek-flash';
  process.env.VOICE_EVAL_PACE = '1';
  process.env.VOICE_DAILY_TOKEN_LIMIT = '0';
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../../src/app.module');
  const { ConfigService } = await import('@nestjs/config');
  const { GroqClient } = await import('../../src/modules/voice/groq.client');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const groq = app.get(GroqClient);
  const config = app.get(ConfigService);
  const model = config.get<string>('DEEPSEEK_PLANNER_MODEL')?.trim() || DEFAULT_DEEPSEEK_PLANNER_MODEL;
  if (!config.get<string>('DEEPSEEK_API_KEY')?.trim()) throw new Error('DEEPSEEK_API_KEY missing');
  if (model !== 'deepseek-flash' || process.env.VOICE_LLM_PROVIDER !== 'deepseek') throw new Error('provider shape drifted');
  const shape = deepseekPlannerCall(model, prompts.B, 'same-user').body;
  const rows: ControlRow[] = [];
  const persist = () => {
    const spends = groq.evalSpends().map((item) => ({ ...item }));
    mkdirSync(__dirname, { recursive: true });
    writeFileSync(OUT_FILE, JSON.stringify({
      arms: ['B', 'C'],
      clock: CLOCK,
      parameters: {
        model: shape.model,
        temperature: shape.temperature,
        maxTokens: shape.max_tokens,
        thinking: shape.thinking,
        responseFormat: shape.response_format,
      },
      prompt: {
        B: { chars: prompts.B.length, sha256: hash(prompts.B) },
        C: { chars: prompts.C.length, sha256: hash(prompts.C) },
      },
      usage: {
        calls: spends.length,
        totalTokens: spends.reduce((sum, item) => sum + item.tokens, 0),
        note: 'The planner client stores total_tokens only.',
        spends,
      },
      rows,
    }, null, 2));
  };
  try {
    for (const scenario of BENCH_SCENARIOS) {
      const row: ControlRow = {
        id: scenario.id,
        source: 'voice-regression',
        evaluation: EVALUATION[scenario.id],
        utterance: scenario.utterance,
      };
      for (const arm of ['B', 'C'] as const) row[arm] = await runBench(groq, prompts[arm], scenario, arm);
      rows.push(row);
      persist();
      console.log(JSON.stringify({ id: scenario.id, B: row.B?.verdict, C: row.C?.verdict }));
    }
    for (const scenario of FOLD_SCENARIOS) {
      const row: ControlRow = {
        id: scenario.id,
        source: 'fold-experiment',
        evaluation: EVALUATION[scenario.id],
        utterance: scenario.utterance,
      };
      for (const arm of ['B', 'C'] as const) row[arm] = await runFold(groq, prompts[arm], scenario, arm);
      rows.push(row);
      persist();
      console.log(JSON.stringify({ id: scenario.id, B: row.B?.verdict, C: row.C?.verdict }));
    }
  } finally {
    persist();
    const spends = groq.evalSpends();
    console.log(JSON.stringify({
      calls: spends.length,
      totalTokens: spends.reduce((sum, item) => sum + item.tokens, 0),
      models: [...new Set(spends.map((item) => item.model))],
      file: OUT_FILE,
    }));
    await app.close();
  }
}

async function runBench(
  groq: { completeJson: (system: string, user: string, opts: { role: 'planner'; label: string }) => Promise<string> },
  system: string,
  scenario: BenchScenario,
  arm: ArmName | SoloArm,
): Promise<ArmLog> {
  const toolCalls: BenchTrace['toolCalls'] = [];
  const toolResults: Array<{ name: string; result: unknown }> = [];
  const rounds: ArmLog['rounds'] = [];
  let trace: BenchTrace = { segments: [], answer: '', edits: [], toolCalls, fault: 'no decision' };
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    let raw: string | null = null;
    try {
      raw = await groq.completeJson(system, benchUser(scenario, toolResults), {
        role: 'planner',
        label: `bc.${arm}.${scenario.id}.r${round}`,
      });
      const decision = parsePlannerDecision(raw);
      rounds.push({ round, raw, error: null, decisionType: decision.type });
      if (decision.type !== 'tools') {
        trace = { ...traceOf(decision, toolCalls), toolRounds: round };
        break;
      }
      if (!decision.calls.length || decision.calls.length > MAX_TOOL_CALLS || round === MAX_TOOL_ROUNDS) {
        trace = { segments: [], answer: '', edits: [], toolCalls, fault: 'tool limit' };
        break;
      }
      for (const call of decision.calls as VoiceToolCall[]) {
        const result = executeTool(scenario.world ?? 'default', call);
        toolCalls.push({ name: call.name, args: call.args });
        toolResults.push({ name: call.name, result });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'fault';
      rounds.push({ round, raw, error: message });
      trace = { segments: [], answer: '', edits: [], toolCalls, fault: message };
      break;
    }
  }
  const score = scoreBench(scenario, trace);
  return {
    rounds,
    toolCalls,
    segments: trace.segments,
    segmentCount: trace.segments.length,
    answer: trace.answer,
    verdict: score.verdict,
    score,
  };
}

async function runFold(
  groq: { completeJson: (system: string, user: string, opts: { role: 'planner'; label: string }) => Promise<string> },
  system: string,
  scenario: FoldScenario,
  arm: ArmName | SoloArm,
): Promise<ArmLog> {
  const toolCalls: ArmLog['toolCalls'] = [];
  const toolResults: Array<{ name: string; result: unknown }> = [];
  const rounds: ArmLog['rounds'] = [];
  let raw = '';
  let fault: string | undefined;
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    try {
      raw = await groq.completeJson(system, userPrompt({ utterance: scenario.utterance, toolResults }), {
        role: 'planner',
        label: `bc.${arm}.${scenario.id}.r${round}`,
      });
    } catch (error) {
      fault = error instanceof Error ? error.message : 'fault';
      rounds.push({ round, raw: null, error: fault });
      break;
    }
    let decision: PlannerDecision;
    try {
      decision = parsePlannerDecision(raw);
    } catch {
      fault = 'invalid json';
      rounds.push({ round, raw, error: fault });
      break;
    }
    rounds.push({ round, raw, error: null, decisionType: decision.type });
    if (decision.type !== 'tools') break;
    if (!decision.calls.length || decision.calls.length > MAX_TOOL_CALLS || round === MAX_TOOL_ROUNDS) {
      fault = 'tool limit';
      break;
    }
    for (const call of decision.calls as VoiceToolCall[]) {
      const result = executeTool('default', call);
      toolCalls.push({ name: call.name, args: call.args });
      toolResults.push({ name: call.name, result });
    }
  }
  const parsed = raw ? parseFoldRaw(raw) : parseFoldRaw('{}');
  if (fault) parsed.json = false;
  let answer = '';
  if (raw) {
    try {
      const body = JSON.parse(raw) as { assistantMessage?: string; answer?: string; question?: string };
      answer = body.assistantMessage || body.answer || body.question || '';
    } catch {
      answer = '';
    }
  }
  const score = scoreChannel(scenario, parsed.segments, {
    type: parsed.type,
    outcome: parsed.outcome,
    json: parsed.production && !fault,
    spoken: answer,
  });
  return {
    rounds,
    toolCalls,
    segments: parsed.segments,
    segmentCount: parsed.segments.length,
    answer,
    verdict: score.verdict,
    score,
  };
}

async function runCOnly(prompt: string, pick: COnlyPick, file: string): Promise<void> {
  assertOutputPath(file);
  process.env.VOICE_LLM_PROVIDER = 'deepseek';
  process.env.DEEPSEEK_PLANNER_MODEL = 'deepseek-flash';
  process.env.VOICE_EVAL_PACE = '1';
  process.env.VOICE_DAILY_TOKEN_LIMIT = '0';
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../../src/app.module');
  const { ConfigService } = await import('@nestjs/config');
  const { GroqClient } = await import('../../src/modules/voice/groq.client');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const groq = app.get(GroqClient);
  const config = app.get(ConfigService);
  const model = config.get<string>('DEEPSEEK_PLANNER_MODEL')?.trim() || DEFAULT_DEEPSEEK_PLANNER_MODEL;
  if (!config.get<string>('DEEPSEEK_API_KEY')?.trim()) throw new Error('DEEPSEEK_API_KEY missing');
  if (model !== 'deepseek-flash' || process.env.VOICE_LLM_PROVIDER !== 'deepseek') throw new Error('provider shape drifted');
  const shape = deepseekPlannerCall(model, prompt, 'same-user').body;
  const rows: ControlRow[] = [];
  const persist = () => {
    const spends = groq.evalSpends().map((item) => ({ ...item }));
    mkdirSync(__dirname, { recursive: true });
    writeFileSync(file, JSON.stringify({
      arms: ['C'],
      recordedAt: new Date().toISOString(),
      clock: CLOCK,
      parameters: {
        model: shape.model,
        temperature: shape.temperature,
        maxTokens: shape.max_tokens,
        thinking: shape.thinking,
        responseFormat: shape.response_format,
      },
      prompt: { C: { chars: prompt.length, sha256: hash(prompt) } },
      usage: {
        calls: spends.length,
        totalTokens: spends.reduce((sum, item) => sum + item.tokens, 0),
        note: 'The planner client stores total_tokens only.',
        spends,
      },
      rows,
    }, null, 2));
  };
  try {
    for (const scenario of pick.voice) {
      const row: ControlRow = {
        id: scenario.id,
        source: 'voice-regression',
        evaluation: EVALUATION[scenario.id],
        utterance: scenario.utterance,
      };
      row.C = await runBench(groq, prompt, scenario, 'C');
      rows.push(row);
      persist();
      console.log(JSON.stringify({ id: scenario.id, C: row.C.verdict }));
    }
    for (const scenario of pick.fold) {
      const row: ControlRow = {
        id: scenario.id,
        source: 'fold-experiment',
        evaluation: EVALUATION[scenario.id],
        utterance: scenario.utterance,
      };
      row.C = await runFold(groq, prompt, scenario, 'C');
      rows.push(row);
      persist();
      console.log(JSON.stringify({ id: scenario.id, C: row.C.verdict }));
    }
  } finally {
    persist();
    const spends = groq.evalSpends();
    console.log(JSON.stringify({
      calls: spends.length,
      totalTokens: spends.reduce((sum, item) => sum + item.tokens, 0),
      models: [...new Set(spends.map((item) => item.model))],
      file,
    }));
    await app.close();
  }
}

async function runC2(
  prompt: string,
  pick: COnlyPick,
  file: string,
  requestedIds: string[],
  arm: SoloArm = 'C2',
): Promise<void> {
  assertOutputPath(file);
  const forbidden = new Set([OUT_FILE, C_ONLY_FILE, C_ONLY_SUBSET_FILE]);
  if (arm === 'C2') {
    forbidden.add(C3_ONLY_FILE);
    forbidden.add(C3_ONLY_SUBSET_FILE);
  }
  if (arm === 'C3') {
    forbidden.add(C2_ONLY_FILE);
    forbidden.add(C2_ONLY_SUBSET_FILE);
  }
  if (forbidden.has(file)) throw new Error(`${file} is not a ${arm} output`);
  process.env.VOICE_LLM_PROVIDER = 'deepseek';
  process.env.DEEPSEEK_PLANNER_MODEL = 'deepseek-flash';
  process.env.VOICE_EVAL_PACE = '1';
  process.env.VOICE_DAILY_TOKEN_LIMIT = '0';
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../../src/app.module');
  const { ConfigService } = await import('@nestjs/config');
  const { GroqClient } = await import('../../src/modules/voice/groq.client');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const groq = app.get(GroqClient);
  const config = app.get(ConfigService);
  const model = config.get<string>('DEEPSEEK_PLANNER_MODEL')?.trim() || DEFAULT_DEEPSEEK_PLANNER_MODEL;
  if (!config.get<string>('DEEPSEEK_API_KEY')?.trim()) throw new Error('DEEPSEEK_API_KEY missing');
  if (model !== 'deepseek-flash' || process.env.VOICE_LLM_PROVIDER !== 'deepseek') throw new Error('provider shape drifted');
  const shape = deepseekPlannerCall(model, prompt, 'same-user').body;
  const rows: ControlRow[] = [];
  const ids = [...pick.voice, ...pick.fold].map((scenario) => scenario.id);
  const persist = () => {
    const spends = groq.evalSpends().map((item) => ({ ...item }));
    mkdirSync(__dirname, { recursive: true });
    writeFileSync(file, JSON.stringify({
      arms: [arm],
      recordedAt: new Date().toISOString(),
      clock: CLOCK,
      requestedIds,
      ids,
      parameters: {
        model: shape.model,
        temperature: shape.temperature,
        maxTokens: shape.max_tokens,
        thinking: shape.thinking,
        responseFormat: shape.response_format,
      },
      prompt: { [arm]: { chars: prompt.length, sha256: hash(prompt) } },
      usage: {
        calls: spends.length,
        totalTokens: spends.reduce((sum, item) => sum + item.tokens, 0),
        note: 'The planner client stores total_tokens only.',
        spends,
      },
      rows,
    }, null, 2));
  };
  try {
    for (const scenario of pick.voice) {
      const row: ControlRow = {
        id: scenario.id,
        source: 'voice-regression',
        evaluation: EVALUATION[scenario.id],
        utterance: scenario.utterance,
      };
      row[arm] = await runBench(groq, prompt, scenario, arm);
      rows.push(row);
      persist();
      console.log(JSON.stringify({ id: scenario.id, [arm]: row[arm]?.verdict }));
    }
    for (const scenario of pick.fold) {
      const row: ControlRow = {
        id: scenario.id,
        source: 'fold-experiment',
        evaluation: EVALUATION[scenario.id],
        utterance: scenario.utterance,
      };
      row[arm] = await runFold(groq, prompt, scenario, arm);
      rows.push(row);
      persist();
      console.log(JSON.stringify({ id: scenario.id, [arm]: row[arm]?.verdict }));
    }
  } finally {
    persist();
    const spends = groq.evalSpends();
    console.log(JSON.stringify({
      calls: spends.length,
      totalTokens: spends.reduce((sum, item) => sum + item.tokens, 0),
      models: [...new Set(spends.map((item) => item.model))],
      file,
    }));
    await app.close();
  }
}

function main(): void {
  assertOutputPath();
  const a = buildPlannerPromptA();
  const b = buildPlannerPromptB();
  const c = buildPlannerPromptC();
  const failures = staticChecks(a, b, c);
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
  }
  const evaluation = (['auto', 'manual', 'ambiguous', 'unsettled'] as const).map((klass) => ({
    class: klass,
    count: Object.values(EVALUATION).filter((item) => item === klass).length,
  }));
  const argv = process.argv;
  const onlyC = argv.includes('--only-c');
  const onlyC2 = argv.includes('--only-c2');
  const onlyC3 = argv.includes('--only-c3');
  const dryRun = argv.includes('--dry-run');
  const confirm = argv.includes('--confirm-llm');
  const soloFlags = [onlyC, onlyC2, onlyC3].filter(Boolean).length;
  if (soloFlags > 1) throw new Error('--only-c, --only-c2, and --only-c3 are separate runs');
  if (!onlyC && !onlyC2 && !onlyC3) {
    console.log(JSON.stringify({
      selfCheck: 'pass',
      chars: { A: a.length, B: b.length, C: c.length },
      sha256: { B: hash(b), C: hash(c) },
      estimate: estimate(b, c),
      evaluation,
      file: OUT_FILE,
    }, null, 2));
  }
  if (argv.includes('--ids') && !onlyC && !onlyC2 && !onlyC3) throw new Error('--ids belongs to --only-c, --only-c2, or --only-c3');
  if (onlyC3) {
    const c2 = buildPlannerPromptC2();
    const c3 = buildPlannerPromptC3();
    if (hash(c2) !== '6a43727a2d4f77f62a7d87d185275ae4dc647a0e0358a2dbd24012f1cfb20c88') {
      throw new Error('C2 hash drifted');
    }
    if (!c3.includes('whether that object is new or already existed')) throw new Error('C3 reference rule missing');
    if (c3.includes('One object introduced earlier in this same utterance')) throw new Error('C3 still limits the reference to a new object');
    const ids = idsFromArgv(argv);
    const pick = selectCOnly(ids);
    const file = c3Output(ids);
    assertOutputPath(file);
    const shape = deepseekPlannerCall(DEFAULT_DEEPSEEK_PLANNER_MODEL, c3, 'same-user').body;
    if (shape.model !== 'deepseek-flash' || shape.temperature !== 0.1) throw new Error('C3 model shape drifted');
    if (shape.thinking.type !== 'disabled' || shape.response_format.type !== 'json_object') throw new Error('C3 call flags drifted');
    console.log(JSON.stringify({
      mode: 'only-c3',
      dryRun: dryRun || !confirm,
      scenarios: pick.voice.length + pick.fold.length,
      ids: [...pick.voice, ...pick.fold].map((scenario) => scenario.id),
      estimate: estimateC(c3, pick),
      clock: {
        nowIso: CLOCK.nowIso,
        timeZone: CLOCK.timeZone,
        today: CLOCK.today,
        nowLocal: CLOCK.nowLocal,
      },
      parameters: {
        model: shape.model,
        temperature: shape.temperature,
        maxTokens: shape.max_tokens,
        thinking: shape.thinking,
        responseFormat: shape.response_format,
      },
      prompt: { C3: { chars: c3.length, sha256: hash(c3) }, C2: { chars: c2.length, sha256: hash(c2) } },
      output: file,
      c2Overwrite: file === C2_ONLY_FILE || file === C2_ONLY_SUBSET_FILE,
      command: 'npx ts-node --transpile-only benchmark/planner-bc/runner.ts --only-c3 --confirm-llm --ids "<list>"',
    }, null, 2));
    if (dryRun || !confirm) return;
    runC2(c3, pick, file, ids, 'C3').catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
    return;
  }
  if (onlyC2) {
    const c2 = buildPlannerPromptC2();
    const c2Failures = staticChecksC2(c, c2);
    if (c2Failures.length) {
      console.error(c2Failures.join('\n'));
      process.exit(1);
    }
    const ids = idsFromArgv(argv);
    const pick = selectCOnly(ids);
    const file = c2Output(ids);
    assertOutputPath(file);
    const shape = deepseekPlannerCall(DEFAULT_DEEPSEEK_PLANNER_MODEL, c2, 'same-user').body;
    console.log(JSON.stringify({
      mode: 'only-c2',
      dryRun: dryRun || !confirm,
      scenarios: pick.voice.length + pick.fold.length,
      ids: [...pick.voice, ...pick.fold].map((scenario) => scenario.id),
      estimate: estimateC(c2, pick),
      clock: {
        nowIso: CLOCK.nowIso,
        timeZone: CLOCK.timeZone,
        today: CLOCK.today,
        nowLocal: CLOCK.nowLocal,
      },
      parameters: {
        model: shape.model,
        temperature: shape.temperature,
        maxTokens: shape.max_tokens,
        thinking: shape.thinking,
        responseFormat: shape.response_format,
      },
      prompt: { C2: { chars: c2.length, sha256: hash(c2) } },
      output: file,
      historicalOverwrite: SAVED_RAW.some((saved) => saved === file),
      bcRunOverwrite: file === OUT_FILE,
      cOnlyOverwrite: file === C_ONLY_FILE || file === C_ONLY_SUBSET_FILE,
      command: 'npx ts-node --transpile-only benchmark/planner-bc/runner.ts --only-c2 --confirm-llm',
    }, null, 2));
    if (dryRun || !confirm) return;
    runC2(c2, pick, file, ids).catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
    return;
  }
  if (onlyC) {
    const ids = idsFromArgv(argv);
    const pick = selectCOnly(ids);
    const file = cOnlyOutput(ids);
    assertOutputPath(file);
    const shape = deepseekPlannerCall(DEFAULT_DEEPSEEK_PLANNER_MODEL, c, 'same-user').body;
    console.log(JSON.stringify({
      mode: 'only-c',
      dryRun: dryRun || !confirm,
      scenarios: pick.voice.length + pick.fold.length,
      ids: [...pick.voice, ...pick.fold].map((scenario) => scenario.id),
      estimate: estimateC(c, pick),
      clock: {
        nowIso: CLOCK.nowIso,
        timeZone: CLOCK.timeZone,
        today: CLOCK.today,
        nowLocal: CLOCK.nowLocal,
      },
      parameters: {
        model: shape.model,
        temperature: shape.temperature,
        maxTokens: shape.max_tokens,
        thinking: shape.thinking,
        responseFormat: shape.response_format,
      },
      prompt: { C: { chars: c.length, sha256: hash(c) } },
      output: file,
      historicalOverwrite: SAVED_RAW.some((saved) => saved === file),
      bcRunOverwrite: file === OUT_FILE,
      command: 'npx ts-node --transpile-only benchmark/planner-bc/runner.ts --only-c --confirm-llm',
    }, null, 2));
    if (dryRun || !confirm) return;
    runCOnly(c, pick, file).catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
    return;
  }
  if (dryRun || !confirm) return;
  runLive({ B: b, C: c }).catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}

main();
