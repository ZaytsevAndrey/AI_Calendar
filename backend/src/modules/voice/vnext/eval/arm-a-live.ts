/**
 * Phase 4.4 arm A evaluation. Dry-run is the default and makes no model calls.
 * The paid path is reached only when allowPaidCalls is true.
 * It uses the existing interpreter, pipeline, DeepSeek client, and scorers unchanged.
 */
import { mkdirSync, appendFileSync, writeFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { config as loadEnv } from 'dotenv';
import { BENCH_SCENARIOS, type BenchScenario } from '../../../../../benchmark/voice-regression/scenarios';
import { FOLD_SCENARIOS } from '../../../../../benchmark/fold-experiment/scenarios';
import { CLOCK, interviewPlan } from '../../../../../benchmark/voice-regression/world';
import { domainReadBroker, exhaustiveCatalog } from './domain-calendar';
import { eligibleCompleteGold, expectationForEdge } from './complete-gold';
import { ReadBroker } from '../broker/read-broker';
import type { SemanticConstraintV1, SemanticEnvelopeV1 } from '../contracts/types';
import { emptyTrace, redactSecrets, traceObserver, type BenchmarkTrace } from '../diagnostics/trace';
import { runInterpreterA } from '../interpreters/run-interpreter';
import { INTERPRETER_A_SYSTEM, PROMPT_A_HASH, buildTurnUser } from '../interpreters/prompts';
import { createDeepSeekComplete, createLunaComplete, newSpend, type LiveCall, type LiveSpend } from '../llm/live-complete';
import { DEEPSEEK_FLASH_PRICE, GPT6_LUNA_PRICE, deepseekFlashUsd, gpt6LunaUsd } from '../llm/pricing';
import { runVNextTurn, type PipelineResult } from '../pipeline';
import type { EntityRecord } from '../reference/reference-resolver';
import { appendTurn, createSession, type VNextSession } from '../session/session';
import { addDaysToYmd, localHm, localYmd, scheduleTodayYmd, upcomingWeekdayYmd } from '../../voice-local-date.util';
import { EDGE_CASES, type EdgeCase } from './edge-cases';
import { HELD_OUT_CASES } from './held-out';
import { scoreSemanticOutcome, type SemanticExpectation, type SemanticScore } from './semantic-outcome';
import { scoreCase, type RubricActual, type Verdict } from './rubric';

const USER = 'user-1';
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MAX_OUTPUT_TOKENS = 4096;
const MIN_CHARS_PER_TOKEN = 4;
const MAX_CHARS_PER_TOKEN = 2;
const ASSUMED_MIN_OUTPUT_TOKENS = 200;
const MAX_CALLS_PER_TURN = 4;

/** These seven fixtures stay disputed. They are not used to judge quality. */
export const DISPUTED_IDS = [
  'existing-length',
  'ctx-unsettled-pointer',
  'time-window',
  'time-event-span',
  'rem-daily',
  'clar-event-no-clock',
  'crud-nothing-to-change',
] as const;

export type Phase44Class =
  | 'PASS'
  | 'FAIL - interpreter'
  | 'FAIL - resolver/adapter'
  | 'FAIL - session lifecycle'
  | 'FAIL - unsupported capability'
  | 'UNVERIFIED';

export type Exclusion = { id: string; source: string; reason: string };

export type SelectedCase = {
  id: string;
  source: 'edge' | 'voice-regression' | 'fold-experiment' | 'held-out';
  category: string;
  language: 'uk' | 'en';
  turns: 1 | 2;
  transcript: string;
  scored: boolean;
};

type PromptCase = SelectedCase & { userChars: number };

const FIXTURE_ENTITIES: EntityRecord[] = [
  { id: 'task-zvit', userId: USER, type: 'task', name: 'Звіт', status: 'open' },
  { id: 'task-narada', userId: USER, type: 'task', name: 'Нарада', status: 'open' },
  { id: 'task-gym', userId: USER, type: 'task', name: 'Gym', status: 'open' },
  { id: 'task-tax', userId: USER, type: 'task', name: 'Податки', status: 'open' },
];

export function selectArmACases(options?: { heldOut?: boolean }): { cases: SelectedCase[]; excluded: Exclusion[] } {
  const excluded: Exclusion[] = [];
  const cases: SelectedCase[] = [];
  for (const edge of EDGE_CASES) {
    cases.push({
      id: edge.id,
      source: 'edge',
      category: edge.category,
      language: edge.language,
      turns: edge.id === 'edge-repeat-confirm' ? 2 : 1,
      transcript: edge.transcript,
      scored: true,
    });
  }
  for (const scenario of BENCH_SCENARIOS) excluded.push(...fixtureExclusions(scenario));
  for (const scenario of FOLD_SCENARIOS) {
    if ((DISPUTED_IDS as readonly string[]).includes(scenario.id)) {
      excluded.push({ id: scenario.id, source: 'fold-experiment', reason: 'disputed gold; not used to judge quality' });
    }
  }
  const excludedIds = new Set(excluded.map((row) => row.id));
  for (const scenario of BENCH_SCENARIOS) {
    if (excludedIds.has(scenario.id)) continue;
    cases.push(fixtureCase(scenario.id, 'voice-regression', scenario.category, scenario.utterance));
  }
  for (const scenario of FOLD_SCENARIOS) {
    if (excludedIds.has(scenario.id)) continue;
    cases.push(fixtureCase(scenario.id, 'fold-experiment', scenario.kind, scenario.utterance));
  }
  if (options?.heldOut) {
    for (const held of HELD_OUT_CASES) {
      cases.push({
        id: held.id,
        source: 'held-out',
        category: 'held-out',
        language: held.language,
        turns: 1,
        transcript: held.transcript,
        scored: false,
      });
    }
  }
  return { cases, excluded };
}

function fixtureExclusions(scenario: BenchScenario): Exclusion[] {
  if ((DISPUTED_IDS as readonly string[]).includes(scenario.id)) {
    return [{ id: scenario.id, source: 'voice-regression', reason: 'disputed gold; not used to judge quality' }];
  }
  if (scenario.pendingClarification) {
    return [{ id: scenario.id, source: 'voice-regression', reason: 'planner pendingClarification cannot be stored as a vNext blocked operation without inventing that operation' }];
  }
  return [];
}

function fixtureCase(id: string, source: 'voice-regression' | 'fold-experiment', category: string, transcript: string): SelectedCase {
  return {
    id,
    source,
    category,
    language: /[А-Яа-яІіЇїЄєҐґ]/.test(transcript) ? 'uk' : 'en',
    turns: 1,
    transcript,
    scored: false,
  };
}

function userPrompt(input: {
  transcript: string;
  nowIso: string;
  timeZone: string;
  wakeHm: string;
  sleepHm: string;
  language: 'uk' | 'en';
  entities: EntityRecord[];
  openQuestion: string | null;
  pending: boolean;
  defaultDurationMinutes: number;
}): string {
  const today = scheduleTodayYmd(input.nowIso, input.timeZone, input.wakeHm, input.sleepHm);
  return buildTurnUser({
    transcript: input.transcript,
    nowLocal: `${localYmd(input.nowIso, input.timeZone)} ${localHm(input.nowIso, input.timeZone)}`,
    timeZone: input.timeZone,
    wakeHm: input.wakeHm,
    sleepHm: input.sleepHm,
    scheduleToday: today,
    tomorrow: addDaysToYmd(today, 1),
    weekdays: WEEKDAYS.map((name, dow) => `${name} ${upcomingWeekdayYmd(today, dow)}`).join(', '),
    defaultDurationMinutes: input.defaultDurationMinutes,
    language: input.language,
    owned: input.entities.filter((entity) => entity.userId === USER && entity.status === 'open').map((entity) => ({
      id: entity.id,
      type: entity.type,
      name: entity.name,
      status: entity.status,
    })),
    openQuestion: input.openQuestion,
    pending: input.pending,
  });
}

function promptFor(selected: SelectedCase): PromptCase {
  const edge = EDGE_CASES.find((item) => item.id === selected.id);
  const text = edge
    ? userPrompt({
      transcript: edge.transcript,
      nowIso: edge.nowIso,
      timeZone: edge.timeZone,
      wakeHm: edge.wakeHm,
      sleepHm: edge.sleepHm,
      language: edge.language,
      entities: edge.entities,
      openQuestion: edge.sessionPatch?.openQuestion ?? null,
      pending: Boolean(edge.sessionPatch?.pendingIntents?.length) || edge.id === 'edge-repeat-confirm',
      defaultDurationMinutes: edge.defaultDurationMinutes,
    })
    : userPrompt({
      transcript: selected.transcript,
      nowIso: CLOCK.nowIso,
      timeZone: CLOCK.timeZone,
      wakeHm: CLOCK.wake,
      sleepHm: CLOCK.sleep,
      language: selected.language,
      entities: FIXTURE_ENTITIES,
      openQuestion: null,
      pending: false,
      defaultDurationMinutes: 30,
    });
  return { ...selected, userChars: text.length };
}

export function reserveUsd(inputChars: number, at: Date): { usd: number; peak: boolean } {
  const inputTokens = Math.ceil(inputChars / MAX_CHARS_PER_TOKEN);
  return deepseekFlashUsd({ at, cacheHit: 0, cacheMiss: inputTokens, output: MAX_OUTPUT_TOKENS });
}

export function wouldExceed(spentUsd: number | null, reserve: number, budgetUsd: number): string | null {
  if (spentUsd == null) return 'usage split missing, so the next call is not started';
  if (spentUsd + reserve > budgetUsd) return 'the next call reserve would exceed the budget';
  return null;
}

export function armAEvaluationPlan(at = new Date()) {
  const selected = selectArmACases();
  const prompts = selected.cases.map(promptFor);
  const systemChars = INTERPRETER_A_SYSTEM.length;
  const turnChars = prompts.reduce((sum, row) => sum + (systemChars + row.userChars) * row.turns, 0);
  const minCalls = prompts.reduce((sum, row) => sum + row.turns, 0);
  const maxCalls = minCalls * MAX_CALLS_PER_TURN;
  const minInputTokens = Math.ceil(turnChars / MIN_CHARS_PER_TOKEN);
  const maxInputTokens = Math.ceil((turnChars * MAX_CALLS_PER_TURN) / MAX_CHARS_PER_TOKEN);
  const price = (peak: boolean, inputTokens: number, outputTokens: number) => deepseekFlashUsd({
    at: peak ? new Date('2026-10-28T07:00:00.000Z') : new Date('2026-10-28T00:00:00.000Z'),
    cacheHit: 0,
    cacheMiss: inputTokens,
    output: outputTokens,
  }).usd;
  const minOutputTokens = minCalls * ASSUMED_MIN_OUTPUT_TOKENS;
  const maxOutputTokens = maxCalls * MAX_OUTPUT_TOKENS;
  const categories = countBy(prompts, (row) => row.category);
  return {
    liveCalls: 0 as const,
    modelCalls: 0 as const,
    writes: 0 as const,
    arm: 'A' as const,
    provider: 'deepseek',
    configuredModel: process.env.DEEPSEEK_PLANNER_MODEL?.trim() || DEEPSEEK_FLASH_PRICE.model,
    pricingModel: DEEPSEEK_FLASH_PRICE.model,
    exactServedModel: 'unknown until a response includes it; the existing client does not return the served id',
    temperature: 0.1,
    temperatureNote: 'The shared DeepSeek call builder sends 0.1. It was not changed, and 0 was not substituted.',
    thinking: 'disabled',
    responseFormat: 'json_object',
    maxTokens: MAX_OUTPUT_TOKENS,
    promptHash: PROMPT_A_HASH,
    systemChars,
    clock: CLOCK.nowIso,
    timezone: CLOCK.timeZone,
    wake: CLOCK.wake,
    sleep: CLOCK.sleep,
    dataset: {
      voiceRegression: BENCH_SCENARIOS.length,
      foldExperiment: FOLD_SCENARIOS.length,
      originalFixtures: BENCH_SCENARIOS.length + FOLD_SCENARIOS.length,
      edgeCases: EDGE_CASES.length,
    },
    eligible: prompts.length,
    scoredEdges: prompts.filter((row) => row.scored).length,
    recordedWithoutSemanticGold: prompts.filter((row) => !row.scored).length,
    singleTurn: prompts.filter((row) => row.turns === 1).length,
    multiTurn: prompts.filter((row) => row.turns === 2).map((row) => row.id),
    languages: {
      uk: prompts.filter((row) => row.language === 'uk').length,
      en: prompts.filter((row) => row.language === 'en').length,
    },
    categories,
    excluded: selected.excluded,
    calls: { minimum: minCalls, maximum: maxCalls },
    tokens: {
      inputMinimum: minInputTokens,
      inputMaximum: maxInputTokens,
      outputMinimum: minOutputTokens,
      outputMaximum: maxOutputTokens,
      outputNote: 'Output tokens are bounds, not a measurement. No arm A live usage exists. The minimum assumes 200 output tokens per call. The maximum is max_tokens on every call.',
      inputNote: 'Input tokens are converted from measured prompt characters. Minimum uses 4 characters per token. Maximum uses 2 characters per token and counts a repair plus a tool follow-up.',
    },
    costUsd: {
      minimumOffPeak: roundUsd(price(false, minInputTokens, minOutputTokens)),
      maximumPeak: roundUsd(price(true, maxInputTokens, maxOutputTokens)),
      assumption: 'Cache miss. Peak uses the published peak rates. Off-peak uses the published off-peak rates. Chinese holidays are not applied.',
      price: DEEPSEEK_FLASH_PRICE,
    },
    peakNow: deepseekFlashUsd({ at, cacheHit: 0, cacheMiss: 0, output: 0 }).peak,
  };
}

function countBy(rows: PromptCase[], key: (row: PromptCase) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[key(row)] = (counts[key(row)] ?? 0) + 1;
  return counts;
}

function roundUsd(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function classifyArmAResult(input: {
  scored: boolean;
  rubric: Verdict | null;
  interpreterOk: boolean;
  live: SemanticEnvelopeV1 | undefined;
  authored: SemanticEnvelopeV1 | null;
  outcome: string;
  blocked: string[];
  serverWrites: number;
  category: string;
}): { classification: Phase44Class; firstFailure: string | null; additionalDefects: string[] } {
  if (!input.scored) {
    return {
      classification: 'UNVERIFIED',
      firstFailure: input.serverWrites === 0 ? null : 'server_write',
      additionalDefects: input.serverWrites === 0 ? [] : ['server_write'],
    };
  }
  if (input.serverWrites !== 0) {
    return { classification: 'FAIL - session lifecycle', firstFailure: 'server_write', additionalDefects: [] };
  }
  if (input.rubric === 'review') {
    return { classification: 'UNVERIFIED', firstFailure: 'pending_human_rubric', additionalDefects: [] };
  }
  if (!input.interpreterOk) {
    return { classification: 'FAIL - interpreter', firstFailure: 'invalid_model_output', additionalDefects: [] };
  }
  if (input.rubric === 'pass') {
    return { classification: 'PASS', firstFailure: null, additionalDefects: [] };
  }
  const same = input.authored ? sameInterpretation(input.live, input.authored) : false;
  const unsupported = input.blocked.some((code) => code === 'unrepresented_constraint' || code === 'unmapped_time' || code === 'unsupported_action' || code === 'unsupported_binding');
  if (same && unsupported && input.outcome !== 'confirm' && input.outcome !== 'act') {
    return { classification: 'FAIL - unsupported capability', firstFailure: input.blocked[0] ?? 'unsupported', additionalDefects: ['rubric_fail'] };
  }
  if (same && (input.category === 'confirmation' || input.category === 'clarification-lifecycle')) {
    return { classification: 'FAIL - session lifecycle', firstFailure: `outcome:${input.outcome}`, additionalDefects: ['rubric_fail'] };
  }
  if (same) {
    return { classification: 'FAIL - resolver/adapter', firstFailure: `outcome:${input.outcome}`, additionalDefects: ['rubric_fail'] };
  }
  return { classification: 'FAIL - interpreter', firstFailure: 'envelope_differs_from_authored', additionalDefects: input.rubric ? [`rubric:${input.rubric}`] : [] };
}

function sameInterpretation(live: SemanticEnvelopeV1 | undefined, authored: SemanticEnvelopeV1): boolean {
  if (!live || live.kind !== authored.kind || (live.control ?? '') !== (authored.control ?? '')) return false;
  if (live.operations.length !== authored.operations.length) return false;
  const liveRows = live.operations.map(signature).sort();
  const authoredRows = authored.operations.map(signature).sort();
  return liveRows.every((row, index) => row === authoredRows[index]);
}

function signature(operation: SemanticEnvelopeV1['operations'][number]): string {
  const constraints = operation.constraints.map(constraintSignature).sort().join('+');
  return [operation.action, operation.target.kind, operation.changes.title ?? '', constraints, operation.dependsOn.length > 0 ? 'deps' : 'nodeps'].join('|');
}

function constraintSignature(constraint: SemanticConstraintV1): string {
  if (constraint.kind === 'date') return `date:${constraint.value}:${constraint.precision}`;
  if (constraint.kind === 'clock') return `clock:${constraint.role}:${constraint.value}`;
  if (constraint.kind === 'time_of_day') return `tod:${constraint.label}:${constraint.bound ?? 'at'}`;
  if (constraint.kind === 'relative_time') return `rel:${constraint.anchor}:${constraint.direction}:${constraint.amount ?? ''}:${constraint.unit ?? ''}`;
  if (constraint.kind === 'weekday') return `wd:${constraint.weekday}:${constraint.which}`;
  if (constraint.kind === 'duration') return `dur:${constraint.minutes}`;
  if (constraint.kind === 'recurrence') return `rec:${constraint.expression}`;
  if (constraint.kind === 'ordering') return `ord:${constraint.relation}`;
  if (constraint.kind === 'day_bound') return `bound:${constraint.edge}:${constraint.role}`;
  return 'constraint';
}

const TEMPORAL_LIMITATION = 'The pipeline trace records target resolution and adapter output. Temporal status names are on pipeline events named resolve. The full ResolvedWhen objects are not exposed, and this runner does not change the pipeline to add them.';
const RETRY_BODY_LIMITATION = 'A transport retry is counted in httpAttempts. The existing client returns only the completed response text, so an intermediate HTTP body is not available.';

export type ArmALlmCallLog = {
  scenarioId: string;
  turn: number;
  attempt: number;
  kind: 'interpret' | 'schema-repair' | 'tool-follow-up';
  configuration: {
    model: string;
    temperature: 0.1 | null;
    thinking: 'disabled' | 'not sent; provider default';
    responseFormat: 'json_object';
    maxTokens: number;
    toolDefinitions: string;
    responseSchema: string;
  };
  messages: Array<{ role: 'system' | 'user'; content: string }>;
  rawResponse: string;
  httpAttempts: Array<{
    status: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    latencyMs: number;
    split: boolean;
    estimatedUsd: number | null;
  }>;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  estimatedUsd: number | null;
  requestId: null;
  error: string | null;
  retryBodyLimitation: string | null;
};

export type ArmATurnLog = {
  turn: number;
  utterance: string;
  inputContext: {
    nowIso: string;
    timeZone: string;
    wakeHm: string;
    sleepHm: string;
    language: 'uk' | 'en';
    entities: EntityRecord[];
      calendarSource: string;
      fixtureHistory: Array<{ role: 'user' | 'assistant'; text: string }>;
      conversationHistory: VNextSession['turns'];
      dialogueHistorySentToModel: boolean;
    openQuestion: string | null;
    pendingConfirmation: boolean;
  };
  sessionBefore: unknown;
  sessionAfter: unknown;
  llmCalls: ArmALlmCallLog[];
  envelope: SemanticEnvelopeV1 | null;
  interpreterOk: boolean;
  interpreterCode: string | null;
  tools: BenchmarkTrace['toolExecutions'];
  targetResolution: unknown[];
  dependencyResolution: unknown[];
  adapterResults: unknown[];
  policyDecisions: unknown[];
  pipelineEvents: unknown[];
  temporalLimitation: string;
  response: unknown;
  blocked: string[];
  serverWrites: number;
  error?: string;
};

export type ArmAResultRow = {
  id: string;
  utterance: string;
  source: SelectedCase['source'];
  category: string;
  language: 'uk' | 'en';
  turns: 1 | 2;
  turnLogs: ArmATurnLog[];
  classification: Phase44Class;
  firstFailure: string | null;
  additionalDefects: string[];
  rubric: Verdict | null;
  semantic: SemanticScore | null;
  expectation: SemanticExpectation | null;
  rubricNote: string;
  interpreterOk: boolean;
  envelope: SemanticEnvelopeV1 | null;
  outcome: string;
  intents: unknown[];
  blocked: string[];
  serverWrites: number;
  openQuestion: string | null;
  pendingIntentCount: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  estimatedUsd: number | null;
  usageKnown: boolean;
  requestId: null;
  error?: string;
};

export type RunOptions = {
  allowPaidCalls: boolean;
  model?: string;
  limit?: number;
  budgetUsd?: number;
  output?: string;
  heldOut?: boolean;
  completeGold?: boolean;
  ids?: string[];
  runId?: string;
  executionMode?: 'live' | 'replay' | 'mocked' | 'deterministic';
};

export const EVAL_SUITE_VERSION = 'phase476-1';
export const SCORER_VERSION = 'phase476-1';
export const SCHEMA_VERSION = '1';

export async function runArmAEvaluation(options: RunOptions): Promise<{ status: string; modelCalls: number; reason?: string; file?: string }> {
  if (options.allowPaidCalls !== true) {
    return { status: 'blocked', modelCalls: 0, reason: 'paid_calls_not_allowed' };
  }
  if (options.budgetUsd == null || !(options.budgetUsd > 0)) {
    return { status: 'blocked', modelCalls: 0, reason: 'budget_usd_required' };
  }
  loadEnv({ path: join(__dirname, '../../../../../.env') });
  const model = options.model?.trim() || DEEPSEEK_FLASH_PRICE.model;
  const profile = paidProfile(model);
  if (!profile) {
    return { status: 'blocked', modelCalls: 0, reason: 'model_not_priced' };
  }
  if (profile.provider === 'deepseek' && !process.env.DEEPSEEK_API_KEY?.trim()) {
    return { status: 'blocked', modelCalls: 0, reason: 'DEEPSEEK_API_KEY_missing' };
  }
  if (profile.provider === 'openai' && !process.env.OPENAI_API_KEY?.trim()) {
    return { status: 'blocked', modelCalls: 0, reason: 'OPENAI_API_KEY_missing' };
  }
  if (options.completeGold && profile.provider !== 'deepseek') {
    return { status: 'blocked', modelCalls: 0, reason: 'deepseek_only' };
  }
  const configuredModel = process.env.DEEPSEEK_PLANNER_MODEL?.trim() || profile.model;
  if (options.completeGold && configuredModel !== profile.model) {
    return { status: 'blocked', modelCalls: 0, reason: 'model_mismatch' };
  }
  let selected = selectArmACases({ heldOut: options.heldOut }).cases;
  if (options.completeGold) {
    const allowed = new Set(eligibleCompleteGold().eligible);
    selected = selected.filter((item) => allowed.has(item.id));
  }
  if (options.ids?.length) {
    const allowed = new Set(options.ids);
    selected = selected.filter((item) => allowed.has(item.id));
    if (selected.length === 0) {
      return { status: 'blocked', modelCalls: 0, reason: 'no_matching_ids' };
    }
  }
  selected = selected.slice(0, options.limit ?? Number.POSITIVE_INFINITY);
  const startedAt = new Date();
  const spend = newSpend(startedAt);
  const budgetUsd = options.budgetUsd;
  const sink: CallSink = { scenarioId: '', turn: 0, profile, calls: [] };
  const inner = profile.provider === 'deepseek'
    ? createDeepSeekComplete(spend, startedAt)
    : createLunaComplete(spend, startedAt);
  const complete = budgetingComplete(inner, spend, budgetUsd, startedAt, sink);
  const output = resolveOutput(options.output);
  mkdirSync(output, { recursive: true });
  const jsonl = join(output, 'phase44-results.jsonl');
  writeFileSync(jsonl, '');
  const rows: ArmAResultRow[] = [];
  let stopped = '';
  for (const selectedCase of selected) {
    try {
      const row = await runOne(selectedCase, complete, spend, sink);
      rows.push(row);
      appendFileSync(jsonl, `${JSON.stringify(row)}\n`);
      if (row.error?.startsWith('budget_stop')) {
        stopped = row.error;
        break;
      }
    } catch (err) {
      const message = redactSecrets(err instanceof Error ? err.message : String(err));
      if (message.startsWith('budget_stop')) {
        stopped = message;
        break;
      }
      const row = failedRow(selectedCase, message);
      rows.push(row);
      appendFileSync(jsonl, `${JSON.stringify(row)}\n`);
    }
  }
  const summary = {
    status: stopped ? 'partial' : 'complete',
    paid: true,
    arm: 'A',
    provider: profile.provider,
    model: profile.model,
    temperature: profile.temperature,
    promptHash: PROMPT_A_HASH,
    sentModel: configuredModel,
    runId: options.runId ?? randomUUID(),
    runVersion: EVAL_SUITE_VERSION,
    suiteVersion: EVAL_SUITE_VERSION,
    schemaVersion: SCHEMA_VERSION,
    scorerVersion: SCORER_VERSION,
    executionMode: options.executionMode ?? 'live',
    scenarioCount: rows.length,
    invocationCount: spend.calls.length,
    calendarSource: 'voice-agent-tools',
    clock: CLOCK,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    stopped: stopped || null,
    spend: {
      calls: spend.calls.length,
      inputTokens: spend.inputTokens,
      outputTokens: spend.outputTokens,
      totalTokens: spend.totalTokens,
      latencyMs: spend.latencyMs,
      usd: spend.usd,
      usdNote: spend.usdNote,
      peak: spend.peak,
    },
    counts: countClasses(rows),
    semantic: {
      eligible: rows.filter((row) => row.semantic != null).length,
      pass: rows.filter((row) => row.semantic?.correct).length,
      execution: rows.filter((row) => row.semantic?.supportedExecution).length,
    },
    loggingLimitations: [
      TEMPORAL_LIMITATION,
      RETRY_BODY_LIMITATION,
      'Recent dialogue is included in the interpreter user message, bounded to the last six turns. The exact user message is the message that was sent.',
      'Provider request ids are not returned by the existing client.',
      'The 67 fixtures have no vNext semantic gold. Their classification stays UNVERIFIED and is not a PASS.',
    ],
    rows,
  };
  const file = join(output, 'phase44-results.json');
  writeFileSync(file, JSON.stringify(summary, null, 2));
  return { status: summary.status, modelCalls: spend.calls.length, file };
}

type PaidProfile = {
  provider: 'deepseek' | 'openai';
  model: string;
  temperature: 0.1 | null;
  thinking: 'disabled' | 'not sent; provider default';
  traceParameters: Record<string, string | number | boolean>;
  reserve: (chars: number, at: Date) => { usd: number };
  priceAttempt: (attempt: LiveCall, at: Date) => number | null;
};

function paidProfile(model: string): PaidProfile | null {
  if (model === DEEPSEEK_FLASH_PRICE.model) {
    return {
      provider: 'deepseek',
      model,
      temperature: 0.1,
      thinking: 'disabled',
      traceParameters: { temperature: 0.1, thinking: false, responseFormat: 'json_object', maxTokens: MAX_OUTPUT_TOKENS },
      reserve: (chars, at) => reserveUsd(chars, at),
      priceAttempt: (attempt, at) => attempt.split
        ? deepseekFlashUsd({ at, cacheHit: attempt.cacheHit, cacheMiss: attempt.cacheMiss, output: attempt.outputTokens }).usd
        : null,
    };
  }
  if (model === GPT6_LUNA_PRICE.model) {
    return {
      provider: 'openai',
      model,
      temperature: null,
      thinking: 'not sent; provider default',
      traceParameters: { temperatureSent: false, reasoningEffortSent: false, responseFormat: 'json_object', maxTokens: MAX_OUTPUT_TOKENS },
      reserve: (chars) => {
        const inputTokens = Math.ceil(chars / MAX_CHARS_PER_TOKEN);
        return gpt6LunaUsd({ cacheHit: 0, cacheMiss: inputTokens, output: MAX_OUTPUT_TOKENS });
      },
      priceAttempt: (attempt) => attempt.split
        ? gpt6LunaUsd({ cacheHit: attempt.cacheHit, cacheMiss: attempt.cacheMiss, output: attempt.outputTokens }).usd
        : null,
    };
  }
  return null;
}

type CallSink = { scenarioId: string; turn: number; profile: PaidProfile; calls: ArmALlmCallLog[] };

function budgetingComplete(
  inner: { complete(input: { system: string; user: string }): Promise<{ text: string; inputTokens: number; outputTokens: number; latencyMs: number }> },
  spend: LiveSpend,
  budgetUsd: number,
  at: Date,
  sink: CallSink,
) {
  return {
    async complete(input: { system: string; user: string }) {
      const reserve = sink.profile.reserve(input.system.length + input.user.length, at);
      const reason = wouldExceed(spend.usd, roundUsd(reserve.usd * 2), budgetUsd);
      if (reason) throw new Error(`budget_stop: ${reason}`);
      const start = spend.calls.length;
      try {
        const row = await inner.complete(input);
        sink.calls.push(llmLog(sink, input, row, spend.calls.slice(start), at, null));
        return row;
      } catch (err) {
        const message = redactSecrets(err instanceof Error ? err.message : String(err));
        sink.calls.push(llmLog(sink, input, null, spend.calls.slice(start), at, message));
        throw err;
      }
    },
  };
}

function llmLog(
  sink: CallSink,
  input: { system: string; user: string },
  row: { text: string; inputTokens: number; outputTokens: number; latencyMs: number } | null,
  attempts: LiveCall[],
  at: Date,
  error: string | null,
): ArmALlmCallLog {
  const httpAttempts = attempts.map((attempt) => {
    const priced = sink.profile.priceAttempt(attempt, at);
    return {
      status: attempt.status,
      inputTokens: attempt.inputTokens,
      outputTokens: attempt.outputTokens,
      totalTokens: attempt.totalTokens,
      latencyMs: attempt.latencyMs,
      split: attempt.split,
      estimatedUsd: priced == null ? null : roundUsd(priced),
    };
  });
  const estimated = httpAttempts.reduce((sum, attempt) => (attempt.estimatedUsd == null ? sum : sum + attempt.estimatedUsd), 0);
  return {
    scenarioId: sink.scenarioId,
    turn: sink.turn,
    attempt: sink.calls.length + 1,
    kind: callKind(input.system, input.user),
    configuration: {
      model: sink.profile.model,
      temperature: sink.profile.temperature,
      thinking: sink.profile.thinking,
      responseFormat: 'json_object',
      maxTokens: MAX_OUTPUT_TOKENS,
      toolDefinitions: 'Tool names are listed in the system message. The request does not send a separate tools array.',
      responseSchema: 'response_format is json_object. No JSON schema is sent.',
    },
    messages: [
      { role: 'system', content: redactSecrets(input.system) },
      { role: 'user', content: redactSecrets(input.user) },
    ],
    rawResponse: redactSecrets(row?.text ?? ''),
    httpAttempts,
    inputTokens: row?.inputTokens ?? attempts.reduce((sum, attempt) => sum + attempt.inputTokens, 0),
    outputTokens: row?.outputTokens ?? attempts.reduce((sum, attempt) => sum + attempt.outputTokens, 0),
    latencyMs: row?.latencyMs ?? attempts.reduce((sum, attempt) => sum + attempt.latencyMs, 0),
    estimatedUsd: httpAttempts.some((attempt) => attempt.estimatedUsd == null) ? null : roundUsd(estimated),
    requestId: null,
    error,
    retryBodyLimitation: httpAttempts.length > 1 ? RETRY_BODY_LIMITATION : null,
  };
}

function callKind(system: string, user: string): ArmALlmCallLog['kind'] {
  if (system.includes('The previous JSON failed validation.')) return 'schema-repair';
  if (user.includes('\nReads:')) return 'tool-follow-up';
  return 'interpret';
}

async function runOne(
  selected: SelectedCase,
  complete: ReturnType<typeof budgetingComplete>,
  spend: LiveSpend,
  sink: CallSink,
): Promise<ArmAResultRow> {
  const before = spend.calls.length;
  const beforeIn = spend.inputTokens;
  const beforeOut = spend.outputTokens;
  const beforeMs = spend.latencyMs;
  const beforeUsd = spend.usd;
  const edge = EDGE_CASES.find((item) => item.id === selected.id) ?? null;
  const session = sessionFor(selected, edge);
  const turnLogs: ArmATurnLog[] = [];
  let result: PipelineResult | null = null;
  let interpreterOk = false;
  let live: SemanticEnvelopeV1 | undefined;
  let stopped = '';
  for (let turn = 0; turn < selected.turns; turn += 1) {
    const trace = emptyTrace({
      scenarioId: selected.id,
      branch: 'A',
      model: sink.profile.model,
      modelParameters: sink.profile.traceParameters,
      clock: edge?.nowIso ?? CLOCK.nowIso,
      timezone: edge?.timeZone ?? CLOCK.timeZone,
    });
    const sessionBefore = sessionSnapshot(session);
    sink.scenarioId = selected.id;
    sink.turn = turn + 1;
    sink.calls = [];
    let interpreterCode: string | null = null;
    try {
      const current = await runVNextTurn(turnInput(selected, edge, session, trace), {
        arm: 'A',
        interpret: async (user, transcript) => {
          const output = await runInterpreterA(complete, brokerFor(selected, edge), user, transcript, traceObserver(trace), (records) => {
            records.forEach((record) => trace.toolExecutions.push({
              request: { requestId: record.requestId, name: record.name, args: record.args },
              result: record.result ?? null,
              error: record.error ?? record.withheld ?? null,
            }));
          });
          live = output.envelope;
          interpreterOk = output.ok;
          interpreterCode = output.code ?? null;
          return output;
        },
      });
      result = current;
      turnLogs.push(turnLog(selected, edge, turn + 1, sessionBefore, session, sink.calls, trace, current, interpreterOk, interpreterCode, live));
    } catch (err) {
      const message = redactSecrets(err instanceof Error ? err.message : String(err));
      turnLogs.push(turnLog(selected, edge, turn + 1, sessionBefore, session, sink.calls, trace, null, interpreterOk, interpreterCode, live, message));
      stopped = message;
      break;
    }
  }
  const actual = result && !stopped ? actualOf(result, session) : null;
  const rubric = edge && actual ? scoreCase(edge.expect, actual) : null;
  const judged = classifyArmAResult({
    scored: selected.scored && !stopped,
    rubric,
    interpreterOk,
    live,
    authored: edge?.envelope ?? null,
    outcome: result?.response.outcome ?? 'error',
    blocked: result?.blocked ?? [],
    serverWrites: result?.serverWrites ?? 0,
    category: selected.category,
  });
  if (stopped) {
    judged.classification = 'UNVERIFIED';
    judged.firstFailure = stopped.startsWith('budget_stop') ? 'budget_stop' : 'transport';
  }
  const held = HELD_OUT_CASES.find((item) => item.id === selected.id);
  const expectation = edge ? expectationForEdge(edge) : null;
  const semantic = expectation && result && !stopped
    ? scoreSemanticOutcome({
      schemaValid: interpreterOk,
      outcome: result.response.outcome,
      intents: result.response.intents,
      blocked: result.blocked,
      serverWrites: result.serverWrites,
      preservedLabels: result.preservedLabels,
      question: result.response.assistantMessage,
      expectation,
    })
    : held && result && !stopped
    ? scoreSemanticOutcome({
      schemaValid: interpreterOk,
      outcome: result.response.outcome,
      intents: result.response.intents,
      blocked: result.blocked,
      serverWrites: result.serverWrites,
      expectation: { acceptable: held.acceptable, refusalAllowed: held.refusalAllowed },
    })
    : null;
  return {
    id: selected.id,
    utterance: selected.transcript,
    source: selected.source,
    category: selected.category,
    language: selected.language,
    turns: selected.turns,
    turnLogs,
    classification: selected.scored || stopped ? judged.classification : 'UNVERIFIED',
    firstFailure: judged.firstFailure,
    additionalDefects: judged.additionalDefects,
    rubric,
    semantic,
    expectation: expectation ?? null,
    rubricNote: selected.scored ? 'Automated rubric for this edge. It is not a manual judgment.' : 'No vNext semantic gold. This row is not a PASS.',
    interpreterOk,
    envelope: live ?? null,
    outcome: result?.response.outcome ?? 'error',
    intents: result?.response.intents ?? [],
    blocked: result?.blocked ?? [],
    serverWrites: result?.serverWrites ?? 0,
    openQuestion: session.openQuestion,
    pendingIntentCount: session.pendingIntents?.length ?? 0,
    calls: spend.calls.length - before,
    inputTokens: spend.inputTokens - beforeIn,
    outputTokens: spend.outputTokens - beforeOut,
    latencyMs: spend.latencyMs - beforeMs,
    estimatedUsd: spend.usd != null && beforeUsd != null ? roundUsd(spend.usd - beforeUsd) : null,
    usageKnown: spend.usd != null,
    requestId: null,
    ...(stopped ? { error: stopped } : {}),
  };
}

function resolveOutput(output: string | undefined): string {
  const root = join(__dirname, '../../../../../..');
  if (!output) return join(root, 'docs/voice-vnext/runs/phase44');
  if (output.startsWith('docs/') || output.startsWith('docs\\')) return join(root, output);
  return output;
}

function sessionSnapshot(session: VNextSession): unknown {
  return JSON.parse(JSON.stringify({
    openQuestion: session.openQuestion,
    pendingSummary: session.pendingSummary,
    pendingIntents: session.pendingIntents,
    heldIntents: session.heldIntents,
    adaptedOpIds: session.adaptedOpIds,
    canceledOpIds: session.canceledOpIds,
    pendingClarification: session.pendingClarification,
    planDraft: session.planDraft,
    qualitativeByItemId: session.qualitativeByItemId,
    turns: session.turns,
  }));
}

function turnLog(
  selected: SelectedCase,
  edge: EdgeCase | null,
  turn: number,
  sessionBefore: unknown,
  session: VNextSession,
  calls: ArmALlmCallLog[],
  trace: BenchmarkTrace,
  result: PipelineResult | null,
  interpreterOk: boolean,
  interpreterCode: string | null,
  envelope: SemanticEnvelopeV1 | undefined,
  error?: string,
): ArmATurnLog {
  const before = sessionBefore as {
    turns: VNextSession['turns'];
    openQuestion: string | null;
    pendingIntents: unknown[] | null;
  };
  return {
    turn,
    utterance: selected.transcript,
    inputContext: {
      nowIso: edge?.nowIso ?? CLOCK.nowIso,
      timeZone: edge?.timeZone ?? CLOCK.timeZone,
      wakeHm: edge?.wakeHm ?? CLOCK.wake,
      sleepHm: edge?.sleepHm ?? CLOCK.sleep,
      language: edge?.language ?? selected.language,
      entities: edge?.entities ?? FIXTURE_ENTITIES,
      calendarSource: 'voice-agent-tools',
      fixtureHistory: edge?.history ?? [],
      conversationHistory: JSON.parse(JSON.stringify(before.turns ?? [])),
      dialogueHistorySentToModel: true,
      openQuestion: before.openQuestion,
      pendingConfirmation: Boolean(before.pendingIntents?.length),
    },
    sessionBefore,
    sessionAfter: sessionSnapshot(session),
    llmCalls: calls,
    envelope: envelope ?? null,
    interpreterOk,
    interpreterCode,
    tools: trace.toolExecutions,
    targetResolution: trace.referenceResolution,
    dependencyResolution: trace.dependencyResolution,
    adapterResults: trace.adapterResults,
    policyDecisions: trace.policyDecisions,
    pipelineEvents: result?.traces ?? [],
    temporalLimitation: TEMPORAL_LIMITATION,
    response: result?.response ?? null,
    blocked: result?.blocked ?? [],
    serverWrites: result?.serverWrites ?? 0,
    ...(error ? { error } : {}),
  };
}

function sessionFor(selected: SelectedCase, edge: EdgeCase | null): VNextSession {
  const session = createSession(USER, `phase44-${selected.id}`);
  if (edge?.sessionPatch) Object.assign(session, edge.sessionPatch);
  if (edge?.id === 'edge-repeat-confirm') {
    session.pendingIntents = [{ type: 'create', summary: 'хліб', task: { name: 'хліб' } }];
    session.pendingSummary = 'хліб';
  }
  const bench = BENCH_SCENARIOS.find((item) => item.id === selected.id);
  if (bench?.history?.length) {
    for (const turn of bench.history) {
      if (turn.role === 'user' || turn.role === 'assistant') appendTurn(session, turn.role, turn.text);
    }
  }
  if (bench?.plan === 'today-interview') session.planDraft = interviewPlan();
  return session;
}

function turnInput(selected: SelectedCase, edge: EdgeCase | null, session: VNextSession, trace: BenchmarkTrace) {
  if (edge) {
    return {
      transcript: edge.transcript,
      userId: USER,
      session,
      nowIso: edge.nowIso,
      timeZone: edge.timeZone,
      wakeHm: edge.wakeHm,
      sleepHm: edge.sleepHm,
      defaultDurationMinutes: edge.defaultDurationMinutes,
      language: edge.language,
      entities: edge.entities,
      evidenceNeed: edge.evidenceNeed,
      arm: 'A' as const,
      trace,
      catalogSearch: exhaustiveCatalog(edge.entities),
    };
  }
  return {
    transcript: selected.transcript,
    userId: USER,
    session,
    nowIso: CLOCK.nowIso,
    timeZone: CLOCK.timeZone,
    wakeHm: CLOCK.wake,
    sleepHm: CLOCK.sleep,
    defaultDurationMinutes: 30,
    language: selected.language,
    entities: FIXTURE_ENTITIES,
    arm: 'A' as const,
    trace,
    catalogSearch: exhaustiveCatalog(FIXTURE_ENTITIES),
  };
}

function brokerFor(selected: SelectedCase, edge: EdgeCase | null): ReadBroker {
  const entities = edge?.entities ?? FIXTURE_ENTITIES;
  return domainReadBroker({
    entities,
    nowIso: edge?.nowIso ?? CLOCK.nowIso,
    timeZone: edge?.timeZone ?? CLOCK.timeZone,
    wakeHm: edge?.wakeHm ?? CLOCK.wake,
    sleepHm: edge?.sleepHm ?? CLOCK.sleep,
    failTool: edge?.id === 'edge-tool-timeout' ? 'find_free_gaps' : undefined,
  });
}

function actualOf(result: PipelineResult, session: VNextSession): RubricActual {
  const created = result.response.intents.find((intent) => intent.type === 'create');
  const minutes = created ? Number((created.task as { estimatedTimeInMinutes?: number }).estimatedTimeInMinutes) : undefined;
  return {
    outcome: result.response.outcome,
    serverWrites: result.serverWrites,
    body: JSON.stringify(result.response),
    intentCount: result.response.intents.length,
    heldCount: session.heldIntents.length,
    ...(Number.isFinite(minutes) ? { durationMinutes: minutes } : {}),
    preservedLabels: result.preservedLabels,
    blocked: result.blocked,
  };
}

function failedRow(selected: SelectedCase, error: string): ArmAResultRow {
  return {
    id: selected.id,
    utterance: selected.transcript,
    source: selected.source,
    category: selected.category,
    language: selected.language,
    turns: selected.turns,
    turnLogs: [],
    classification: 'UNVERIFIED',
    firstFailure: error.startsWith('budget_stop') ? 'budget_stop' : 'transport',
    additionalDefects: [],
    rubric: null,
    semantic: null,
    expectation: null,
    rubricNote: 'The scenario failed before a pipeline result. This row is not a PASS.',
    interpreterOk: false,
    envelope: null,
    outcome: 'error',
    intents: [],
    blocked: [],
    serverWrites: 0,
    openQuestion: null,
    pendingIntentCount: 0,
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: 0,
    estimatedUsd: null,
    usageKnown: false,
    requestId: null,
    error,
  };
}

function countClasses(rows: ArmAResultRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.classification] = (counts[row.classification] ?? 0) + 1;
  return counts;
}
