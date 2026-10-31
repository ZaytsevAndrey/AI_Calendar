/**
 * Live evaluation runner (V7) for the frozen generalization set (uk) and the native English set.
 *
 * Production-faithful: every turn goes through the real `StructuredVoiceService.turn()` (the class
 * behind POST /voice/turn) with the production prompt, the production `GroqClient` routing
 * (DeepSeek when VOICE_LLM_PROVIDER=deepseek), validation, projection, claims and dialogue; the
 * client simulator sends the shown claim on every turn and reports dispatched writes as applied
 * (nothing is written anywhere — preview-only verification). See live-service-harness.ts.
 *
 * Before 31 Oct 2026 this runner called the pipeline with a minimal user message and no claims, so
 * its results are not comparable with the ones it writes now.
 *
 *   npx ts-node --transpile-only src/modules/voice/vnext/eval/phase47-generalization-cli.ts --dry-run
 *   npx ts-node --transpile-only src/modules/voice/vnext/eval/phase47-generalization-cli.ts --allow-paid-calls --budget-usd 2 --output backend/eval-runs/<folder>/phase47-generalization
 *   npx ts-node --transpile-only src/modules/voice/vnext/eval/phase47-generalization-cli.ts --suite english --dry-run
 *   flags: --ids a,b --category A|B|C|D --no-resume --env <path to .env> --max-calls N
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { isAbsolute, join } from 'path';
import { randomUUID } from 'crypto';
import { config as loadEnv } from 'dotenv';
import { PROMPT_A_HASH, PROMPT_B_HASH } from '../interpreters/prompts';
import type { EntityRecord } from '../reference/reference-resolver';
import { conversationSucceeded, judgeTurn, judgeTurnChecks, PHASE4711_SCORER, type TurnVerdict } from './phase477-score';
import { GENERALIZATION_SCENARIOS, GENERALIZATION_SUITE, generalizationWorld, type GenScenario } from './phase47-generalization';
import { ENGLISH_SCENARIOS, ENGLISH_SUITE, englishWorld, type EnglishScenario, type EnglishWorld } from './english-set';
import {
  buildLiveService,
  DEFAULT_SETTINGS,
  LIVE_NOW,
  LIVE_ZONE,
  liveClient,
  productionGroq,
  StepCapture,
  storeFromWorld,
  type LiveTurn,
} from './live-service-harness';

const MAX_USD = 5;
const MAX_CALLS = 2000;

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

type RunScenario = GenScenario | EnglishScenario;

function suiteName(): string {
  return arg('--suite') === 'english' ? ENGLISH_SUITE : GENERALIZATION_SUITE;
}

function worldFor(row: RunScenario): EntityRecord[] {
  return 'language' in row && row.language === 'en' ? englishWorld(row.world as EnglishWorld) : generalizationWorld(row.world as GenScenario['world']);
}

function languageOf(row: RunScenario): 'uk' | 'en' {
  return 'language' in row && row.language === 'en' ? 'en' : 'uk';
}

function selected(): RunScenario[] {
  const ids = arg('--ids');
  const category = arg('--category');
  let rows: RunScenario[] = arg('--suite') === 'english' ? ENGLISH_SCENARIOS : GENERALIZATION_SCENARIOS;
  if (category) rows = rows.filter((row) => row.category === category);
  if (ids) {
    const wanted = new Set(ids.split(',').map((id) => id.trim()).filter(Boolean));
    rows = rows.filter((row) => wanted.has(row.id));
  }
  return rows;
}

function plan() {
  const rows = selected();
  const byCategory: Record<string, number> = {};
  for (const row of rows) byCategory[row.category] = (byCategory[row.category] ?? 0) + 1;
  return {
    scenarios: rows.length,
    turns: rows.reduce((sum, row) => sum + row.turns.length, 0),
    byCategory,
    suite: suiteName(),
    scorer: PHASE4711_SCORER,
    promptHash: PROMPT_A_HASH,
    promptBHash: PROMPT_B_HASH,
    executionMode: 'live-service (preview-only: client writes simulated as applied)',
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
      /* torn last line */
    }
  }
  return ids;
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

type Spend = { calls: number; tokens: number; promptTokens: number; completionTokens: number; usd: number };

function addUsage(spend: Spend, usage: LiveTurn['usage']): void {
  if (!usage) return;
  spend.calls += usage.calls;
  spend.tokens += usage.tokens;
  spend.promptTokens += usage.promptTokens;
  spend.completionTokens += usage.completionTokens;
  spend.usd = Math.round((spend.usd + usage.usd) * 1_000_000) / 1_000_000;
}

/** The scorer's error class, refined by what the turn log shows (transport / validation / fail-closed codes). */
function classify(verdict: TurnVerdict, turn: LiveTurn): string | null {
  if (verdict.completion) return null;
  const steps = turn.steps.map((step) => step.name);
  if (steps.includes('interpreter.failed') || steps.includes('model.call') && turn.steps.some((step) => step.name === 'model.call' && step.warn)) return 'provider_or_transport_error';
  if (turn.validationErrors.length && turn.observed.outcome !== 'confirm' && turn.observed.outcome !== 'act') return `model_output_invalid:${turn.validationErrors.slice(0, 3).join('|')}`;
  if (turn.observed.blocked.length) return `${verdict.category}:${turn.observed.blocked.join(',')}`;
  return verdict.category;
}

async function run(outputDir: string, budget: number, maxCalls: number): Promise<void> {
  if (budget > MAX_USD || maxCalls > MAX_CALLS) throw new Error(`live run refuses a budget above $${MAX_USD} or ${MAX_CALLS} calls`);
  mkdirSync(outputDir, { recursive: true });
  const jsonl = join(outputDir, 'turns.jsonl');
  const finished = process.argv.includes('--no-resume') ? new Set<string>() : doneIds(jsonl, PROMPT_A_HASH);
  const runId = randomUUID();
  const spend: Spend = { calls: 0, tokens: 0, promptTokens: 0, completionTokens: 0, usd: 0 };
  const groq = productionGroq();
  const capture = new StepCapture();
  capture.start();
  let stopped = '';
  try {
    for (const row of selected().filter((item) => !finished.has(item.id))) {
      if (spend.calls >= maxCalls || spend.usd >= budget) {
        stopped = 'budget';
        break;
      }
      const world = worldFor(row);
      const store = storeFromWorld(world);
      const service = buildLiveService(store, { ...DEFAULT_SETTINGS, language: languageOf(row) }, groq);
      const client = liveClient({ service, groq, capture, sessionId: `${row.id}-${runId.slice(0, 8)}`, store });
      const verdicts: TurnVerdict[] = [];
      const transcript: unknown[] = [];
      for (let index = 0; index < row.turns.length; index += 1) {
        if (spend.calls >= maxCalls || spend.usd >= budget) {
          stopped = 'budget';
          break;
        }
        const turn = row.turns[index];
        let live: LiveTurn;
        try {
          live = await client.turn(turn.utterance);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          verdicts.push({ semantic: false, safety: true, completion: false, category: 'harness_error', detail: redact(message) });
          transcript.push({ turn: index, utterance: turn.utterance, error: redact(message) });
          break;
        }
        addUsage(spend, live.usage);
        const verdict = judgeTurn(live.observed, turn.expect);
        const errorClass = classify(verdict, live);
        verdicts.push(verdict);
        transcript.push({
          turn: index,
          utterance: turn.utterance,
          note: turn.note ?? null,
          expect: turn.expect,
          claimSent: live.dto.executionId ? { executionId: live.dto.executionId, previewRevision: live.dto.previewRevision } : null,
          outcome: live.observed.outcome,
          blocked: live.observed.blocked,
          assistantMessage: live.observed.assistantMessage,
          intents: live.observed.intents,
          execution: live.response.execution ?? null,
          plan: live.response.plan ? { day: live.response.plan.day, stage: live.response.plan.stage, items: live.response.plan.items.map((item) => item.name) } : null,
          draftNames: live.observed.draftNames,
          pendingCount: live.observed.pendingCount,
          serverWrites: live.observed.serverWrites,
          prompt: live.prompt,
          modelOutputs: live.modelOutputs,
          reads: live.reads,
          validationErrors: live.validationErrors,
          verdict,
          checks: judgeTurnChecks(live.observed, turn.expect),
          errorClass,
          usage: live.usage,
          latencyMs: live.latencyMs,
          simulatedReport: live.simulatedReport,
          stepNames: live.steps.map((step) => `${step.warn ? '!' : ''}${step.name}`),
          warnings: live.steps.filter((step) => step.warn).map((step) => ({ step: step.name, ...step.fields })),
        });
      }
      const complete = verdicts.length === row.turns.length;
      appendFileSync(jsonl, `${JSON.stringify({
        id: row.id,
        category: row.category,
        family: row.family,
        language: languageOf(row),
        multiTurn: row.turns.length > 1,
        world: row.world,
        invariant: row.invariant,
        runId,
        suite: suiteName(),
        scorer: PHASE4711_SCORER,
        promptHash: PROMPT_A_HASH,
        model: process.env.DEEPSEEK_PLANNER_MODEL?.trim() || 'deepseek-flash',
        executionMode: 'live-service-preview-only',
        conversationSuccess: complete && conversationSucceeded(verdicts),
        complete,
        verdicts,
        transcript,
      })}\n`, 'utf8');
      if (stopped) break;
    }
  } finally {
    capture.stop();
  }
  const summary = summarize(jsonl, spend, runId, stopped);
  writeFileSync(join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2));
  writeFileSync(join(outputDir, 'failures.json'), JSON.stringify(failureRows(jsonl), null, 2));
  console.log(JSON.stringify({ status: summary.status, modelCalls: spend.calls, usd: spend.usd, scenarios: summary.scenarios, passed: summary.passed }));
}

function redact(text: string): string {
  return text.replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]');
}

type StoredTurn = {
  turn: number; utterance: string; outcome?: string; blocked?: string[]; assistantMessage?: string; verdict?: TurnVerdict; errorClass?: string | null;
  note?: string | null; latencyMs?: number; usage?: Spend | null; error?: string; intents?: unknown; expect?: unknown; reads?: Array<{ tool: string }>;
};
type Stored = {
  id: string; category: string; family: string; language: 'uk' | 'en'; multiTurn: boolean; invariant: string;
  complete?: boolean; conversationSuccess?: boolean; verdicts: TurnVerdict[]; transcript: StoredTurn[];
};

function latest(jsonl: string): Stored[] {
  const raw = existsSync(jsonl) ? readFileSync(jsonl, 'utf8') : '';
  const map = new Map<string, Stored>();
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as Stored;
      map.set(row.id, row);
    } catch {
      /* torn line */
    }
  }
  return [...map.values()];
}

function failureRows(jsonl: string) {
  return latest(jsonl).filter((row) => !row.conversationSuccess).map((row) => ({
    id: row.id,
    category: row.category,
    family: row.family,
    language: row.language,
    invariant: row.invariant,
    complete: row.complete,
    turns: row.transcript.map((turn) => ({
      turn: turn.turn,
      utterance: turn.utterance,
      expect: turn.expect,
      outcome: turn.outcome,
      blocked: turn.blocked,
      assistantMessage: turn.assistantMessage,
      intents: turn.intents,
      reads: turn.reads?.map((read) => read.tool),
      verdict: turn.verdict,
      errorClass: turn.errorClass,
      error: turn.error,
      note: turn.note,
    })),
  }));
}

function bucket(rows: Stored[]) {
  const passed = rows.filter((row) => row.conversationSuccess).length;
  return { scenarios: rows.length, passed, failed: rows.length - passed, rate: rows.length ? Math.round((passed / rows.length) * 1000) / 1000 : 0 };
}

function summarize(jsonl: string, spend: Spend, runId: string, stopped: string) {
  const rows = latest(jsonl);
  const turns = rows.flatMap((row) => row.verdicts);
  const storedTurns = rows.flatMap((row) => row.transcript);
  const latencies = storedTurns.map((turn) => turn.latencyMs ?? 0).filter((value) => value > 0);
  const categories: Record<string, number> = {};
  for (const turn of storedTurns) {
    const key = turn.errorClass ?? turn.verdict?.category;
    if (!key) continue;
    categories[key] = (categories[key] ?? 0) + 1;
  }
  const by = (pick: (row: Stored) => string) => {
    const groups: Record<string, ReturnType<typeof bucket>> = {};
    for (const key of new Set(rows.map(pick))) groups[key] = bucket(rows.filter((row) => pick(row) === key));
    return groups;
  };
  return {
    status: stopped ? 'partial' : rows.length === selected().length ? 'complete' : 'partial',
    stopped: stopped || null,
    runId,
    suite: suiteName(),
    scorer: PHASE4711_SCORER,
    promptHash: PROMPT_A_HASH,
    promptBHash: PROMPT_B_HASH,
    executionMode: 'live-service-preview-only',
    plannerMode: 'fixture-echo',
    model: process.env.DEEPSEEK_PLANNER_MODEL?.trim() || 'deepseek-flash',
    provider: process.env.VOICE_LLM_PROVIDER?.trim() || 'auto',
    temperature: 0.1,
    thinking: false,
    nowIso: LIVE_NOW,
    timeZone: LIVE_ZONE,
    scenarios: rows.length,
    passed: rows.filter((row) => row.conversationSuccess).length,
    failed: rows.filter((row) => !row.conversationSuccess).length,
    byCategory: by((row) => row.category),
    byLanguage: by((row) => row.language),
    byTurns: by((row) => (row.multiTurn ? 'multi' : 'single')),
    byFamily: by((row) => row.family),
    turns: turns.length,
    perTurnSuccess: turns.filter((turn) => turn.completion).length,
    unsafeTurns: turns.filter((turn) => !turn.safety).length,
    unnecessaryClarification: turns.filter((turn) => turn.category === 'model_unnecessary_clarification').length,
    serverWrites: 0,
    errorClasses: categories,
    modelCalls: spend.calls,
    tokens: spend.tokens,
    promptTokens: spend.promptTokens,
    completionTokens: spend.completionTokens,
    usd: spend.usd,
    usdNote: 'deepseek-flash list price, input priced as uncached (cache hits not reported through GroqClient)',
    latencyP50: percentile(latencies, 50),
    latencyP95: percentile(latencies, 95),
    incomplete: rows.filter((row) => row.complete === false).map((row) => row.id),
  };
}

async function main(): Promise<void> {
  loadEnv({ path: arg('--env') ?? join(__dirname, '../../../../../.env') });
  const paid = process.argv.includes('--allow-paid-calls');
  if (!paid || process.argv.includes('--dry-run')) {
    console.log(JSON.stringify({
      status: 'dry-run',
      modelCalls: 0,
      writes: 0,
      keyPresent: Boolean(process.env.DEEPSEEK_API_KEY?.trim()),
      provider: process.env.VOICE_LLM_PROVIDER?.trim() || 'auto',
      model: process.env.DEEPSEEK_PLANNER_MODEL?.trim() || 'deepseek-flash',
      plan: plan(),
    }));
    return;
  }
  const output = arg('--output');
  if (!output || !output.includes('phase47-generalization')) {
    console.error(JSON.stringify({ status: 'blocked', reason: 'output must be a phase47-generalization directory', modelCalls: 0 }));
    process.exit(2);
  }
  // Relative to the repository root when run from src/; absolute paths are used as given (compiled runs).
  await run(isAbsolute(output) ? output : join(__dirname, '../../../../../..', output), Number(arg('--budget-usd') ?? '2'), Number(arg('--max-calls') ?? '1000'));
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(JSON.stringify({ status: 'error', modelCalls: 0, message: message.replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]') }));
  process.exit(1);
});
