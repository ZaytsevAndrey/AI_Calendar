import { mkdirSync, writeFileSync, appendFileSync } from 'fs';
import { createHash } from 'crypto';
import { execSync } from 'child_process';
import { join } from 'path';
import { config as loadEnv } from 'dotenv';
import { ReadBroker } from '../broker/read-broker';
import { emptyTrace, redactSecrets, traceObserver, type BenchmarkTrace } from '../diagnostics/trace';
import { PROMPT_A_HASH, PROMPT_B_HASH } from '../interpreters/prompts';
import { runInterpreterA, runInterpreterB } from '../interpreters/run-interpreter';
import { createDeepSeekComplete, newSpend, type LiveSpend } from '../llm/live-complete';
import { DEEPSEEK_FLASH_PRICE } from '../llm/pricing';
import { runVNextTurn, type PipelineResult } from '../pipeline';
import { createSession, type VNextSession } from '../session/session';
import { originalSemanticAnnotations } from './catalog';
import { EDGE_CASES, FIXTURE_VERSION, type EdgeCase } from './edge-cases';
import { edgeTool } from './edge-tools';
import { runLegacyTurn } from './legacy-live';
import { scoreCase, type RubricActual, type Verdict } from './rubric';

const USER = 'user-1';
const MAX_CALLS = 800;

type ArmName = 'legacy' | 'A' | 'B';

type Row = {
  id: string;
  category: string;
  arm: ArmName;
  verdict: Verdict | 'transport';
  outcome: string;
  intentCount: number;
  heldCount: number;
  blocked: string[];
  safety: string | null;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  error?: string;
};

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function safetyOf(edge: EdgeCase, actual: RubricActual): string | null {
  if (actual.serverWrites !== 0) return 'server_write';
  if (edge.expect.forbidClock && actual.body.includes(edge.expect.forbidClock)) return 'invented_clock';
  const expectsNoWrite = edge.expect.intentCount === 0
    && (edge.expect.outcome === 'clarify' || edge.expect.outcome === 'refuse' || edge.expect.outcome === 'answer');
  if ((actual.outcome === 'confirm' || actual.outcome === 'act') && actual.intentCount > 0 && expectsNoWrite) {
    return 'write_when_blocked';
  }
  return null;
}

function fromPipeline(result: PipelineResult, session: VNextSession): RubricActual {
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

function legacyTrace(complete: ReturnType<typeof createDeepSeekComplete>, trace: BenchmarkTrace): ReturnType<typeof createDeepSeekComplete> {
  return {
    complete: async (input) => {
      try {
        const row = await complete.complete(input);
        trace.llmCalls.push({
          requestMetadata: { systemChars: input.system.length, userChars: input.user.length },
          rawResponse: redactSecrets(row.text),
          parsedResponse: null,
          tokenUsage: { inputTokens: row.inputTokens, outputTokens: row.outputTokens },
          latencyMs: row.latencyMs,
        });
        return row;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        trace.llmCalls.push({
          requestMetadata: { systemChars: input.system.length, userChars: input.user.length },
          rawResponse: '',
          parsedResponse: null,
          tokenUsage: { inputTokens: 0, outputTokens: 0 },
          latencyMs: 0,
          error: redactSecrets(message),
        });
        throw err;
      }
    },
  };
}

async function runArm(
  edge: EdgeCase,
  arm: ArmName,
  complete: ReturnType<typeof createDeepSeekComplete>,
  session: VNextSession,
  traces: BenchmarkTrace[],
): Promise<{ actual: RubricActual; calls: number; inputTokens: number; outputTokens: number; latencyMs: number; trace: BenchmarkTrace }> {
  const trace = emptyTrace({
    scenarioId: edge.id,
    branch: arm,
    model: 'deepseek-flash',
    modelParameters: { temperature: 0.1, thinking: false, responseFormat: 'json_object', maxTokens: 4096 },
    clock: edge.nowIso,
    timezone: edge.timeZone,
  });
  traces.push(trace);
  if (arm === 'legacy') {
    const ran = await runLegacyTurn(edge, legacyTrace(complete, trace), session);
    trace.finalResponse = ran.actual.body;
    trace.dependencyResolution = [{ status: 'production_pipeline', note: 'legacy does not emit a vNext dependency graph' }];
    return { actual: ran.actual, ...ran.usage, trace };
  }
  const broker = () => new ReadBroker(edgeTool(edge));
  const result = await runVNextTurn(
    {
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
      arm,
      trace,
    },
    {
      arm,
      interpret: (user, transcript) => arm === 'A'
        ? runInterpreterA(complete, broker(), user, transcript, traceObserver(trace), (records) => {
          records.forEach((record) => trace.toolExecutions.push({
            request: { requestId: record.requestId, name: record.name, args: record.args },
            result: record.result ?? null,
            error: record.error ?? record.withheld ?? null,
          }));
        })
        : runInterpreterB(complete, broker(), user, transcript, traceObserver(trace), (records) => {
          records.forEach((record) => trace.toolExecutions.push({
            request: { requestId: record.requestId, name: record.name, args: record.args },
            result: record.result ?? null,
            error: record.error ?? record.withheld ?? null,
          }));
        }),
    },
  );
  return {
    actual: fromPipeline(result, session),
    calls: result.usage.calls,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    latencyMs: result.usage.latencyMs,
    trace,
  };
}

function sessionFor(edge: EdgeCase): VNextSession {
  const session = createSession(USER, `live-${edge.id}`);
  if (edge.sessionPatch) Object.assign(session, edge.sessionPatch);
  return session;
}

function tally(rows: Row[], arm: ArmName) {
  const mine = rows.filter((row) => row.arm === arm);
  const count = (verdict: Row['verdict']) => mine.filter((row) => row.verdict === verdict).length;
  const latencies = mine.map((row) => row.latencyMs);
  return {
    pass: count('pass'),
    fail: count('fail'),
    review: count('review'),
    transport: count('transport'),
    safety: mine.filter((row) => row.safety).map((row) => ({ id: row.id, safety: row.safety })),
    calls: mine.reduce((sum, row) => sum + row.calls, 0),
    inputTokens: mine.reduce((sum, row) => sum + row.inputTokens, 0),
    outputTokens: mine.reduce((sum, row) => sum + row.outputTokens, 0),
    latencyMs: mine.reduce((sum, row) => sum + row.latencyMs, 0),
    p50Ms: percentile(latencies, 50),
    p95Ms: percentile(latencies, 95),
  };
}

function recommend(rows: Row[]): { winner: 'A' | 'B' | 'neither'; reason: string; promotion: false } {
  const byName: Record<ArmName, ReturnType<typeof tally>> = {
    legacy: tally(rows, 'legacy'),
    A: tally(rows, 'A'),
    B: tally(rows, 'B'),
  };
  if (byName.legacy.transport > 0 || byName.A.transport > 0 || byName.B.transport > 0) {
    return { winner: 'neither', reason: 'incomplete: a transport error interrupted at least one case', promotion: false };
  }
  const candidates = (['A', 'B'] as const).filter((arm) => byName[arm].safety.length === 0 && byName[arm].pass > byName.legacy.pass);
  if (byName.legacy.safety.length > 0 && candidates.length === 0) {
    return { winner: 'neither', reason: 'legacy has a safety failure and neither candidate is both safer and more correct', promotion: false };
  }
  if (!candidates.length) {
    return { winner: 'neither', reason: 'neither A nor B passed more authored edge cases than legacy without a safety failure', promotion: false };
  }
  const ranked = [...candidates].sort((left, right) => byName[right].pass - byName[left].pass || byName[left].calls - byName[right].calls);
  const winner = ranked[0];
  if (ranked.length === 2 && byName.A.pass === byName.B.pass) {
    return { winner: 'neither', reason: 'A and B tied on authored passes', promotion: false };
  }
  return {
    winner,
    reason: `${winner} passed ${byName[winner].pass} authored cases against legacy ${byName.legacy.pass}, with no safety failure on this single pass`,
    promotion: false,
  };
}

/** Describes the next live comparison. Does not call a model. */
export function comparisonPlan() {
  const original = originalSemanticAnnotations();
  return {
    liveCalls: 0 as const,
    traces: true,
    arms: ['legacy', 'A', 'B'] as const,
    model: 'deepseek-flash',
    modelParameters: { temperature: 0.1, thinking: 'disabled', responseFormat: 'json_object', maxTokens: 4096 },
    clock: '2026-10-18T06:00:00.000Z',
    timezone: 'Europe/Kyiv',
    edgeCases: EDGE_CASES.map((edge) => edge.id),
    edgeEvaluator: 'scoreCase',
    originalScenarios: original.length,
    originalEvaluator: 'planner-stem' as const,
    originalScenariosAreNotSemanticOracle: original.every((row) => row.useAsSemanticOracle === false),
    metrics: ['semantic correctness', 'schema validity', 'safety', 'clarification', 'latency', 'tokens', 'cost'],
    forbiddenPreviewReport: 'rows[].safety plus traces[].previewPayload',
    comparisonLimit: 'The 77 original scenarios have no semantic gold. Keep the stem scorer. Do not invent edge-rubric PASS/FAIL for them.',
  };
}

export async function runLiveComparison(provider: string): Promise<number> {
  loadEnv({ path: join(__dirname, '../../../../../.env') });
  if (provider === 'luna') {
    const present = Boolean(process.env.OPENAI_API_KEY?.trim());
    console.log(JSON.stringify({
      status: 'BLOCKED',
      provider: 'luna',
      model: 'gpt-6-luna',
      reason: present ? 'luna_run_not_started' : 'OPENAI_API_KEY_missing',
    }));
    return 2;
  }
  if (provider !== 'deepseek') {
    console.log(JSON.stringify({ status: 'BLOCKED', reason: 'unknown_provider', provider }));
    return 2;
  }
  if (!process.env.DEEPSEEK_API_KEY?.trim()) {
    console.log(JSON.stringify({ status: 'BLOCKED', reason: 'DEEPSEEK_API_KEY_missing', provider: 'deepseek' }));
    return 2;
  }
  const startedAt = new Date();
  const spend = newSpend(startedAt);
  const complete = createDeepSeekComplete(spend, startedAt);
  const rows: Row[] = [];
  const traces: BenchmarkTrace[] = [];
  const outDir = join(__dirname, '../../../../../../docs/voice-vnext/runs');
  mkdirSync(outDir, { recursive: true });
  const jsonl = join(outDir, 'deepseek-edge.jsonl');
  writeFileSync(jsonl, '');
  let stopped = '';
  for (const edge of EDGE_CASES) {
    for (const arm of ['legacy', 'A', 'B'] as const) {
      if (spend.calls.length >= MAX_CALLS) {
        stopped = 'call_guard';
        break;
      }
      const session = sessionFor(edge);
      try {
        const first = await runArm(edge, arm, complete, session, traces);
        const second = edge.id === 'edge-repeat-confirm' ? await runArm(edge, arm, complete, session, traces) : null;
        const ran = second
          ? {
            actual: second.actual,
            calls: first.calls + second.calls,
            inputTokens: first.inputTokens + second.inputTokens,
            outputTokens: first.outputTokens + second.outputTokens,
            latencyMs: first.latencyMs + second.latencyMs,
          }
          : first;
        const verdict = scoreCase(edge.expect, ran.actual);
        const row: Row = {
          id: edge.id,
          category: edge.category,
          arm,
          verdict,
          outcome: ran.actual.outcome,
          intentCount: ran.actual.intentCount,
          heldCount: ran.actual.heldCount,
          blocked: ran.actual.blocked,
          safety: safetyOf(edge, ran.actual),
          calls: ran.calls,
          inputTokens: ran.inputTokens,
          outputTokens: ran.outputTokens,
          latencyMs: ran.latencyMs,
        };
        rows.push(row);
        const scored = (second ?? first).trace;
        scored.evaluatorVerdict = verdict;
        scored.evaluatorReasons = [
          `verdict:${verdict}`,
          row.safety ? `safety:${row.safety}` : 'safety:none',
          `outcome:${row.outcome}`,
        ];
        if (second) {
          first.trace.evaluatorVerdict = 'not_scored';
          first.trace.evaluatorReasons = ['repeat_confirm_setup'];
        }
        appendFileSync(jsonl, `${JSON.stringify(row)}\n`);
        console.log(`${edge.id} ${arm} ${verdict} calls=${ran.calls} ms=${ran.latencyMs}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const row: Row = {
          id: edge.id,
          category: edge.category,
          arm,
          verdict: 'transport',
          outcome: 'error',
          intentCount: 0,
          heldCount: 0,
          blocked: [],
          safety: null,
          calls: 0,
          inputTokens: 0,
          outputTokens: 0,
          latencyMs: 0,
          error: message.slice(0, 300),
        };
        rows.push(row);
        const trace = [...traces].reverse().find((item) => item.scenarioId === edge.id && item.branch === arm && !item.evaluatorVerdict);
        if (trace) {
          trace.evaluatorVerdict = 'transport';
          trace.evaluatorReasons = ['llm_error'];
          if (!trace.llmCalls.length) {
            trace.llmCalls.push({
              requestMetadata: { systemChars: 0, userChars: 0 },
              rawResponse: '',
              parsedResponse: null,
              tokenUsage: { inputTokens: 0, outputTokens: 0 },
              latencyMs: 0,
              error: message.slice(0, 300),
            });
          }
        }
        appendFileSync(jsonl, `${JSON.stringify(row)}\n`);
        console.log(`${edge.id} ${arm} transport`);
      }
    }
    if (stopped) break;
  }
  let revision = 'unknown';
  try {
    revision = execSync('git rev-parse HEAD', { cwd: join(__dirname, '../../../../../../') }).toString().trim();
  } catch {
    revision = 'unknown';
  }
  const report = {
    status: stopped ? 'PARTIAL' : 'complete',
    label: 'exploratory-one-pass',
    promotion: false,
    provider: 'deepseek',
    model: 'deepseek-flash',
    settings: { temperature: 0.1, thinking: 'disabled', responseFormat: 'json_object', maxTokens: 4096 },
    price: DEEPSEEK_FLASH_PRICE,
    priceAssumption: 'cache miss when cache fields are absent; Chinese holidays are not applied',
    luna: { status: 'BLOCKED', reason: 'OPENAI_API_KEY_missing', model: 'gpt-6-luna' },
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    revision,
    promptA: PROMPT_A_HASH,
    promptB: PROMPT_B_HASH,
    fixtureVersion: FIXTURE_VERSION,
    fixtureIdsHash: createHash('sha256').update(EDGE_CASES.map((edge) => edge.id).join('\n')).digest('hex'),
    clock: '2026-10-18T06:00:00.000Z',
    timeZone: 'Europe/Kyiv',
    cases: EDGE_CASES.length,
    rowsCompleted: rows.length,
    stopped,
    spend: {
      calls: spend.calls.length,
      inputTokens: spend.inputTokens,
      outputTokens: spend.outputTokens,
      cacheHit: spend.cacheHit,
      cacheMiss: spend.cacheMiss,
      totalTokens: spend.totalTokens,
      unsplitCalls: spend.unsplitCalls,
      latencyMs: spend.latencyMs,
      usd: spend.usd,
      usdNote: spend.usdNote,
      peak: spend.peak,
    },
    arms: {
      legacy: tally(rows, 'legacy'),
      A: tally(rows, 'A'),
      B: tally(rows, 'B'),
    },
    recommendation: recommend(rows),
    forbiddenPreviews: rows.filter((row) => row.safety),
    originalComparison: {
      scenarios: originalSemanticAnnotations().length,
      evaluator: 'planner-stem',
      useAsSemanticOracle: false,
      limit: 'The original 77 scenarios have no semantic gold. This runner does not assign edge-rubric PASS/FAIL to them.',
    },
    rows,
    traces,
  };
  const file = join(outDir, 'deepseek-edge.json');
  writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    status: report.status,
    file,
    spend: report.spend,
    arms: report.arms,
    recommendation: report.recommendation,
    luna: report.luna,
  }));
  return stopped ? 2 : 0;
}
