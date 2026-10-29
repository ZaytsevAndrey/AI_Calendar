/**
 * One Planner B control across voice-regression and fold fixtures.
 *
 *   npx ts-node --transpile-only benchmark/planner-b-control/runner.ts
 *     selection, prompt markers, and the token estimate. No model call.
 *
 *   npx ts-node --transpile-only benchmark/planner-b-control/runner.ts --confirm-llm
 *     arm B only. Writes b-control-run.json in this directory.
 *     Does not write voice-regression or fold-experiment history.
 *
 * Production prompts, scorers, and gold are imported and not edited.
 */
import { createHash } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { buildPlannerPromptB } from '../../.tmp/planner-ab.prompt';
import { parsePlannerDecision, type PlannerDecision } from '../../src/modules/voice/voice-agent.planner';
import type { VoiceToolCall } from '../../src/modules/voice/voice-agent.tools';
import { DEFAULT_DEEPSEEK_PLANNER_MODEL, deepseekPlannerCall } from '../../src/modules/voice/deepseek-planner';
import { FOLD_SCENARIOS, type FoldScenario } from '../fold-experiment/scenarios';
import { parseFoldRaw, scoreChannel, type ChannelScore } from '../fold-experiment/score';
import { BENCH_SCENARIOS, type BenchScenario } from '../voice-regression/scenarios';
import { scoreBench, type BenchScore, type BenchTrace } from '../voice-regression/score';
import { CLOCK, executeTool, interviewPlan, userPrompt } from '../voice-regression/world';

const MAX_TOOL_ROUNDS = 2;
const MAX_TOOL_CALLS = 6;
const OUT_FILE = join(__dirname, 'b-control-run.json');
const BENCH_IDS = [
  'ctx-bare-pronoun',
  'ctx-explicit-current',
  'ctx-unsettled-pointer',
  'dep-pronoun-two-antecedents',
  'dep-create-then-time',
  'dep-several-changes',
  'dep-independent',
  'dep-same-name',
  'dep-create-cancel',
  'dep-cancel-then-create',
  'crud-update-duration',
  'clar-event-no-clock',
  'plan-not-a-list',
] as const;
const FOLD_IDS = ['existing-length', 'delete-draft', 'several-yoga'] as const;
const FOLD_UTTERANCES: Record<(typeof FOLD_IDS)[number], string> = {
  'existing-length': 'Зроби нараду на півтори години',
  'delete-draft': 'Створи чернетку листа і відразу видали її',
  'several-yoga': 'Запиши йогу на сьогодні на дев\'яту, перенеси її на завтра і зроби її на сорок п\'ять хвилин',
};

type ControlRow = {
  id: string;
  source: 'voice-regression' | 'fold-experiment';
  utterance: string;
  rounds: Array<{ round: number; raw: string | null; error: string | null; decisionType?: string }>;
  toolCalls: Array<{ name: string; args?: Record<string, unknown> }>;
  segments: string[];
  segmentCount: number;
  answer: string;
  verdict: 'pass' | 'fail' | 'review';
  score: BenchScore | ChannelScore;
  checks: {
    operationsKept: boolean;
    cancelledDropped: boolean;
    inventedTargetDayOrTime: boolean;
  };
};

function pace(system: string, user: string): number {
  return Math.ceil((system.length + user.length) / 3.5) + 800;
}

function assertOutputPath(): void {
  const forbidden = [
    join(__dirname, '..', 'voice-regression', 'last-run.json'),
    join(__dirname, '..', 'voice-regression', 'wave-1-ab.json'),
    join(__dirname, '..', 'voice-regression', 'wave-1-rescore.json'),
    join(__dirname, '..', 'fold-experiment', 'last-run.json'),
    join(__dirname, '..', 'fold-experiment', 'fold-rescore.json'),
  ];
  if (forbidden.includes(OUT_FILE)) throw new Error('control output would overwrite a saved run');
}

function promptMarkers(system: string): string[] {
  const failures: string[] = [];
  if (!system.includes('A delete that unambiguously targets that same create removes it')) {
    failures.push('updated delete withdrawal is missing');
  }
  if (system.includes('An update or a delete of the create this utterance is making stays that create')) {
    failures.push('the old delete-stays-create sentence is still present');
  }
  if (!system.includes('A stated length on a task they already named is that task\'s duration')) {
    failures.push('the duration update sentence is missing');
  }
  if (system.includes('An event with neither a day nor a clock is that time question when nothing else was asked.')) {
    failures.push('the unscoped event-without-clock sentence is still present');
  }
  if (!system.includes('whose reference does not settle one object, stays a segment')) {
    failures.push('the unsettled-reference segment sentence is missing');
  }
  return failures;
}

function select(): { bench: BenchScenario[]; fold: FoldScenario[] } {
  const bench = BENCH_IDS.map((id) => {
    const scenario = BENCH_SCENARIOS.find((item) => item.id === id);
    if (!scenario) throw new Error(`missing voice scenario ${id}`);
    return scenario;
  });
  const fold = FOLD_IDS.map((id) => {
    const scenario = FOLD_SCENARIOS.find((item) => item.id === id);
    if (!scenario) throw new Error(`missing fold scenario ${id}`);
    if (scenario.utterance !== FOLD_UTTERANCES[id]) {
      throw new Error(`${id} utterance does not match the saved fixture`);
    }
    return scenario;
  });
  return { bench, fold };
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

function traceOf(decision: PlannerDecision, toolCalls: BenchTrace['toolCalls']): BenchTrace {
  if (decision.type === 'steps') {
    return { type: 'steps', segments: decision.segments, answer: decision.answer, edits: [], toolCalls };
  }
  if (decision.type === 'final') {
    return {
      type: 'final',
      outcome: decision.outcome,
      segments: [],
      answer: decision.assistantMessage,
      edits: [],
      toolCalls,
    };
  }
  if (decision.type === 'plan_start') {
    return {
      type: 'plan_start',
      segments: [],
      answer: decision.question,
      question: decision.question,
      day: decision.day,
      edits: [],
      toolCalls,
    };
  }
  if (decision.type === 'plan_edits') {
    return {
      type: 'plan_edits',
      segments: [],
      answer: decision.answer,
      edits: decision.edits.map((edit) => JSON.stringify(edit)),
      toolCalls,
    };
  }
  if (decision.type === 'plan_question') {
    return { type: 'plan_question', segments: [], answer: decision.question, question: decision.question, edits: [], toolCalls };
  }
  return { type: decision.type, segments: [], answer: '', edits: [], toolCalls };
}

function voiceChecks(score: BenchScore): ControlRow['checks'] {
  const reasons = score.failures.map((failure) => failure.reason);
  return {
    operationsKept: !reasons.some((reason) => /missing or merged|not stated as one operation|leftover|segments, expected|is repeated|outside the allowed set|outcome /.test(reason)),
    cancelledDropped: !reasons.some((reason) => reason.includes('cancelled value')),
    inventedTargetDayOrTime: reasons.some((reason) => /forbidden target|invented|similar title/.test(reason)),
  };
}

function foldChecks(score: ChannelScore): ControlRow['checks'] {
  return {
    operationsKept: score.objects !== 'fail' && score.count !== 'fail' && score.independent !== 'fail' && score.decision !== 'fail',
    cancelledDropped: score.cancelled !== 'fail',
    inventedTargetDayOrTime: score.invented === 'fail',
  };
}

function estimate(system: string, bench: BenchScenario[], fold: FoldScenario[]) {
  const rows = [
    ...bench.map((scenario) => {
      const calls = scenario.tools?.length ? 2 : 1;
      return { id: scenario.id, calls, paceTokens: pace(system, benchUser(scenario)) * calls };
    }),
    ...fold.map((scenario) => ({
      id: scenario.id,
      calls: 1,
      paceTokens: pace(system, userPrompt({ utterance: scenario.utterance })),
    })),
  ];
  const paceTokens = rows.reduce((sum, row) => sum + row.paceTokens, 0);
  return {
    scenarios: rows.length,
    calls: rows.reduce((sum, row) => sum + row.calls, 0),
    paceTokens,
    likelyTokens: Math.round(paceTokens * 0.73),
  };
}

function selfCheck(): { system: string; bench: BenchScenario[]; fold: FoldScenario[] } {
  assertOutputPath();
  const system = buildPlannerPromptB();
  const markers = promptMarkers(system);
  if (markers.length) throw new Error(markers.join('; '));
  const selected = select();
  if (selected.bench.length + selected.fold.length !== 16) throw new Error('expected 16 scenarios');
  const call = deepseekPlannerCall(DEFAULT_DEEPSEEK_PLANNER_MODEL, system, 'same-user');
  if (call.body.model !== 'deepseek-flash') throw new Error(`model ${call.body.model}`);
  if (call.body.temperature !== 0.1) throw new Error('temperature drifted');
  if (call.body.thinking.type !== 'disabled') throw new Error('thinking is not off');
  if (call.body.response_format.type !== 'json_object') throw new Error('JSON mode is off');
  if (CLOCK.nowIso !== '2026-10-18T06:00:00.000Z' || CLOCK.timeZone !== 'Europe/Kyiv') {
    throw new Error('clock drifted');
  }
  return { system, ...selected };
}

async function runLive(system: string, bench: BenchScenario[], fold: FoldScenario[]): Promise<void> {
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
  if (model !== 'deepseek-flash') throw new Error(`refusing model ${model}`);
  if (process.env.VOICE_LLM_PROVIDER !== 'deepseek') throw new Error('provider is not deepseek');
  const parameters = deepseekPlannerCall(model, system, 'same-user').body;
  const rows: ControlRow[] = [];
  const persist = () => {
    const spends = groq.evalSpends().map((item) => ({ ...item }));
    mkdirSync(__dirname, { recursive: true });
    writeFileSync(OUT_FILE, JSON.stringify({
      arm: 'B',
      clock: CLOCK,
      parameters: {
        model: parameters.model,
        temperature: parameters.temperature,
        maxTokens: parameters.max_tokens,
        thinking: parameters.thinking,
        responseFormat: parameters.response_format,
      },
      prompt: {
        chars: system.length,
        sha256: createHash('sha256').update(system).digest('hex'),
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
    for (const scenario of bench) {
      rows.push(await runBench(groq, system, scenario));
      persist();
      console.log(JSON.stringify({ id: scenario.id, verdict: rows[rows.length - 1].verdict }));
    }
    for (const scenario of fold) {
      rows.push(await runFold(groq, system, scenario));
      persist();
      console.log(JSON.stringify({ id: scenario.id, verdict: rows[rows.length - 1].verdict }));
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
): Promise<ControlRow> {
  const toolCalls: BenchTrace['toolCalls'] = [];
  const toolResults: Array<{ name: string; result: unknown }> = [];
  const rounds: ControlRow['rounds'] = [];
  let trace: BenchTrace = { segments: [], answer: '', edits: [], toolCalls, fault: 'no decision' };
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    const user = benchUser(scenario, toolResults);
    let raw: string | null = null;
    let decision: PlannerDecision;
    try {
      raw = await groq.completeJson(system, user, { role: 'planner', label: `b-control.${scenario.id}.r${round}` });
      decision = parsePlannerDecision(raw);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'fault';
      rounds.push({ round, raw, error: message });
      trace = { segments: [], answer: '', edits: [], toolCalls, fault: message };
      break;
    }
    rounds.push({ round, raw, error: null, decisionType: decision.type });
    if (decision.type !== 'tools') {
      trace = traceOf(decision, toolCalls);
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
  }
  const score = scoreBench(scenario, trace);
  return {
    id: scenario.id,
    source: 'voice-regression',
    utterance: scenario.utterance,
    rounds,
    toolCalls,
    segments: trace.segments,
    segmentCount: trace.segments.length,
    answer: trace.answer,
    verdict: score.verdict,
    score,
    checks: voiceChecks(score),
  };
}

async function runFold(
  groq: { completeJson: (system: string, user: string, opts: { role: 'planner'; label: string }) => Promise<string> },
  system: string,
  scenario: FoldScenario,
): Promise<ControlRow> {
  const toolCalls: ControlRow['toolCalls'] = [];
  const toolResults: Array<{ name: string; result: unknown }> = [];
  const rounds: ControlRow['rounds'] = [];
  let raw = '';
  let fault: string | undefined;
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    const user = userPrompt({ utterance: scenario.utterance, toolResults });
    try {
      raw = await groq.completeJson(system, user, { role: 'planner', label: `b-control.${scenario.id}.r${round}` });
    } catch (error) {
      fault = error instanceof Error ? error.message : 'fault';
      rounds.push({ round, raw: null, error: fault });
      break;
    }
    rounds.push({ round, raw, error: null });
    let decision: PlannerDecision;
    try {
      decision = parsePlannerDecision(raw);
    } catch {
      fault = 'invalid json';
      break;
    }
    rounds[rounds.length - 1].decisionType = decision.type;
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
  const score = scoreChannel(scenario, parsed.segments, {
    type: parsed.type,
    outcome: parsed.outcome,
    json: parsed.production && !fault,
  });
  let answer = '';
  if (raw) {
    try {
      const body = JSON.parse(raw) as { assistantMessage?: string; answer?: string };
      answer = body.assistantMessage || body.answer || '';
    } catch {
      answer = '';
    }
  }
  return {
    id: scenario.id,
    source: 'fold-experiment',
    utterance: scenario.utterance,
    rounds,
    toolCalls,
    segments: parsed.segments,
    segmentCount: parsed.segments.length,
    answer,
    verdict: score.verdict,
    score,
    checks: foldChecks(score),
  };
}

function main(): void {
  const checked = selfCheck();
  console.log(JSON.stringify({
    selfCheck: 'pass',
    promptChars: checked.system.length,
    estimate: estimate(checked.system, checked.bench, checked.fold),
    file: OUT_FILE,
  }, null, 2));
  if (!process.argv.includes('--confirm-llm')) return;
  runLive(checked.system, checked.bench, checked.fold).catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}

main();
