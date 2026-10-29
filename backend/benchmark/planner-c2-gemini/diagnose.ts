/**
 * One Gemini call for dep-create-then-time. No retries. No tool round.
 *
 *   npx ts-node --transpile-only benchmark/planner-c2-gemini/diagnose.ts
 *     prints the call shape. No API call.
 *
 *   npx ts-node --transpile-only benchmark/planner-c2-gemini/diagnose.ts --confirm-llm
 *     one generateContent, with no client wait limit.
 *     Writes gemini-c2-diagnose-retry.json. Does not replace earlier diagnose or benchmark files.
 *
 * Production, Planner C2, fixtures, and scorers are not edited.
 */
import { createHash } from 'crypto';
import { config as loadEnv } from 'dotenv';
import { mkdirSync, writeFileSync } from 'fs';
import * as https from 'https';
import { join } from 'path';
import { buildPlannerPromptC2 } from '../../.tmp/planner-c2.prompt';
import {
  DEFAULT_GEMINI_PLANNER_MODEL,
  geminiPlannerCall,
  type GeminiPlannerPayload,
} from '../../src/modules/voice/gemini-planner';
import { BENCH_SCENARIOS } from '../voice-regression/scenarios';
import { CLOCK, userPrompt } from '../voice-regression/world';

const SCENARIO_ID = 'dep-create-then-time';
const C2_SHA256 = '6a43727a2d4f77f62a7d87d185275ae4dc647a0e0358a2dbd24012f1cfb20c88';
const OUT_FILE = join(__dirname, 'gemini-c2-diagnose-retry.json');
const PREVIOUS_BENCHMARK = join(__dirname, 'gemini-c2-run.json');
const PREVIOUS_DIAGNOSE = join(__dirname, 'gemini-c2-diagnose.json');
const PREVIOUS_WAIT = join(__dirname, 'gemini-c2-diagnose-wait.json');
function postWithoutWaitLimit(
  url: string,
  body: string,
  key: string,
): Promise<{ status: number; raw: string }> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        path: `${target.pathname}${target.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'x-goog-api-key': key,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            raw: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.setTimeout(0);
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function finishReason(payload: GeminiPlannerPayload): string | null {
  const candidate = payload.candidates?.[0] as { finishReason?: unknown } | undefined;
  return typeof candidate?.finishReason === 'string' ? candidate.finishReason : null;
}

async function main(): Promise<void> {
  if (OUT_FILE === PREVIOUS_BENCHMARK || OUT_FILE === PREVIOUS_DIAGNOSE || OUT_FILE === PREVIOUS_WAIT) {
    throw new Error('diagnose output aliases an earlier Gemini result');
  }
  loadEnv({ path: join(__dirname, '..', '..', '.env') });
  const prompt = buildPlannerPromptC2();
  if (hash(prompt) !== C2_SHA256) throw new Error('C2 hash drifted');
  if (CLOCK.nowIso !== '2026-10-18T06:00:00.000Z' || CLOCK.timeZone !== 'Europe/Kyiv') {
    throw new Error('clock drifted');
  }
  const scenario = BENCH_SCENARIOS.find((item) => item.id === SCENARIO_ID);
  if (!scenario) throw new Error(`missing ${SCENARIO_ID}`);
  const user = userPrompt({
    utterance: scenario.utterance,
    history: scenario.history,
    pendingClarification: scenario.pendingClarification,
    pendingConfirmSummary: scenario.pendingConfirmSummary,
    planDraft: null,
  });
  const model = process.env.GEMINI_PLANNER_MODEL?.trim() || DEFAULT_GEMINI_PLANNER_MODEL;
  const call = geminiPlannerCall(model, prompt, user);
  const key = process.env.GEMINI_API_KEY?.trim() || '';
  const confirm = process.argv.includes('--confirm-llm');
  console.log(JSON.stringify({
    dryRun: !confirm,
    scenarioId: SCENARIO_ID,
    utterance: scenario.utterance,
    calls: 1,
    retries: 0,
    timeoutMs: null,
    model: call.url,
    temperature: call.body.generationConfig.temperature,
    maxOutputTokens: call.body.generationConfig.maxOutputTokens,
    responseMimeType: call.body.generationConfig.responseMimeType,
    thinkingLevel: call.body.generationConfig.thinkingConfig.thinkingLevel,
    promptSha256: hash(prompt),
    keyPresent: key.length > 0,
    output: OUT_FILE,
    previousBenchmark: PREVIOUS_BENCHMARK,
    previousDiagnose: PREVIOUS_DIAGNOSE,
    command: 'npx ts-node --transpile-only benchmark/planner-c2-gemini/diagnose.ts --confirm-llm',
  }, null, 2));
  if (!confirm) return;
  if (!key) throw new Error('GEMINI_API_KEY missing');
  const started = Date.now();
  const record: {
    scenarioId: string;
    startedAt: string;
    latencyMs: number;
    status: number | null;
    error: string | null;
    finishReason: string | null;
    usage: GeminiPlannerPayload['usageMetadata'] | null;
    raw: string | null;
  } = {
    scenarioId: SCENARIO_ID,
    startedAt: new Date(started).toISOString(),
    latencyMs: 0,
    status: null,
    error: null,
    finishReason: null,
    usage: null,
    raw: null,
  };
  try {
    const response = await postWithoutWaitLimit(call.url, JSON.stringify(call.body), key);
    record.latencyMs = Date.now() - started;
    record.status = response.status;
    record.raw = response.raw;
    try {
      const payload = JSON.parse(record.raw) as GeminiPlannerPayload;
      record.usage = payload.usageMetadata ?? null;
      record.finishReason = finishReason(payload);
      const err = payload.error;
      if (typeof err === 'string' && err.trim()) record.error = err.trim();
      else if (err && typeof err === 'object' && typeof err.message === 'string') record.error = err.message.trim();
      else if (response.status < 200 || response.status >= 300) record.error = `HTTP ${response.status}`;
    } catch {
      record.error = record.error ?? 'response was not JSON';
    }
  } catch (error) {
    record.latencyMs = Date.now() - started;
    record.error = error instanceof Error ? error.message : 'fetch failed';
  }
  mkdirSync(__dirname, { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify({
    recordedAt: new Date().toISOString(),
    clock: CLOCK,
    calls: 1,
    retries: 0,
    timeoutMs: null,
    model,
    temperature: call.body.generationConfig.temperature,
    responseMimeType: call.body.generationConfig.responseMimeType,
    thinkingLevel: call.body.generationConfig.thinkingConfig.thinkingLevel,
    promptSha256: hash(prompt),
    ...record,
  }, null, 2));
  console.log(JSON.stringify({
    status: record.status,
    latencyMs: record.latencyMs,
    finishReason: record.finishReason,
    error: record.error,
    tokens: record.usage?.totalTokenCount ?? 0,
    file: OUT_FILE,
  }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'diagnose failed');
  process.exit(1);
});
