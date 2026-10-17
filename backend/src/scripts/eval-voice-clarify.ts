/**
 * Clarify-continue eval (previous + answer).
 *
 *   npm run voice:eval:clarify -- --local
 *   npm run voice:eval:clarify -- --local --all
 *   npm run voice:eval:clarify -- --local --block=0
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
import {
  Task,
  TaskStatus,
} from '../modules/tasks/entities/task.entity';
import { TaskEventType } from '../modules/scheduling/event-type.enum';
import { Habit } from '../modules/habits/entities/habit.entity';
import { VoiceService } from '../modules/voice/voice.service';
import {
  CLARIFY_EVAL_ANCHORS,
  CLARIFY_EVAL_BLOCK_SIZE,
  CLARIFY_EVAL_SCENARIOS,
  clarifyEvalBlockCount,
  selectClarifyEvalBlock,
  type ClarifyEvalScenario,
} from '../modules/voice/voice-clarify-eval.scenarios';
import { matchClarifyEvalScenario } from '../modules/voice/voice-clarify-eval.match';
import { INTENT_EVAL_FIXTURES } from '../modules/voice/voice-intent-eval.scenarios';

const EVAL_EMAIL = 'voice-eval@local';
const CASE_PAUSE_MS = process.argv.includes('--local') ? 300 : 35_000;

type CaseReport = {
  id: string;
  previousTranscript: string;
  answer: string;
  ok: boolean;
  failures: string[];
  actual: ReturnType<typeof matchClarifyEvalScenario>['actual'] | null;
  error?: string;
};

async function main(): Promise<void> {
  const useLocal = process.argv.includes('--local');
  if (!useLocal && !process.env.GROQ_API_KEY?.trim()) {
    console.error('GROQ_API_KEY missing (or pass --local).');
    process.exit(1);
  }
  if (useLocal) {
    if (!process.env.LLM_BASE_URL?.trim()) {
      console.error('LLM_BASE_URL missing for --local.');
      process.exit(1);
    }
    console.log(
      `Using local LLM at ${process.env.LLM_BASE_URL} model=${process.env.LLM_MODEL || 'calendar-voice'}`,
    );
  } else {
    delete process.env.LLM_BASE_URL;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const userId = await ensureEvalUser(app);
    await seedFixtures(app, userId);
    const voice = app.get(VoiceService);
    const selection = selectScenarios(useLocal);
    const cases: CaseReport[] = [];

    console.log(
      `voice:eval:clarify — ${selection.label} via ${useLocal ? 'local LLM' : 'Groq'}`,
    );

    const stopOnFail = process.argv.includes('--stop-on-fail');
    for (let i = 0; i < selection.scenarios.length; i++) {
      const scenario = selection.scenarios[i];
      process.stdout.write(
        `[${i + 1}/${selection.scenarios.length}] ${scenario.id} … `,
      );
      const report = await runOne(voice, userId, scenario);
      cases.push(report);
      if (report.ok) console.log('PASS');
      else if (report.error) console.log(`ERROR ${report.error}`);
      else console.log(`FAIL ${report.failures.join('; ')}`);
      if (stopOnFail && !report.ok) break;
      if (i < selection.scenarios.length - 1) await sleep(CASE_PAUSE_MS);
    }

    const passed = cases.filter((c) => c.ok).length;
    const failed = cases.length - passed;
    const outDir = join(process.cwd(), '.tmp');
    mkdirSync(outDir, { recursive: true });
    const outPath = join(outDir, 'voice-clarify-eval-report.json');
    writeFileSync(
      outPath,
      JSON.stringify(
        {
          ranAt: new Date().toISOString(),
          anchors: CLARIFY_EVAL_ANCHORS,
          block: selection.block,
          summary: { total: cases.length, passed, failed },
          cases,
        },
        null,
        2,
      ),
      'utf8',
    );
    console.log('');
    console.log(`Summary: ${passed} passed, ${failed} failed / ${cases.length}`);
    console.log(`Report: ${outPath}`);
    if (failed > 0) {
      for (const c of cases.filter((x) => !x.ok)) {
        console.log(`  - ${c.id}: ${c.error || c.failures.join('; ')}`);
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
  scenario: ClarifyEvalScenario,
): Promise<CaseReport> {
  try {
    const result = await voice.parseTask(userId, {
      transcript: scenario.answer,
      previousTranscript: scenario.previousTranscript,
      clarificationAnswer: scenario.answer,
      timeZone: CLARIFY_EVAL_ANCHORS.timeZone,
      clientNowIso: CLARIFY_EVAL_ANCHORS.nowIso,
    });
    const match = matchClarifyEvalScenario(scenario, result);
    return {
      id: scenario.id,
      previousTranscript: scenario.previousTranscript,
      answer: scenario.answer,
      ok: match.ok,
      failures: match.failures,
      actual: match.actual,
    };
  } catch (err) {
    return {
      id: scenario.id,
      previousTranscript: scenario.previousTranscript,
      answer: scenario.answer,
      ok: false,
      failures: [],
      actual: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
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
    timeZone: CLARIFY_EVAL_ANCHORS.timeZone,
    wakeTime: CLARIFY_EVAL_ANCHORS.wakeTime,
    sleepTime: CLARIFY_EVAL_ANCHORS.sleepTime,
    defaultTaskDurationMinutes:
      CLARIFY_EVAL_ANCHORS.defaultTaskDurationMinutes,
    speechLanguage: 'uk',
    language: 'uk',
  });
  return user.id;
}

async function seedFixtures(
  app: INestApplicationContext,
  userId: string,
): Promise<void> {
  const tasks = app.get<Repository<Task>>(getRepositoryToken(Task));
  const habits = app.get<Repository<Habit>>(getRepositoryToken(Habit));
  for (const fixture of INTENT_EVAL_FIXTURES.tasks) {
    const existing = await tasks.findOne({
      where: { userId, name: fixture.name },
    });
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
  for (const fixture of INTENT_EVAL_FIXTURES.habits) {
    const existing = await habits.findOne({
      where: { userId, name: fixture.name },
    });
    if (existing) continue;
    await habits.save(
      habits.create({
        userId,
        name: fixture.name,
        color: '#3b82f6',
        description: null,
        blockStartTime: null,
        blockMinutes: null,
      }),
    );
  }
}

function selectScenarios(useLocal: boolean): {
  scenarios: ClarifyEvalScenario[];
  block: 'all' | 'latest' | number;
  label: string;
} {
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  if (onlyArg) {
    const ids = new Set(
      onlyArg
        .slice('--only='.length)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
    return {
      scenarios: CLARIFY_EVAL_SCENARIOS.filter((s) => ids.has(s.id)),
      block: 'all',
      label: `filtered (--only)`,
    };
  }
  const fromArg = process.argv.find((a) => a.startsWith('--from='));
  if (fromArg) {
    const fromId = fromArg.slice('--from='.length).trim();
    const start = CLARIFY_EVAL_SCENARIOS.findIndex((s) => s.id === fromId);
    if (start < 0) {
      throw new Error(`Unknown --from=${fromId}`);
    }
    const scenarios = CLARIFY_EVAL_SCENARIOS.slice(start);
    return {
      scenarios,
      block: 'all',
      label: `${scenarios.length} scenarios (from ${fromId})`,
    };
  }
  const blockArg = process.argv.find((a) => a.startsWith('--block='));
  const runAll = !blockArg && (!useLocal || process.argv.includes('--all'));
  if (runAll) {
    return {
      scenarios: [...CLARIFY_EVAL_SCENARIOS],
      block: 'all',
      label: `${CLARIFY_EVAL_SCENARIOS.length} scenarios (all)`,
    };
  }
  const raw = blockArg ? blockArg.slice('--block='.length) : 'latest';
  const which: number | 'latest' = raw === 'latest' ? 'latest' : Number(raw);
  const scenarios = selectClarifyEvalBlock(which);
  const count = clarifyEvalBlockCount();
  const index = which === 'latest' ? count - 1 : which;
  return {
    scenarios,
    block: which,
    label: `block ${index + 1}/${count} (${scenarios.length}, size ${CLARIFY_EVAL_BLOCK_SIZE})`,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
