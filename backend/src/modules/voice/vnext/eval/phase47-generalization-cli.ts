/**
 * Evaluation-only runner for the frozen generalization set.
 * It calls the production pipeline and the existing phase4711 scorer.
 * It does not change prompts, scoring rules, or production control flow.
 *
 * npx ts-node --transpile-only src/modules/voice/vnext/eval/phase47-generalization-cli.ts --dry-run
 * npx ts-node --transpile-only src/modules/voice/vnext/eval/phase47-generalization-cli.ts --allow-paid-calls --budget-usd 2 --max-calls 1000 --output docs/voice-vnext/runs/phase47-generalization
 * npx ts-node --transpile-only src/modules/voice/vnext/eval/phase47-generalization-cli.ts --suite english --dry-run   (native English set, KI-19)
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createHash, randomUUID } from 'crypto';
import { config as loadEnv } from 'dotenv';
import type { DayPlanProposal, PlanDraft } from '../../voice-agent.types';
import { runVNextTurn, type PipelineResult } from '../pipeline';
import { createSession, type VNextSession } from '../session/session';
import { runInterpreterA } from '../interpreters/run-interpreter';
import { PROMPT_A_HASH, PROMPT_B_HASH } from '../interpreters/prompts';
import { domainReadBroker, exhaustiveCatalog } from './domain-calendar';
import { createDeepSeekComplete, newSpend, type LiveSpend } from '../llm/live-complete';
import type { LlmComplete } from '../repair/repair';
import { conversationSucceeded, judgeTurn, PHASE4711_SCORER, type ObservedTurn, type TurnVerdict } from './phase477-score';
import { fixtureEchoProposal } from './phase477-run';
import { GENERALIZATION_SCENARIOS, GENERALIZATION_SUITE, generalizationWorld, type GenScenario } from './phase47-generalization';
import type { EntityRecord } from '../reference/reference-resolver';
import { ENGLISH_SCENARIOS, ENGLISH_SUITE, englishWorld, type EnglishScenario, type EnglishWorld } from './english-set';

const NOW = '2026-10-18T06:00:00.000Z';
const ZONE = 'Europe/Kyiv';
const MAX_USD = 2;
const MAX_CALLS = 1000;

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
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
      /* torn last line */
    }
  }
  return ids;
}

/** `--suite english` runs the native English set (KI-19); the default is the Ukrainian generalization set. */
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
  if (category === 'A' || category === 'B' || category === 'C') rows = rows.filter((row) => row.category === category);
  if (ids) {
    const wanted = new Set(ids.split(',').map((id) => id.trim()).filter(Boolean));
    rows = rows.filter((row) => wanted.has(row.id));
  }
  return rows;
}

function plan() {
  const rows = selected();
  return {
    scenarios: rows.length,
    turns: rows.reduce((sum, row) => sum + row.turns.length, 0),
    byCategory: {
      A: rows.filter((row) => row.category === 'A').length,
      B: rows.filter((row) => row.category === 'B').length,
      C: rows.filter((row) => row.category === 'C').length,
    },
    suite: suiteName(),
    scorer: PHASE4711_SCORER,
    promptHash: PROMPT_A_HASH,
    promptBHash: PROMPT_B_HASH,
  };
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

async function run(outputDir: string, budget: number, maxCalls: number): Promise<void> {
  if (budget > MAX_USD || maxCalls > MAX_CALLS) throw new Error('generalization run refuses a budget above $2 or 1000 calls');
  const spend = newSpend();
  const inner = createDeepSeekComplete(spend);
  const complete: LlmComplete = {
    async complete(input) {
      if (spend.calls.length >= maxCalls || (spend.usd ?? 0) >= budget) throw new Error('budget');
      return inner.complete(input);
    },
  };
  mkdirSync(outputDir, { recursive: true });
  const jsonl = join(outputDir, 'turns.jsonl');
  const finished = process.argv.includes('--no-resume') ? new Set<string>() : doneIds(jsonl, PROMPT_A_HASH);
  const runId = randomUUID();
  let stopped = '';
  for (const row of selected().filter((item) => !finished.has(item.id))) {
    if (spend.calls.length >= maxCalls || (spend.usd ?? 0) >= budget) {
      stopped = 'budget';
      break;
    }
    const session = createSession('user-1', `${row.id}-${runId.slice(0, 8)}`);
    const entities = worldFor(row);
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
          nowIso: NOW,
          timeZone: ZONE,
          wakeHm: '08:00',
          sleepHm: '23:00',
          defaultDurationMinutes: 30,
          defaultReminderTime: '09:00',
          language: languageOf(row),
          arm: 'A',
          entities,
          planContext: { tasks: [], slots: [], timeZone: ZONE, nowIso: NOW, defaultDurationMinutes: 30 },
          proposeDay: async (_userId, draft: PlanDraft): Promise<DayPlanProposal> => fixtureEchoProposal(draft),
          catalogSearch: exhaustiveCatalog(entities),
        },
        {
          arm: 'A',
          interpret: async (user, transcriptText) => {
            try {
              const output = await runInterpreterA(complete, domainReadBroker({ entities, nowIso: NOW, timeZone: ZONE, wakeHm: '08:00', sleepHm: '23:00' }), user, transcriptText);
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
      const observed = observe(result, session, ZONE);
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
        note: turn.note ?? null,
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
    const full = verdicts.length === row.turns.length && verdicts.every((item) => item.completion);
    appendFileSync(jsonl, `${JSON.stringify({
      id: row.id,
      category: row.category,
      family: row.family,
      world: row.world,
      invariant: row.invariant,
      runId,
      suite: suiteName(),
      scorer: PHASE4711_SCORER,
      promptHash: PROMPT_A_HASH,
      model: 'deepseek-flash',
      executionMode: 'live',
      conversationSuccess: full,
      complete: verdicts.length === row.turns.length,
      verdicts,
      transcript,
    })}\n`, 'utf8');
    if (stopped) break;
  }
  const summary = summarize(jsonl, spend, runId, stopped);
  writeFileSync(join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2));
  const failures = failureRows(jsonl);
  writeFileSync(join(outputDir, 'failures.json'), JSON.stringify(failures, null, 2));
  console.log(JSON.stringify({ status: summary.status, modelCalls: spend.calls.length, usd: spend.usd, scenarios: summary.scenarios }));
}

function failureRows(jsonl: string) {
  const rows = latest(jsonl);
  return rows.filter((row) => !row.conversationSuccess).map((row) => ({
    id: row.id,
    category: row.category,
    family: row.family,
    invariant: row.invariant,
    complete: row.complete,
    turns: row.transcript.map((turn) => ({
      turn: turn.turn,
      utterance: turn.utterance,
      outcome: turn.outcome,
      blocked: turn.blocked,
      assistantMessage: turn.assistantMessage,
      verdict: turn.verdict,
      error: turn.error,
      note: turn.note,
    })),
  }));
}

type Stored = {
  id: string;
  category: 'A' | 'B' | 'C';
  family: string;
  invariant: string;
  complete?: boolean;
  conversationSuccess?: boolean;
  verdicts: TurnVerdict[];
  transcript: Array<{ turn: number; utterance: string; outcome: string; blocked: string[]; assistantMessage: string; verdict: TurnVerdict; error: string | null; note: string | null; latencyMs?: number; calls?: number }>;
};

function latest(jsonl: string): Stored[] {
  const raw = existsSync(jsonl) ? readFileSync(jsonl, 'utf8') : '';
  const parsed: Stored[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      parsed.push(JSON.parse(line) as Stored);
    } catch {
      /* torn line */
    }
  }
  const map = new Map<string, Stored>();
  for (const row of parsed) map.set(row.id, row);
  return [...map.values()];
}

function bucket(rows: Stored[]) {
  const passed = rows.filter((row) => row.conversationSuccess).length;
  return { scenarios: rows.length, passed, failed: rows.length - passed, rate: rows.length ? passed / rows.length : 0 };
}

function summarize(jsonl: string, spend: LiveSpend, runId: string, stopped: string) {
  const rows = latest(jsonl);
  const turns = rows.flatMap((row) => row.verdicts);
  const latencies = rows.flatMap((row) => row.transcript.map((turn) => turn.latencyMs ?? 0)).filter((value) => value > 0);
  const categories: Record<string, number> = {};
  for (const turn of turns) {
    if (!turn.category) continue;
    categories[turn.category] = (categories[turn.category] ?? 0) + 1;
  }
  const by = {
    A: bucket(rows.filter((row) => row.category === 'A')),
    B: bucket(rows.filter((row) => row.category === 'B')),
    C: bucket(rows.filter((row) => row.category === 'C')),
  };
  return {
    status: stopped ? 'partial' : rows.length === selected().length ? 'complete' : 'partial',
    stopped: stopped || null,
    runId,
    suite: suiteName(),
    scorer: PHASE4711_SCORER,
    promptHash: PROMPT_A_HASH,
    promptBHash: PROMPT_B_HASH,
    executionMode: 'live',
    plannerMode: 'fixture-echo',
    model: 'deepseek-flash',
    temperature: 0.1,
    thinking: false,
    scenarios: rows.length,
    passed: rows.filter((row) => row.conversationSuccess).length,
    failed: rows.filter((row) => !row.conversationSuccess).length,
    byCategory: by,
    turns: turns.length,
    perTurnSuccess: turns.filter((turn) => turn.completion).length,
    unsafeTurns: turns.filter((turn) => !turn.safety).length,
    unnecessaryClarification: turns.filter((turn) => turn.category === 'model_unnecessary_clarification').length,
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
    unused: conversationSucceeded([]),
  };
}

async function main(): Promise<void> {
  loadEnv({ path: join(__dirname, '../../../../../.env') });
  const paid = process.argv.includes('--allow-paid-calls');
  if (!paid || process.argv.includes('--dry-run')) {
    console.log(JSON.stringify({ status: 'dry-run', modelCalls: 0, writes: 0, keyPresent: Boolean(process.env.DEEPSEEK_API_KEY?.trim()), plan: plan() }));
    return;
  }
  const output = arg('--output');
  if (!output || !output.includes('phase47-generalization')) {
    console.error(JSON.stringify({ status: 'blocked', reason: 'output must be a phase47-generalization directory', modelCalls: 0 }));
    process.exit(2);
  }
  await run(join(__dirname, '../../../../../..', output), Number(arg('--budget-usd') ?? '2'), Number(arg('--max-calls') ?? '1000'));
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(JSON.stringify({ status: 'error', modelCalls: 0, message: message.replace(/sk-[A-Za-z0-9]+/g, '[redacted]') }));
  process.exit(1);
});
