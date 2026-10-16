/**
 * Live create-eval: run create scenarios through real parseTask.
 *
 * Usage (from backend/):
 *   npm run voice:eval:create              # full corpus via Groq (nightly CI)
 *   npm run voice:eval:create -- --local   # newest block of 50 via local LLM
 *   npm run voice:eval:create -- --local --all
 *   npm run voice:eval:create -- --local --branch=1
 *   npm run voice:eval:create -- --local --block=0
 *
 * `--branch` is a logical kind/when block: 1 recurring, 2 fixed, 3 flexible
 * preferred, 4 window, 5 day only, 6 unscheduled, or clarify.
 * `--block` is a 0-based slice of 50, or `latest`. Local runs skip earlier
 * slices unless `--all` is set. Writes backend/.tmp/voice-create-eval-report.json
 * and exits 1 on failures. Not part of default CI / npm test.
 */
import 'reflect-metadata';
import 'dotenv/config';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppModule } from '../app.module';
import { User } from '../modules/users/user.entity';
import { UserSettingsService } from '../modules/user-settings/user-settings.service';
import { GroqClient } from '../modules/voice/groq.client';
import { VoiceService } from '../modules/voice/voice.service';
import {
  CREATE_EVAL_ANCHORS,
  CREATE_EVAL_BLOCK_SIZE,
  CREATE_EVAL_SCENARIOS,
  createEvalBlockCount,
  selectCreateEvalBlock,
  type CreateEvalScenario,
} from '../modules/voice/voice-create-eval.scenarios';
import {
  matchCreateEvalScenario,
  type CreateEvalActual,
} from '../modules/voice/voice-create-eval.match';

const EVAL_EMAIL = 'voice-eval@local';
const CASE_PAUSE_MS = 300;
/** Next Groq scenario starts no earlier than this after the previous one started. */
const CASE_MIN_GAP_MS = 35_000;
const RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_WAIT_MS = 8000;

type CaseReport = {
  id: string;
  branch: CreateEvalScenario['branch'];
  transcript: string;
  ok: boolean;
  failures: string[];
  actual: CreateEvalActual | null;
  error?: string;
  dailyTokens?: boolean;
  rateLimit?: boolean;
  retryAfterMs?: number | null;
  requestedTokens?: number | null;
};

type LoopState = {
  date: string;
  retiredKeys: string[];
  passed: string[];
  bugs: { id: string; transcript: string; note: string }[];
  fixes: number;
  nextId: string | null;
  tokensExhausted: boolean;
};

async function main(): Promise<void> {
  const useLocal = process.argv.includes('--local');
  if (!useLocal && !process.env.GROQ_API_KEY?.trim()) {
    console.error(
      'GROQ_API_KEY is missing. Set it in backend/.env before running voice:eval:create.',
    );
    process.exit(1);
  }
  if (useLocal) {
    if (!process.env.LLM_BASE_URL?.trim()) {
      console.error(
        'LLM_BASE_URL is missing. Set it in backend/.env (e.g. http://127.0.0.1:11434) for --local.',
      );
      process.exit(1);
    }
    console.log(
      `Using local LLM at ${process.env.LLM_BASE_URL} model=${process.env.LLM_MODEL || 'calendar-voice'}`,
    );
  } else {
    // Force Groq for this eval. An empty value stays set so a later dotenv load
    // does not put the home Ollama URL back.
    process.env.LLM_BASE_URL = '';
    // Eval forces rotation even with one key; live API rotates when 2+ keys are set.
    process.env.GROQ_ROTATE_KEYS = '1';
    const skipped = retiredKeysForToday();
    if (skipped.length > 0) {
      process.env.GROQ_SKIP_KEY_NAMES = skipped.join(',');
    }
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const userId = await ensureEvalUser(app);
    const voice = app.get(VoiceService);
    const groq = app.get(GroqClient);
    const cases: CaseReport[] = [];
    const selection = selectScenarios(useLocal);

    const stopOnFail = process.argv.includes('--stop-on-fail');
    let scenarios = selection.scenarios;
    const fromArg = process.argv.find((a) => a.startsWith('--from='));
    if (fromArg) {
      const fromId = fromArg.slice('--from='.length).trim();
      const fromIndex = scenarios.findIndex((s) => s.id === fromId);
      if (fromIndex < 0) {
        console.error(`No scenario ${fromId}`);
        process.exit(1);
      }
      scenarios = scenarios.slice(fromIndex);
    }

    console.log(
      `voice:eval:create — ${scenarios.length} scenarios via ${useLocal ? 'local LLM' : 'Groq'} (user=${userId})${stopOnFail ? ' stop-on-fail' : ''}`,
    );

    if (!useLocal && readLoopState().tokensExhausted) {
      console.error(
        'DAY TOKENS — daily limit already reached today. Not starting another Groq run.',
      );
      process.exit(2);
    }

    let tokensExhausted = false;
    for (let i = 0; i < scenarios.length; i++) {
      const scenario = scenarios[i];
      const started = Date.now();
      let report: CaseReport | null = null;
      let reusePin = false;
      let hops = 0;
      let lapSawMinute = false;
      let lapMinMinute = Number.POSITIVE_INFINITY;

      while (true) {
        const pin = useLocal ? null : reusePin ? groq.currentPin() : groq.pinNextKey();
        reusePin = false;
        const keyLabel = pin && pin.count > 0 ? ` key ${pin.index + 1}/${pin.count}` : '';
        process.stdout.write(`[${i + 1}/${scenarios.length}] ${scenario.id}${keyLabel} … `);
        report = await runOne(voice, userId, scenario);
        if (report.ok || useLocal) break;
        const busy = report.dailyTokens || report.rateLimit;
        if (!busy) break;

        const wait = report.retryAfterMs ?? 0;
        const keyCount = pin?.count ?? 1;
        if (report.rateLimit && !report.dailyTokens) {
          lapSawMinute = true;
          if (wait > 0) lapMinMinute = Math.min(lapMinMinute, wait);
        }

        hops += 1;
        if (hops >= keyCount) {
          if (!lapSawMinute) {
            console.log(
              'DAY TOKENS — every key is on the daily limit. Stopping until tomorrow.',
            );
            tokensExhausted = true;
            break;
          }
          const pause = Math.min(
            Math.max(Number.isFinite(lapMinMinute) ? lapMinMinute : 15_000, 15_000),
            60_000,
          );
          console.log(`minute window — waiting ${Math.ceil(pause / 1000)}s`);
          await sleep(pause);
          hops = 0;
          lapSawMinute = false;
          lapMinMinute = Number.POSITIVE_INFINITY;
          continue;
        }
        console.log(
          report.dailyTokens
            ? `TPD window ${Math.ceil(wait / 1000)}s — next key`
            : 'minute window — next key',
        );
      }

      if (!report) break;
      cases.push(report);
      if (report.ok) {
        console.log('PASS');
        rememberPass(report.id, scenarioNextId(scenarios, i));
      } else if (report.dailyTokens) {
        console.log(`ERROR ${report.error}`);
      } else if (report.error) {
        console.log(`ERROR ${report.error}`);
      } else {
        console.log(`FAIL ${report.failures.join('; ')}`);
      }

      if (tokensExhausted) {
        rememberStop(scenario.id);
        break;
      }
      if (!report.ok && stopOnFail) {
        rememberStop(scenario.id);
        break;
      }

      if (i < scenarios.length - 1) {
        const wait = useLocal
          ? CASE_PAUSE_MS
          : Math.max(0, CASE_MIN_GAP_MS - (Date.now() - started));
        if (wait > 0) await sleep(wait);
      }
    }

    const passed = cases.filter((c) => c.ok).length;
    const failed = cases.length - passed;
    const outDir = join(process.cwd(), '.tmp');
    mkdirSync(outDir, { recursive: true });
    const outPath = join(outDir, 'voice-create-eval-report.json');
    const payload = {
      ranAt: new Date().toISOString(),
      anchors: CREATE_EVAL_ANCHORS,
      block: selection.block,
      summary: { total: cases.length, passed, failed },
      cases,
    };
    writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');

    console.log('');
    console.log(`Summary: ${passed} passed, ${failed} failed / ${cases.length}`);
    console.log(`Report: ${outPath}`);
    if (tokensExhausted) {
      console.log('TOKENS EXHAUSTED — every Groq key is out of daily tokens');
      markTokensExhausted();
      process.exitCode = 2;
    } else if (failed > 0) {
      console.log('Failures:');
      for (const c of cases.filter((x) => !x.ok)) {
        console.log(
          `  - ${c.id}: ${c.error || c.failures.join('; ') || 'unknown'}`,
        );
      }
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

async function runOne(
  voice: VoiceService,
  userId: string,
  scenario: CreateEvalScenario,
): Promise<CaseReport> {
  try {
    const result = await withRateLimitRetry(() =>
      voice.parseTask(userId, {
        transcript: scenario.transcript,
        timeZone: CREATE_EVAL_ANCHORS.timeZone,
        clientNowIso: CREATE_EVAL_ANCHORS.nowIso,
      }),
    );
    const match = matchCreateEvalScenario(
      scenario,
      result,
      CREATE_EVAL_ANCHORS.timeZone,
      CREATE_EVAL_ANCHORS.nowIso,
    );
    return {
      id: scenario.id,
      branch: scenario.branch,
      transcript: scenario.transcript,
      ok: match.ok,
      failures: match.failures,
      actual: match.actual,
    };
  } catch (err) {
    return {
      id: scenario.id,
      branch: scenario.branch,
      transcript: scenario.transcript,
      ok: false,
      failures: [],
      actual: null,
      error: err instanceof Error ? err.message : String(err),
      dailyTokens: isDailyTokens(err),
      rateLimit: isVoiceRateLimit(err),
      retryAfterMs: retryAfterMs(err),
      requestedTokens: requestedTokens(err),
    };
  }
}

async function withRateLimitRetry<T>(fn: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt <= RATE_LIMIT_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (attempt < RATE_LIMIT_RETRIES && isVoiceRateLimit(err) && !isDailyTokens(err)) {
        console.log(`(rate limit, wait ${RATE_LIMIT_WAIT_MS}ms)`);
        await sleep(RATE_LIMIT_WAIT_MS);
        continue;
      }
      throw err;
    }
  }
  throw last;
}

function isDailyTokens(err: unknown): boolean {
  const body = voiceErrorBody(err);
  return Boolean(body && body.daily === true);
}

function retryAfterMs(err: unknown): number | null {
  const body = voiceErrorBody(err);
  const value = body?.retryAfterMs;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function requestedTokens(err: unknown): number | null {
  const body = voiceErrorBody(err);
  const value = body?.requestedTokens;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function voiceErrorBody(
  err: unknown,
): { code?: unknown; daily?: unknown; retryAfterMs?: unknown; requestedTokens?: unknown } | null {
  if (!err || typeof err !== 'object') return null;
  const withGet = err as { getResponse?: () => unknown };
  const body = typeof withGet.getResponse === 'function' ? withGet.getResponse() : null;
  if (body && typeof body === 'object') {
    return body as {
      code?: unknown;
      daily?: unknown;
      retryAfterMs?: unknown;
      requestedTokens?: unknown;
    };
  }
  return null;
}
function isVoiceRateLimit(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const body = voiceErrorBody(err);
  if (body && 'code' in body) {
    return String(body.code) === 'VOICE_RATE_LIMIT';
  }
  const message = err instanceof Error ? err.message : String(err);
  return /rate limit|429|VOICE_RATE_LIMIT/i.test(message);
}

function loopPath(): string {
  return join(process.cwd(), '.tmp', 'voice-eval-loop.json');
}

function todayYmd(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function emptyLoopState(): LoopState {
  return {
    date: todayYmd(),
    retiredKeys: [],
    passed: [],
    bugs: [],
    fixes: 0,
    nextId: null,
    tokensExhausted: false,
  };
}

function readLoopState(): LoopState {
  const path = loopPath();
  if (!existsSync(path)) return emptyLoopState();
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as LoopState;
    if (parsed.date !== todayYmd()) {
      return {
        ...emptyLoopState(),
        passed: parsed.passed ?? [],
        bugs: parsed.bugs ?? [],
        fixes: parsed.fixes ?? 0,
        nextId: parsed.nextId ?? null,
      };
    }
    return { ...emptyLoopState(), ...parsed, date: todayYmd() };
  } catch {
    return emptyLoopState();
  }
}

function writeLoopState(state: LoopState): void {
  const path = loopPath();
  mkdirSync(join(process.cwd(), '.tmp'), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2), 'utf8');
}

function retiredKeysForToday(): string[] {
  const state = readLoopState();
  return state.date === todayYmd() ? state.retiredKeys : [];
}

function rememberPass(id: string, nextId: string | null): void {
  const state = readLoopState();
  if (!state.passed.includes(id)) state.passed.push(id);
  const onlySample = process.argv.some((arg) => arg.startsWith('--only='));
  if (nextId && !onlySample) state.nextId = nextId;
  writeLoopState(state);
}

function rememberStop(id: string): void {
  const state = readLoopState();
  const onlySample = process.argv.some((arg) => arg.startsWith('--only='));
  if (!onlySample) state.nextId = id;
  writeLoopState(state);
}

function markTokensExhausted(): void {
  const state = readLoopState();
  state.tokensExhausted = true;
  writeLoopState(state);
}

function scenarioNextId(scenarios: CreateEvalScenario[], index: number): string | null {
  return scenarios[index + 1]?.id ?? null;
}

async function ensureEvalUser(app: INestApplicationContext): Promise<string> {
  const users = app.get<Repository<User>>(getRepositoryToken(User));
  let user = await users.findOne({ where: { email: EVAL_EMAIL } });
  if (!user) {
    user = await users.save(
      users.create({
        email: EVAL_EMAIL,
        username: 'voice-eval',
        password: 'unused-eval-only',
        isEmailVerified: true,
      }),
    );
  }

  const settingsService = app.get(UserSettingsService);
  await settingsService.getSettings(user.id);
  await settingsService.updateSettings(user.id, {
    timeZone: CREATE_EVAL_ANCHORS.timeZone,
    wakeTime: CREATE_EVAL_ANCHORS.wakeTime,
    sleepTime: CREATE_EVAL_ANCHORS.sleepTime,
    defaultTaskDurationMinutes: CREATE_EVAL_ANCHORS.defaultTaskDurationMinutes,
    speechLanguage: 'uk',
    language: 'uk',
  });

  return user.id;
}

type ScenarioSelection = {
  scenarios: CreateEvalScenario[];
  /** Report field: `all`, `latest`, a 0-based slice index, or `branch:N`. */
  block: 'all' | 'latest' | number | string;
  label: string;
};

function selectScenarios(useLocal: boolean): ScenarioSelection {
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  if (onlyArg) {
    const onlyIds = new Set(
      onlyArg
        .slice('--only='.length)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
    const scenarios = CREATE_EVAL_SCENARIOS.filter((s) => onlyIds.has(s.id));
    if (scenarios.length === 0) {
      console.error(`No scenarios matched --only=${[...onlyIds].join(',')}`);
      process.exit(1);
    }
    return {
      scenarios,
      block: 'all',
      label: `${scenarios.length} scenarios (--only)`,
    };
  }

  const branchArg = process.argv.find((a) => a.startsWith('--branch='));
  if (branchArg) {
    const raw = branchArg.slice('--branch='.length).trim();
    const branch = raw === 'clarify' ? 'clarify' : Number(raw);
    const valid =
      branch === 'clarify' ||
      (typeof branch === 'number' &&
        Number.isInteger(branch) &&
        branch >= 1 &&
        branch <= 6);
    if (!valid) {
      console.error(
        `Invalid --branch=${raw}. Use 1–6 or clarify.`,
      );
      process.exit(1);
    }
    const scenarios = CREATE_EVAL_SCENARIOS.filter((s) => s.branch === branch);
    if (scenarios.length === 0) {
      console.error(`No scenarios for --branch=${raw}`);
      process.exit(1);
    }
    return {
      scenarios,
      block: `branch:${raw}`,
      label: `branch ${raw} (${scenarios.length} scenarios)`,
    };
  }

  const blockArg = process.argv.find((a) => a.startsWith('--block='));
  const runAll = !blockArg && (!useLocal || process.argv.includes('--all'));
  if (runAll) {
    return {
      scenarios: CREATE_EVAL_SCENARIOS,
      block: 'all',
      label: `${CREATE_EVAL_SCENARIOS.length} scenarios (all blocks)`,
    };
  }

  const raw = blockArg ? blockArg.slice('--block='.length) : 'latest';
  const which: number | 'latest' = raw === 'latest' ? 'latest' : Number(raw);
  if (which !== 'latest' && !Number.isInteger(which)) {
    console.error(`Invalid --block=${raw}. Use latest or a 0-based index.`);
    process.exit(1);
  }

  let scenarios: CreateEvalScenario[];
  try {
    scenarios = selectCreateEvalBlock(which);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }

  const count = createEvalBlockCount();
  const index = which === 'latest' ? count - 1 : which;
  const skipped = index * CREATE_EVAL_BLOCK_SIZE;
  return {
    scenarios,
    block: which,
    label: `block ${index + 1}/${count} (${scenarios.length} scenarios, skipped ${skipped} earlier)`,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
