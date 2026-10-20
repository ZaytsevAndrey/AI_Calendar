/**
 * Companion agent eval: multi-intent utterances and the day-plan dialogue (`/voice/turn`).
 *
 *   npm run voice:eval:multi
 *   npm run voice:eval:multi -- --ids=mi01,dp05
 *   npm run voice:eval:multi -- --from=qa01 --stop-on-fail
 *   npm run voice:eval:multi -- --planner-model=openai/gpt-oss-120b
 *
 * (`--ids`, not `--only`: npm treats `--only` as its own config flag.)
 *
 * The planner role is pinned to the parse model (gpt-oss-20b) unless --planner-model is passed,
 * so eval rotation never falls back to 120b. The app's per-user daily voice quota is off here.
 * From PowerShell call ts-node directly (`npx ts-node src/scripts/eval-voice-multi-intent.ts --ids=…`):
 * PowerShell drops the bare `--` that npm needs to forward flags.
 */
import 'reflect-metadata';
import 'dotenv/config';
import { randomUUID } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppModule } from '../app.module';
import { User } from '../modules/users/user.entity';
import { UserSettingsService } from '../modules/user-settings/user-settings.service';
import { Task, TaskStatus } from '../modules/tasks/entities/task.entity';
import { TaskEventType } from '../modules/scheduling/event-type.enum';
import { VoiceService } from '../modules/voice/voice.service';
import { INTENT_EVAL_FIXTURES } from '../modules/voice/voice-intent-eval.scenarios';
import {
  matchMultiIntentTurn,
  MULTI_INTENT_EVAL_ANCHORS,
  MULTI_INTENT_EVAL_SCENARIOS,
  type MultiIntentEvalScenario,
  type MultiIntentTurnMatch,
} from '../modules/voice/voice-multi-intent-eval.scenarios';

const EVAL_EMAIL = 'voice-eval@local';
const CASE_PAUSE_MS = 35_000;

type CaseReport = {
  id: string;
  ok: boolean;
  turns: Array<{ input: string; match: MultiIntentTurnMatch | null; error?: string }>;
};

async function main(): Promise<void> {
  if (!process.env.GROQ_API_KEY?.trim()) {
    console.error('GROQ_API_KEY missing.');
    process.exit(1);
  }
  delete process.env.LLM_BASE_URL;
  process.env.VOICE_DAILY_TOKEN_LIMIT = '0';
  const plannerArg = process.argv.find((a) => a.startsWith('--planner-model='));
  process.env.GROQ_PLANNER_MODEL = plannerArg
    ? plannerArg.slice('--planner-model='.length)
    : process.env.GROQ_LLM_MODEL?.trim() || 'openai/gpt-oss-20b';

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const userId = await ensureEvalUser(app);
    await seedFixtures(app, userId);
    const voice = app.get(VoiceService);
    const settings = app.get(UserSettingsService);
    const scenarios = selectScenarios();
    const stopOnFail = process.argv.includes('--stop-on-fail');
    const cases: CaseReport[] = [];

    console.log(
      `voice:eval:multi — ${scenarios.length} scenarios, planner=${
        process.env.GEMINI_API_KEY?.trim()
          ? process.env.GEMINI_PLANNER_MODEL?.trim() || 'gemini-3.8-flash'
          : process.env.GROQ_PLANNER_MODEL
      }`,
    );
    for (let i = 0; i < scenarios.length; i++) {
      const scenario = scenarios[i];
      process.stdout.write(`[${i + 1}/${scenarios.length}] ${scenario.id} … `);
      await settings.updateSettings(userId, {
        speechLanguage: scenario.language,
        language: scenario.language,
      });
      const report = await runOne(voice, userId, scenario);
      cases.push(report);
      if (report.ok) {
        console.log('PASS');
      } else {
        const bad = report.turns.find((turn) => turn.error || !turn.match?.ok);
        console.log(`FAIL ${bad?.error || bad?.match?.failures.join('; ')}`);
      }
      if (stopOnFail && !report.ok) break;
      if (i < scenarios.length - 1) await sleep(CASE_PAUSE_MS);
    }

    const passed = cases.filter((c) => c.ok).length;
    const outDir = join(process.cwd(), '.tmp');
    mkdirSync(outDir, { recursive: true });
    const outPath = join(outDir, 'voice-multi-intent-eval-report.json');
    writeFileSync(
      outPath,
      JSON.stringify(
        {
          ranAt: new Date().toISOString(),
          anchors: MULTI_INTENT_EVAL_ANCHORS,
          plannerModel: process.env.GROQ_PLANNER_MODEL,
          summary: { total: cases.length, passed, failed: cases.length - passed },
          cases,
        },
        null,
        2,
      ),
      'utf8',
    );
    console.log('');
    console.log(`Summary: ${passed} passed, ${cases.length - passed} failed / ${cases.length}`);
    console.log(`Report: ${outPath}`);
    if (passed < cases.length) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

async function runOne(
  voice: VoiceService,
  userId: string,
  scenario: MultiIntentEvalScenario,
): Promise<CaseReport> {
  const sessionId = `eval-${scenario.id}-${randomUUID()}`;
  const turns: CaseReport['turns'] = [];
  try {
    for (const turn of scenario.turns) {
      const input = 'transcript' in turn ? turn.transcript : `[${turn.actionId}]`;
      try {
        const response = await voice.turn(userId, {
          sessionId,
          transcript: 'transcript' in turn ? turn.transcript : undefined,
          actionId: 'actionId' in turn ? turn.actionId : undefined,
          timeZone: MULTI_INTENT_EVAL_ANCHORS.timeZone,
          clientNowIso: MULTI_INTENT_EVAL_ANCHORS.nowIso,
        });
        const match = matchMultiIntentTurn(turn.expect, response);
        turns.push({ input, match });
        if (!match.ok) break;
      } catch (err) {
        turns.push({ input, match: null, error: err instanceof Error ? err.message : String(err) });
        break;
      }
    }
  } finally {
    voice.endVoiceSession(userId, sessionId);
  }
  const ok =
    turns.length === scenario.turns.length && turns.every((turn) => !turn.error && turn.match?.ok);
  return { id: scenario.id, ok, turns };
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
    timeZone: MULTI_INTENT_EVAL_ANCHORS.timeZone,
    wakeTime: MULTI_INTENT_EVAL_ANCHORS.wakeTime,
    sleepTime: MULTI_INTENT_EVAL_ANCHORS.sleepTime,
    confirmVoiceCommands: false,
  });
  return user.id;
}

async function seedFixtures(app: INestApplicationContext, userId: string): Promise<void> {
  const tasks = app.get<Repository<Task>>(getRepositoryToken(Task));
  for (const fixture of INTENT_EVAL_FIXTURES.tasks) {
    const existing = await tasks.findOne({ where: { userId, name: fixture.name } });
    if (existing) {
      if (existing.status !== TaskStatus.TODO) {
        existing.status = TaskStatus.TODO;
        await tasks.save(existing);
      }
      continue;
    }
    await tasks.save(
      tasks.create({
        userId,
        name: fixture.name,
        status: TaskStatus.TODO,
        isRecurring: fixture.isRecurring,
        estimatedTimeInMinutes: 30,
        eventType: TaskEventType.ADMIN,
        isUnscheduled: true,
      }),
    );
  }
}

function selectScenarios(): MultiIntentEvalScenario[] {
  const idsArg = process.argv.find((a) => a.startsWith('--ids='));
  if (idsArg) {
    const ids = new Set(idsArg.slice('--ids='.length).split(',').map((s) => s.trim()));
    return MULTI_INTENT_EVAL_SCENARIOS.filter((s) => ids.has(s.id));
  }
  const fromArg = process.argv.find((a) => a.startsWith('--from='));
  if (fromArg) {
    const fromId = fromArg.slice('--from='.length).trim();
    const start = MULTI_INTENT_EVAL_SCENARIOS.findIndex((s) => s.id === fromId);
    if (start < 0) throw new Error(`Unknown --from=${fromId}`);
    return MULTI_INTENT_EVAL_SCENARIOS.slice(start);
  }
  return [...MULTI_INTENT_EVAL_SCENARIOS];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
