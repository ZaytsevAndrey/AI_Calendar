/**
 * Simple dialogue flows through POST /voice/turn.
 *
 *   npx ts-node --transpile-only src/scripts/eval-voice-dialogue.ts
 *   npx ts-node --transpile-only src/scripts/eval-voice-dialogue.ts --ids=S1,S4
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
import { INTENT_EVAL_FIXTURES } from '../modules/voice/voice-intent-eval.scenarios';
import { MULTI_INTENT_EVAL_ANCHORS } from '../modules/voice/voice-multi-intent-eval.scenarios';
import { BULK } from './eval-voice-dialogue.bulk';

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
  turns: ScenarioTurn[];
};

function one(transcript: string, expect: Expect): ScenarioTurn[] {
  return [{ transcript, expect }];
}

function expectsAct(expect: Expect): boolean {
  const outcomes = Array.isArray(expect.outcome) ? expect.outcome : [expect.outcome];
  return outcomes.includes('act');
}

/** Wall-clock samples. Same expects as the passed one-write and two-write cases. */
const TIMED: Scenario[] = [
  {
    id: 'T1',
    turns: one('треба купити хліб', {
      outcome: 'confirm',
      kinds: ['create'],
      maxIntents: 1,
      unscheduled: true,
      nameIncludes: 'хліб',
    }),
  },
  {
    id: 'T2',
    turns: one('купи хліб і запиши подзвонити мамі', {
      outcome: 'confirm',
      kinds: ['create', 'create'],
      maxIntents: 2,
    }),
  },
];

const SCENARIOS: Scenario[] = [
  { id: 'S9', turns: one('дякую', { outcome: 'answer', maxIntents: 0, noLlm: true }) },
  {
    id: 'S1',
    turns: one('треба купити хліб', {
      outcome: 'confirm',
      kinds: ['create'],
      maxIntents: 1,
      unscheduled: true,
      nameIncludes: 'хліб',
    }),
  },
  {
    id: 'S2',
    turns: one('закінчив звіт', {
      outcome: 'confirm',
      kinds: ['complete'],
      maxIntents: 1,
      nameIncludes: 'звіт',
    }),
  },
  {
    id: 'S4',
    turns: one('купи хліб і запиши подзвонити мамі', {
      outcome: 'confirm',
      kinds: ['create', 'create'],
      maxIntents: 2,
    }),
  },
  {
    id: 'S5',
    turns: one('створи задачу оплатити інтернет і видали молоко', {
      outcome: 'confirm',
      kinds: ['create', 'delete'],
    }),
  },
  {
    id: 'S8',
    turns: one('завтра треба купити ліки, забрати посилку і записатися до лікаря', {
      outcome: 'confirm',
      kinds: ['create', 'create', 'create'],
      noPlan: true,
    }),
  },
  {
    id: 'S3',
    turns: one('що в мене сьогодні?', {
      outcome: 'answer',
      maxIntents: 0,
      answer: true,
      minPlannerCalls: 2,
    }),
  },
  {
    id: 'S6',
    turns: one('сплануй сьогодні', {
      outcome: 'clarify',
      maxIntents: 0,
      answer: true,
      minPlannerCalls: 2,
      planStage: 'interview',
      actionsInclude: 'build_plan',
      planNames: ['Звіт', 'Молоко'],
    }),
  },
];

/** Day-plan rows stay out until the server keeps the dialogue open until Apply. */
const COMPLEX: Scenario[] = [
  {
    id: 'C1',
    turns: one('що в мене сьогодні і додай задачу купити хліб', {
      outcome: 'confirm',
      kinds: ['create'],
      maxIntents: 1,
      answer: true,
      minPlannerCalls: 2,
    }),
  },
  {
    id: 'C4',
    turns: one('додай задачу спортзал на 18 і перенеси її на 19', {
      outcome: 'confirm',
      kinds: ['create'],
      maxIntents: 1,
      nameIncludes: '19',
    }),
  },
  {
    id: 'C8',
    turns: [
      { transcript: 'видали молоко', expect: { outcome: 'confirm', kinds: ['delete'], maxIntents: 1 } },
      { transcript: 'так, давай', expect: { outcome: 'act', kinds: ['delete'], maxIntents: 1 } },
    ],
  },
  {
    id: 'C2',
    turns: [
      {
        transcript: 'купи хліб і перенеси ту штуку',
        expect: { outcome: 'clarify', maxIntents: 0 },
      },
      {
        transcript: 'звіт, на завтра',
        expect: { outcome: 'confirm', kinds: ['create', 'window|shift|update'] },
      },
    ],
  },
  {
    id: 'C5',
    turns: [
      {
        transcript: 'сплануй сьогодні',
        expect: {
          outcome: 'clarify',
          maxIntents: 0,
          answer: true,
          minPlannerCalls: 2,
          planStage: 'interview',
          actionsInclude: 'build_plan',
          planNames: ['Звіт', 'Молоко'],
        },
      },
      {
        transcript: 'додай годину спортзалу',
        expect: {
          outcome: 'clarify',
          maxIntents: 0,
          planStage: 'interview',
          actionsInclude: 'build_plan',
          planNames: ['Звіт', 'Молоко', 'спортзал'],
        },
      },
      {
        actionId: 'build_plan',
        expect: { outcome: 'confirm', noLlm: true, planStage: 'review' },
      },
    ],
  },
  {
    id: 'C6',
    turns: [
      {
        transcript: 'сплануй сьогодні',
        expect: {
          outcome: 'clarify',
          maxIntents: 0,
          planStage: 'interview',
          actionsInclude: 'build_plan',
          planNames: ['Звіт', 'Молоко'],
        },
      },
      {
        transcript: 'прибери молоко і додай спортзал',
        expect: {
          outcome: 'clarify',
          maxIntents: 0,
          planStage: 'interview',
          actionsInclude: 'build_plan',
          planNames: ['Звіт', 'спортзал'],
          planAbsent: ['Молоко'],
          planRevisionMin: 1,
        },
      },
    ],
  },
  {
    id: 'C7',
    turns: [
      {
        transcript: 'сплануй сьогодні',
        expect: {
          outcome: 'clarify',
          maxIntents: 0,
          planStage: 'interview',
          actionsInclude: 'build_plan',
        },
      },
      {
        transcript: 'коли я вільний?',
        expect: {
          outcome: ['clarify', 'answer'],
          maxIntents: 0,
          answer: true,
          minPlannerCalls: 2,
          planStage: 'interview',
          actionsInclude: 'build_plan',
          planNames: ['Звіт', 'Молоко'],
        },
      },
    ],
  },
  {
    id: 'C9',
    turns: [
      {
        transcript: 'купи хліб і перенеси ту штуку',
        expect: { outcome: 'clarify', maxIntents: 0 },
      },
      {
        transcript: 'не знаю',
        expect: { outcome: 'clarify', maxIntents: 0 },
      },
      {
        transcript: 'та байдуже',
        expect: { outcome: 'confirm', kinds: ['create'], maxIntents: 1, nameIncludes: 'хліб' },
      },
    ],
  },
  {
    id: 'C10',
    turns: [
      {
        transcript: 'сплануй сьогодні',
        expect: {
          outcome: 'clarify',
          maxIntents: 0,
          planStage: 'interview',
          actionsInclude: 'build_plan',
          planNames: ['Звіт', 'Молоко'],
        },
      },
      {
        transcript: 'завтра треба купити хліб',
        expect: { outcome: 'confirm', kinds: ['create'], maxIntents: 1, nameIncludes: 'хліб' },
      },
      {
        actionId: 'report',
        executionReport: { results: [{ summary: 'купити хліб', status: 'applied' }] },
        expect: {
          outcome: 'clarify',
          noLlm: true,
          planStage: 'interview',
          actionsInclude: 'build_plan',
          planNames: ['Звіт', 'Молоко'],
        },
      },
    ],
  },
  {
    id: 'C11',
    turns: [
      {
        transcript: 'ну таке, зроби щось',
        expect: { outcome: 'clarify', maxIntents: 0, noPlan: true },
      },
      {
        transcript: 'ну не знаю',
        expect: { outcome: 'clarify', maxIntents: 0, noPlan: true },
      },
      {
        transcript: 'та байдуже',
        expect: { outcome: 'refuse', maxIntents: 0, noPlan: true },
      },
    ],
  },
  {
    id: 'C12',
    turns: [
      {
        transcript: 'сплануй сьогодні',
        expect: {
          outcome: 'clarify',
          maxIntents: 0,
          planStage: 'interview',
          actionsInclude: 'build_plan',
          planNames: ['Звіт', 'Молоко'],
          maxPlanItems: 2,
        },
      },
      {
        transcript: 'додай ще одну справу',
        expect: {
          outcome: 'clarify',
          maxIntents: 0,
          planStage: 'interview',
          actionsInclude: 'build_plan',
          planNames: ['Звіт', 'Молоко'],
          maxPlanItems: 2,
        },
      },
      {
        transcript: 'не знаю',
        expect: {
          outcome: 'clarify',
          maxIntents: 0,
          planStage: 'interview',
          actionsInclude: 'build_plan',
          planNames: ['Звіт', 'Молоко'],
          maxPlanItems: 2,
        },
      },
      {
        transcript: 'та байдуже',
        expect: {
          outcome: 'clarify',
          maxIntents: 0,
          answer: true,
          planStage: 'interview',
          actionsInclude: 'build_plan',
          planNames: ['Звіт', 'Молоко'],
          maxPlanItems: 2,
        },
      },
    ],
  },
  {
    id: 'C13',
    turns: [
      {
        transcript: 'ну таке, зроби щось',
        expect: { outcome: 'clarify', maxIntents: 0, noPlan: true },
      },
      {
        transcript: 'ну не знаю',
        expect: { outcome: 'clarify', maxIntents: 0, noPlan: true },
      },
      {
        transcript: 'додай задачу купити хліб',
        expect: { outcome: 'confirm', kinds: ['create'], maxIntents: 1, nameIncludes: 'хліб' },
      },
      {
        transcript: 'ну таке, зроби щось',
        expect: { outcome: 'clarify', maxIntents: 0, noPlan: true, messageExcludes: ['хліб'] },
      },
    ],
  },
  {
    id: 'C14',
    turns: [
      {
        transcript: 'купи хліб і перенеси ту штуку',
        expect: { outcome: 'clarify', maxIntents: 0, noPlan: true },
      },
      {
        transcript: 'звіт, на завтра',
        expect: { outcome: 'confirm', kinds: ['create', 'window|shift|update'], nameIncludes: 'хліб' },
      },
      {
        transcript: 'ну таке, зроби щось',
        expect: { outcome: 'clarify', maxIntents: 0, noPlan: true, messageExcludes: ['Звіт', 'хліб'] },
      },
      {
        transcript: 'ну не знаю',
        expect: { outcome: 'clarify', maxIntents: 0, noPlan: true, messageExcludes: ['Звіт', 'хліб'] },
      },
    ],
  },
];

/** Not yet run. Habits are hidden and are not in this list. Day-plan stays out until Apply owns the end of the dialogue. */
const NEXT: Scenario[] = [
  {
    id: 'N1',
    turns: one('додай задачу купити хліб і масло', {
      outcome: 'confirm',
      kinds: ['create'],
      maxIntents: 1,
      nameIncludes: 'хліб',
    }),
  },
  {
    id: 'M6',
    turns: one('перенеси звіт на завтра і додай задачу прибрати кухню', {
      outcome: 'confirm',
      kinds: ['window|shift|update', 'create'],
    }),
  },
  {
    id: 'M7',
    turns: one('молоко перенеси на 15:00, а звіт познач виконаним', {
      outcome: 'confirm',
      kinds: ['shift|update|window', 'complete'],
    }),
  },
  {
    id: 'M8',
    turns: one('ну значить так… купити корм коту і ще оплатити комуналку', {
      outcome: 'confirm',
      kinds: ['create', 'create'],
      maxIntents: 2,
    }),
  },
  {
    id: 'M9',
    turns: one('спочатку зроби звіт зараз, потім нагадай купити воду о шостій', {
      outcome: 'confirm',
      kinds: ['shift|window|update', 'create'],
    }),
  },
  {
    id: 'M10',
    turns: one('додай задачу купити хліб… ні, батон, і ще видали молоко', {
      outcome: 'confirm',
      kinds: ['create', 'delete'],
      maxIntents: 2,
      nameIncludes: 'батон',
    }),
  },
  {
    id: 'Q2',
    turns: one('коли я вільний завтра? і звіт уже зробив', {
      outcome: 'confirm',
      kinds: ['complete'],
      answer: true,
      minPlannerCalls: 2,
    }),
  },
  {
    id: 'Q4',
    turns: one('що в мене в списку без часу?', {
      outcome: 'answer',
      maxIntents: 0,
      answer: true,
      minPlannerCalls: 2,
    }),
  },
  {
    id: 'C3',
    turns: [
      {
        transcript: 'додай задачу купити хліб',
        expect: { outcome: 'confirm', kinds: ['create'], maxIntents: 1 },
      },
      {
        transcript: 'перенеси його на завтра',
        expect: { outcome: 'confirm', kinds: ['window|shift|update'], nameIncludes: 'хліб' },
      },
    ],
  },
];

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
  const minutes = process.argv.some((arg) => arg.startsWith('--minutes='));
  const pool = process.argv.includes('--timed')
    ? TIMED
    : process.argv.includes('--bulk') || minutes
      ? BULK
      : process.argv.includes('--next')
        ? NEXT
        : process.argv.includes('--complex')
          ? COMPLEX
          : SCENARIOS;
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
  const deepseekAll =
    process.argv.includes('--deepseek') ||
    process.argv.includes('--timed') ||
    minutes > 0;
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
    const poolLabel = process.argv.includes('--timed')
      ? 'timed'
      : minutes > 0
        ? 'marathon'
        : process.argv.includes('--next')
          ? 'next'
          : process.argv.includes('--complex')
            ? 'complex'
            : 'simple';
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
      try {
        for (let turnIndex = 0; turnIndex < scenario.turns.length; turnIndex += 1) {
          const turn = scenario.turns[turnIndex];
          const before = groq.evalSpends().length;
          const turnStarted = Date.now();
          const response = await voice.turn(userId, {
            sessionId,
            transcript: turn.transcript,
            actionId: turn.actionId,
            executionReport: turn.executionReport,
            timeZone: MULTI_INTENT_EVAL_ANCHORS.timeZone,
            clientNowIso: MULTI_INTENT_EVAL_ANCHORS.nowIso,
          });
          const calls = groq.evalSpends().slice(before);
          const failures = matchTurn(turn.expect, response, calls);
          const row = {
            id: scenario.turns.length > 1 ? `${scenario.id}.${turnIndex + 1}` : scenario.id,
            ok: failures.length === 0,
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
          };
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
                timeZone: MULTI_INTENT_EVAL_ANCHORS.timeZone,
                clientNowIso: MULTI_INTENT_EVAL_ANCHORS.nowIso,
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
        cases.push({ id: scenario.id, ok: false, error: message });
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
    timeZone: MULTI_INTENT_EVAL_ANCHORS.timeZone,
    wakeTime: MULTI_INTENT_EVAL_ANCHORS.wakeTime,
    sleepTime: MULTI_INTENT_EVAL_ANCHORS.sleepTime,
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
  for (const fixture of INTENT_EVAL_FIXTURES.tasks) {
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
