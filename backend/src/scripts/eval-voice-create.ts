/**
 * Live create-eval: run create scenarios through real parseTask.
 *
 * Usage (from backend/):
 *   npm run voice:eval:create              # full corpus via Groq (nightly CI)
 *   npm run voice:eval:create -- --local   # newest block of 50 via local LLM
 *   npm run voice:eval:create -- --local --all
 *   npm run voice:eval:create -- --local --block=0
 *
 * `--block` is 0-based, or `latest`. Local runs skip earlier blocks unless
 * `--all` is set. Writes backend/.tmp/voice-create-eval-report.json and
 * exits 1 on failures. Not part of default CI / npm test.
 */
import 'reflect-metadata';
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppModule } from '../app.module';
import { User } from '../modules/users/user.entity';
import { UserSettingsService } from '../modules/user-settings/user-settings.service';
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
const CASE_PAUSE_MS = process.argv.includes('--local') ? 300 : 2000;
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
    // Force Groq for this eval (home Ollama must not shadow chat).
    delete process.env.LLM_BASE_URL;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const userId = await ensureEvalUser(app);
    const voice = app.get(VoiceService);
    const cases: CaseReport[] = [];
    const selection = selectScenarios(useLocal);

    console.log(
      `voice:eval:create — ${selection.label} via ${useLocal ? 'local LLM' : 'Groq'} (user=${userId})`,
    );

    const scenarios = selection.scenarios;
    for (let i = 0; i < scenarios.length; i++) {
      const scenario = scenarios[i];
      const label = `[${i + 1}/${scenarios.length}] ${scenario.id}`;
      process.stdout.write(`${label} … `);

      const report = await runOne(voice, userId, scenario);
      cases.push(report);
      if (report.ok) {
        console.log('PASS');
      } else if (report.error) {
        console.log(`ERROR ${report.error}`);
      } else {
        console.log(`FAIL ${report.failures.join('; ')}`);
      }

      if (i < scenarios.length - 1) {
        await sleep(CASE_PAUSE_MS);
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
    if (failed > 0) {
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
      if (attempt < RATE_LIMIT_RETRIES && isVoiceRateLimit(err)) {
        console.log(`(rate limit, wait ${RATE_LIMIT_WAIT_MS}ms)`);
        await sleep(RATE_LIMIT_WAIT_MS);
        continue;
      }
      throw err;
    }
  }
  throw last;
}

function isVoiceRateLimit(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const withGet = err as { getResponse?: () => unknown };
  const body = typeof withGet.getResponse === 'function' ? withGet.getResponse() : null;
  if (body && typeof body === 'object' && 'code' in body) {
    return String((body as { code: unknown }).code) === 'VOICE_RATE_LIMIT';
  }
  const message = err instanceof Error ? err.message : String(err);
  return /rate limit|429|VOICE_RATE_LIMIT/i.test(message);
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
  /** Report field: `all`, `latest`, or a 0-based block index. */
  block: 'all' | 'latest' | number;
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
