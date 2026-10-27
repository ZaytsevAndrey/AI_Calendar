/**
 * Dialogue corpus through POST /voice/turn.
 *
 *   npx ts-node --transpile-only src/scripts/eval-voice-dialogue.ts
 *   npx ts-node --transpile-only src/scripts/eval-voice-dialogue.ts --ids=create.day-only,dialogue.plan-today
 *
 * Planner is gpt-oss-120b. Pacing is per key and per model (VOICE_EVAL_PACE).
 * Stops on the first behavior mismatch. A daily token ceiling on every key exits 2.
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
import { runWithVoiceTrace, VoiceTrace, voiceTraceReport } from '../common/voice-trace';
import { dialogueEvalCase } from '../modules/voice/voice-eval-report';
import { User } from '../modules/users/user.entity';
import { UserSettingsService } from '../modules/user-settings/user-settings.service';
import { Task, TaskStatus } from '../modules/tasks/entities/task.entity';
import { TaskEventType } from '../modules/scheduling/event-type.enum';
import { VoiceService } from '../modules/voice/voice.service';
import {
  type VoiceExecutionReport,
  type VoiceTurnResponse,
  type VoiceWriteIntent,
} from '../modules/voice/voice-agent.types';
import { GroqClient, type GroqEvalSpend } from '../modules/voice/groq.client';
import { DIALOGUE_CORPUS } from '../modules/voice/dialogue-corpus';
import { VOICE_EVAL_ANCHORS, VOICE_EVAL_FIXTURES } from '../modules/voice/dialogue-corpus/fixtures';

const EVAL_EMAIL = 'voice-eval@local';

type Expect = {
  outcome: string | string[];
  kinds?: string[];
  maxIntents?: number;
  /** Create tasks must be Unscheduled. */
  unscheduled?: boolean;
  /** Substring that must appear in a create name or command taskName. */
  nameIncludes?: string;
  answer?: boolean;
  noPlan?: boolean;
  /** Planner calls required (a calendar read is a second planner round). */
  minPlannerCalls?: number;
  /** No Groq call at all. */
  noLlm?: boolean;
  /** Open day-plan stage. Apply is `build_plan` during interview. */
  planStage?: 'interview' | 'review';
  actionsInclude?: string;
  /** Each name must appear on the draft picture. */
  planNames?: string[];
  /** Each name must be absent from the draft picture. */
  planAbsent?: string[];
  /** Draft or proposal revision after an edit. */
  planRevisionMin?: number;
  /** Draft picture must not grow past this many items. */
  maxPlanItems?: number;
  /** Substrings that must not appear in the spoken reply. */
  messageExcludes?: string[];
};

type ScenarioTurn = {
  transcript?: string;
  actionId?: 'build_plan' | 'confirm' | 'cancel' | 'report';
  executionReport?: VoiceExecutionReport;
  expect: Expect;
};

type Scenario = {
  id: string;
  mode?: 'assistant' | 'fast_create';
  turns: ScenarioTurn[];
};

function expectsAct(expect: Expect): boolean {
  const outcomes = Array.isArray(expect.outcome) ? expect.outcome : [expect.outcome];
  return outcomes.includes('act');
}

/** Wall-clock samples. Same expects as the passed one-write and two-write cases. */
function intentKind(intent: VoiceWriteIntent): string {
  if (intent.type === 'create') return 'create';
  const kind = intent.command.kind;
  return typeof kind === 'string' ? kind : 'unknown';
}

function intentName(intent: VoiceWriteIntent): string {
  if (intent.type === 'create') return String(intent.task.name ?? '');
  return String(intent.command.taskName ?? intent.command.name ?? '');
}

function matchTurn(
  expect: Expect,
  response: VoiceTurnResponse,
  calls: GroqEvalSpend[],
): string[] {
  const failures: string[] = [];
  const kinds = response.intents.map(intentKind);
  const outcomes = Array.isArray(expect.outcome) ? expect.outcome : [expect.outcome];
  if (!outcomes.includes(response.outcome)) {
    failures.push(`outcome ${response.outcome} ∉ ${outcomes.join('|')}`);
  }
  if (expect.kinds) {
    const left = [...kinds];
    for (const kind of expect.kinds) {
      const accepted = kind.split('|');
      const index = left.findIndex((actual) => accepted.includes(actual));
      if (index < 0) failures.push(`missing ${kind} in [${kinds.join(', ')}]`);
      else left.splice(index, 1);
    }
  }
  if (expect.maxIntents != null && kinds.length > expect.maxIntents) {
    failures.push(`intents ${kinds.length} > ${expect.maxIntents}`);
  }
  if (expect.unscheduled) {
    const creates = response.intents.filter((intent) => intent.type === 'create');
    if (creates.some((intent) => intent.task.isUnscheduled !== true)) {
      failures.push('create is not unscheduled');
    }
  }
  if (expect.nameIncludes) {
    const needle = expect.nameIncludes.toLowerCase();
    const names = response.intents.map((intent) => `${intentName(intent)} ${JSON.stringify(intent)}`);
    if (!names.some((name) => name.toLowerCase().includes(needle))) {
      failures.push(`name lacks ${expect.nameIncludes} in [${response.intents.map(intentName).join(', ')}]`);
    }
  }
  if (expect.answer && !response.assistantMessage.trim()) failures.push('empty answer');
  if (expect.noPlan && response.plan) failures.push(`opened a plan (${response.plan.stage})`);
  if (expect.planStage && response.plan?.stage !== expect.planStage) {
    failures.push(`plan stage ${response.plan?.stage ?? 'none'} ≠ ${expect.planStage}`);
  }
  if (expect.actionsInclude && !response.actions.some((action) => action === expect.actionsInclude)) {
    failures.push(`actions lack ${expect.actionsInclude}`);
  }
  if (expect.planNames) {
    const pictured = [
      ...(response.plan?.items ?? []).map((item) => item.name),
      ...(response.plan?.unplaced ?? []).map((item) => item.name),
    ];
    for (const name of expect.planNames) {
      if (!pictured.some((picturedName) => picturedName.toLowerCase().includes(name.toLowerCase()))) {
        failures.push(`plan lacks ${name} in [${pictured.join(', ')}]`);
      }
    }
  }
  if (expect.planAbsent) {
    const pictured = [
      ...(response.plan?.items ?? []).map((item) => item.name),
      ...(response.plan?.unplaced ?? []).map((item) => item.name),
    ];
    for (const name of expect.planAbsent) {
      if (pictured.some((picturedName) => picturedName.toLowerCase().includes(name.toLowerCase()))) {
        failures.push(`plan still has ${name}`);
      }
    }
  }
  if (expect.planRevisionMin != null && (response.plan?.revision ?? 0) < expect.planRevisionMin) {
    failures.push(`plan revision ${response.plan?.revision ?? 0} < ${expect.planRevisionMin}`);
  }
  if (expect.maxPlanItems != null) {
    const pictured = (response.plan?.items.length ?? 0) + (response.plan?.unplaced.length ?? 0);
    if (pictured > expect.maxPlanItems) {
      failures.push(`plan items ${pictured} > ${expect.maxPlanItems}`);
    }
  }
  if (expect.messageExcludes) {
    const message = response.assistantMessage.toLowerCase();
    for (const piece of expect.messageExcludes) {
      if (message.includes(piece.toLowerCase())) {
        failures.push(`reply mentions ${piece}`);
      }
    }
  }
  if (expect.noLlm && calls.length > 0) failures.push(`LLM calls ${calls.length}`);
  if (expect.minPlannerCalls != null) {
    const planners = calls.filter((call) => call.role === 'planner').length;
    if (planners < expect.minPlannerCalls) {
      failures.push(`planner calls ${planners} < ${expect.minPlannerCalls}`);
    }
  }
  return failures;
}

function selectScenarios(): Scenario[] {
  const pool: Scenario[] = [...DIALOGUE_CORPUS];
  const idsArg = process.argv.find((arg) => arg.startsWith('--ids='));
  if (!idsArg) return pool;
  const ids = new Set(idsArg.slice('--ids='.length).split(',').map((id) => id.trim()));
  const picked = pool.filter((scenario) => ids.has(scenario.id));
  if (!picked.length) throw new Error(`No scenarios for --ids=${idsArg}`);
  return picked;
}

function isDailyLimit(message: string): boolean {
  return /tokens per day|\bTPD\b/i.test(message);
}

function errorText(err: unknown): string {
  if (
    err &&
    typeof err === 'object' &&
    'getResponse' in err &&
    typeof (err as { getResponse?: () => unknown }).getResponse === 'function'
  ) {
    const body = (err as { getResponse: () => unknown }).getResponse();
    const rendered = typeof body === 'string' ? body : JSON.stringify(body);
    const message = err instanceof Error ? err.message : '';
    return `${message} ${rendered}`;
  }
  return err instanceof Error ? err.message : String(err);
}

async function main(): Promise<void> {
  if (!process.env.GROQ_API_KEY?.trim()) {
    console.error('GROQ_API_KEY missing.');
    process.exit(1);
  }
  delete process.env.LLM_BASE_URL;
  process.env.VOICE_DAILY_TOKEN_LIMIT = '0';
  process.env.VOICE_EVAL_PACE = '1';
  process.env.GROQ_PLANNER_MODEL = 'openai/gpt-oss-120b';
  const minutes = Number(
    process.argv.find((arg) => arg.startsWith('--minutes='))?.slice('--minutes='.length) || 0,
  );
  const deepseekAll = process.argv.includes('--deepseek') || minutes > 0;
  if (deepseekAll) process.env.VOICE_LLM_PROVIDER = 'deepseek';
  const deadline = minutes > 0 ? Date.now() + minutes * 60_000 : 0;
  const plannerLabel = process.env.DEEPSEEK_API_KEY?.trim()
    ? process.env.DEEPSEEK_PLANNER_MODEL?.trim() || 'deepseek-flash'
    : process.env.QWEN_API_KEY?.trim()
      ? process.env.QWEN_PLANNER_MODEL?.trim() || 'qwen3.7-flash'
      : process.env.GEMINI_API_KEY?.trim()
        ? process.env.GEMINI_PLANNER_MODEL?.trim() || 'gemini-3.8-flash'
        : 'openai/gpt-oss-120b';

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const cases: Array<Record<string, unknown>> = [];
  try {
    const userId = await ensureEvalUser(app);
    await seedFixtures(app, userId);
    const voice = app.get(VoiceService);
    const groq = app.get(GroqClient);
    const settings = app.get(UserSettingsService);
    await settings.updateSettings(userId, { speechLanguage: 'uk', language: 'uk' });
    const retriedTpm = new Set<string>();
    const scenarios = selectScenarios();
    const poolLabel = minutes > 0 ? 'marathon' : 'corpus';
    console.log(
      `voice:eval:dialogue — ${scenarios.length} ${poolLabel} scenarios, llm=${deepseekAll ? plannerLabel : plannerLabel + ' parse=groq'}, liveKeys=${groq.liveKeyCount()}`,
    );
    const runStarted = Date.now();
    let scenariosPassed = 0;
    for (let i = 0; i < scenarios.length; i += 1) {
      if (deadline && Date.now() >= deadline) {
        console.log('TIME_BOX');
        break;
      }
      const scenario = scenarios[i];
      process.stdout.write(`[${i + 1}/${scenarios.length}] ${scenario.id} … `);
      const sessionId = `dialogue-${scenario.id}-${randomUUID()}`;
      const createdIds: string[] = [];
      let failed = false;
      const scenarioStarted = Date.now();
      let turnTrace: VoiceTrace | undefined;
      try {
        for (let turnIndex = 0; turnIndex < scenario.turns.length; turnIndex += 1) {
          const turn = scenario.turns[turnIndex];
          const before = groq.evalSpends().length;
          const turnStarted = Date.now();
          turnTrace = new VoiceTrace();
          const response = await runWithVoiceTrace(turnTrace, () =>
            voice.turn(userId, {
              sessionId,
              transcript: turn.transcript,
              actionId: turn.actionId,
              executionReport: turn.executionReport,
              timeZone: VOICE_EVAL_ANCHORS.timeZone,
              clientNowIso: VOICE_EVAL_ANCHORS.nowIso,
              mode: scenario.mode,
            }),
          );
          const calls = groq.evalSpends().slice(before);
          const failures = matchTurn(turn.expect, response, calls);
          const traced = voiceTraceReport(turnTrace);
          const row = dialogueEvalCase({
            id: scenario.turns.length > 1 ? `${scenario.id}.${turnIndex + 1}` : scenario.id,
            failures,
            outcome: response.outcome,
            kinds: response.intents.map(intentKind),
            names: response.intents.map(intentName),
            plan: response.plan?.stage ?? null,
            message: response.assistantMessage,
            ms: Date.now() - turnStarted,
            calls: calls.map((call) => ({
              label: call.label,
              model: call.model,
              tokens: call.tokens,
              keyIndex: call.keyIndex,
            })),
            traceId: traced.traceId,
            steps: traced.steps,
          });
          cases.push(row);
          if (!row.ok) {
            console.log(`FAIL t${turnIndex + 1} ${failures.join('; ')}`);
            failed = true;
            break;
          }
          if (turnIndex < scenario.turns.length - 1) {
            const next = scenario.turns[turnIndex + 1];
            const nextRunsPending = expectsAct(next.expect);
            if (response.outcome === 'confirm' && response.intents.length && !nextRunsPending) {
              const applied = await voice.turn(userId, {
                sessionId,
                actionId: 'confirm',
                timeZone: VOICE_EVAL_ANCHORS.timeZone,
                clientNowIso: VOICE_EVAL_ANCHORS.nowIso,
              });
              createdIds.push(...(await applyActCreates(app, userId, applied)));
            } else if (response.outcome === 'act') {
              createdIds.push(...(await applyActCreates(app, userId, response)));
            }
          }
        }
        const seconds = ((Date.now() - scenarioStarted) / 1000).toFixed(1);
        if (!failed) {
          scenariosPassed += 1;
          console.log(`PASS ${seconds}s`);
        } else {
          console.log(`  ${seconds}s`);
        }
      } catch (err) {
        const message = errorText(err);
        const minuteLimit = /tokens per minute|\bTPM\b|rate limit|429/i.test(message) && !isDailyLimit(message);
        if (minuteLimit && !retriedTpm.has(scenario.id)) {
          retriedTpm.add(scenario.id);
          const wait = Number(message.match(/retryAfterMs":(\d+)/)?.[1] ?? 4000) + 500;
          console.log(`minute limit, retry ${scenario.id} in ${wait}ms`);
          await new Promise((resolve) => setTimeout(resolve, wait));
          i -= 1;
          continue;
        }
        const traced = turnTrace ? voiceTraceReport(turnTrace) : undefined;
        cases.push({
          id: scenario.id,
          ok: false,
          error: message,
          ...(traced ? { traceId: traced.traceId, steps: traced.steps } : {}),
        });
        console.log(`ERROR ${message}`);
        const hardLimit = /insufficient|balance|quota|billing|unauthorized|invalid api key/i.test(message);
        if ((isDailyLimit(message) && groq.liveKeyCount() === 0) || hardLimit || minuteLimit) {
          console.log('STOP_LIMIT provider limit');
          process.exitCode = 2;
        } else if (!deadline) {
          process.exitCode = 1;
        }
        break;
      } finally {
        if (createdIds.length) {
          const tasks = app.get<Repository<Task>>(getRepositoryToken(Task));
          await tasks.delete(createdIds);
        }
        voice.endVoiceSession(userId, sessionId);
      }
      if (failed && !deadline) break;
    }
    console.log(
      `Scenarios passed: ${scenariosPassed} in ${((Date.now() - runStarted) / 1000).toFixed(0)}s (pool ${scenarios.length}${minutes > 0 ? `, box ${minutes}m` : ''})`,
    );
  } finally {
    const outDir = join(process.cwd(), '.tmp');
    mkdirSync(outDir, { recursive: true });
    const outPath = join(outDir, 'voice-dialogue-eval-report.json');
    writeFileSync(
      outPath,
      JSON.stringify({ ranAt: new Date().toISOString(), cases }, null, 2),
      'utf8',
    );
    const passed = cases.filter((row) => row.ok).length;
    console.log('');
    console.log(`Summary: ${passed} passed, ${cases.length - passed} failed / ${cases.length}`);
    console.log(`Report: ${outPath}`);
    const failed = cases.some((row) => row.ok === false);
    if (failed && process.exitCode == null && !deadline) process.exitCode = 1;
    await app.close();
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
    timeZone: VOICE_EVAL_ANCHORS.timeZone,
    wakeTime: VOICE_EVAL_ANCHORS.wakeTime,
    sleepTime: VOICE_EVAL_ANCHORS.sleepTime,
    confirmVoiceCommands: false,
  });
  return user.id;
}

/** An `act` create is on the calendar before the next utterance, same as the app. */
async function applyActCreates(
  app: INestApplicationContext,
  userId: string,
  response: VoiceTurnResponse,
): Promise<string[]> {
  const tasks = app.get<Repository<Task>>(getRepositoryToken(Task));
  const ids: string[] = [];
  for (const intent of response.intents) {
    if (intent.type !== 'create') continue;
    const name = String(intent.task.name ?? '').trim();
    if (!name) continue;
    const minutes = intent.task.estimatedTimeInMinutes;
    const saved = await tasks.save(
      tasks.create({
        userId,
        name,
        status: TaskStatus.TODO,
        isRecurring: Boolean(intent.task.isRecurring),
        estimatedTimeInMinutes: typeof minutes === 'number' && minutes >= 5 ? minutes : 30,
        eventType: TaskEventType.ADMIN,
        isUnscheduled: intent.task.isUnscheduled !== false,
      }),
    );
    ids.push(saved.id);
  }
  return ids;
}

async function seedFixtures(app: INestApplicationContext, userId: string): Promise<void> {
  const tasks = app.get<Repository<Task>>(getRepositoryToken(Task));
  const legacy = await tasks.findOne({ where: { userId, name: 'Молоко' } });
  if (legacy) await tasks.remove(legacy);
  for (const fixture of VOICE_EVAL_FIXTURES.tasks) {
    const existing = await tasks.findOne({ where: { userId, name: fixture.name } });
    if (existing) {
      let changed = false;
      if (existing.status !== TaskStatus.TODO) {
        existing.status = TaskStatus.TODO;
        changed = true;
      }
      if (fixture.isRecurring && existing.isUnscheduled) {
        existing.isUnscheduled = false;
        changed = true;
      }
      if (changed) await tasks.save(existing);
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
        isUnscheduled: !fixture.isRecurring,
      }),
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
