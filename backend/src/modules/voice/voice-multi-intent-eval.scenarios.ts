/**
 * Companion agent eval: several intents in one utterance, and the day-plan dialogue.
 * Runs `/voice/turn` logic end to end (planner + specialist parse) with a fresh session per scenario.
 * Fixtures: open Unscheduled tasks Звіт / Молоко and the Gym series (see INTENT_EVAL_FIXTURES).
 * Nothing is written: a write turn is `confirm` (preview). Spoken yes returns `act`. Intents are only asserted.
 */
import type { VoiceTurnOutcome, VoiceTurnResponse } from './voice-agent.types';

/**
 * "Now" is tomorrow 07:30 Kyiv (before wake) on the real clock: the engine dry-run seats
 * against the real clock, so a fixed past anchor would leave every plan day in the past.
 */
function evalNowIso(): string {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 4, 30),
  ).toISOString();
}

export const MULTI_INTENT_EVAL_ANCHORS = {
  timeZone: 'Europe/Kyiv',
  nowIso: evalNowIso(),
  wakeTime: '08:00',
  sleepTime: '23:00',
} as const;

/**
 * `create`, or the command kind (`complete`, `delete`, `shift`, `window`, …).
 * `a|b` accepts either (a skipped series occurrence resolves to `cancel`).
 */
export type MultiIntentKind = string;

export type MultiIntentTurnExpect = {
  outcome: VoiceTurnOutcome | VoiceTurnOutcome[];
  /** Every listed kind must appear (multiset, any order). */
  kinds?: MultiIntentKind[];
  minIntents?: number;
  maxIntents?: number;
  /** An open plan card must be returned at this stage. */
  plan?: 'review' | 'interview' | 'any';
  /** Plan items whose name includes each string. */
  planNamesInclude?: string[];
  /** Plan items whose name must not include these strings. */
  planNamesExclude?: string[];
  answer?: boolean;
};

export type MultiIntentTurn =
  | { transcript: string; expect: MultiIntentTurnExpect }
  | { actionId: 'confirm' | 'cancel' | 'build_plan'; expect: MultiIntentTurnExpect };

export type MultiIntentEvalScenario = {
  id: string;
  language: 'uk' | 'en';
  construction: string;
  turns: MultiIntentTurn[];
};

const one = (transcript: string, expect: MultiIntentTurnExpect): MultiIntentTurn[] => [
  { transcript, expect },
];

export const MULTI_INTENT_EVAL_SCENARIOS: MultiIntentEvalScenario[] = [
  // ── Two or more writes ───────────────────────────────────────────────
  { id: 'mi01', language: 'uk', construction: 'two.creates', turns: one('купи хліб і запиши подзвонити мамі', { outcome: 'confirm', kinds: ['create', 'create'], maxIntents: 2 }) },
  { id: 'mi02', language: 'uk', construction: 'create.plus.complete', turns: one('додай задачу помити авто, а звіт я вже закінчив', { outcome: 'confirm', kinds: ['create', 'complete'] }) },
  { id: 'mi03', language: 'uk', construction: 'complete.plus.skip', turns: one('звіт готовий, а gym сьогодні пропусти', { outcome: 'confirm', kinds: ['complete', 'skip|cancel'] }) },
  { id: 'mi04', language: 'uk', construction: 'create.plus.delete.confirms', turns: one('створи задачу оплатити інтернет і видали молоко', { outcome: 'confirm', kinds: ['create', 'delete'] }) },
  { id: 'mi05', language: 'uk', construction: 'three.creates.list', turns: one('завтра треба купити ліки, забрати посилку і записатися до лікаря', { outcome: 'confirm', kinds: ['create', 'create', 'create'] }) },
  { id: 'mi06', language: 'uk', construction: 'reschedule.plus.create', turns: one('перенеси звіт на завтра і додай задачу прибрати кухню', { outcome: 'confirm', kinds: ['window', 'create'] }) },
  { id: 'mi07', language: 'uk', construction: 'shift.plus.complete', turns: one('молоко перенеси на 15:00, а звіт познач виконаним', { outcome: 'confirm', kinds: ['shift|update|window', 'complete'] }) },
  { id: 'mi08', language: 'uk', construction: 'noise.two.creates', turns: one('ну значить так… купити корм коту і ще оплатити комуналку', { outcome: 'confirm', kinds: ['create', 'create'] }) },
  { id: 'mi09', language: 'uk', construction: 'then.connector', turns: one('спочатку зроби звіт зараз, потім нагадай купити воду о шостій', { outcome: 'confirm', kinds: ['shift', 'create'] }) },
  { id: 'mi10', language: 'uk', construction: 'mind.change.inside.one', turns: one('додай задачу купити хліб… ні, батон, і ще видали молоко', { outcome: 'confirm', kinds: ['create', 'delete'], maxIntents: 2 }) },
  { id: 'mi11', language: 'en', construction: 'two.creates', turns: one('add buy batteries and call the dentist tomorrow', { outcome: 'confirm', kinds: ['create', 'create'] }) },
  { id: 'mi12', language: 'en', construction: 'create.plus.complete', turns: one('I finished the report, and add a task to water the plants', { outcome: 'confirm', kinds: ['complete', 'create'] }) },
  { id: 'mi13', language: 'en', construction: 'delete.plus.skip', turns: one('delete milk and skip gym today', { outcome: 'confirm', kinds: ['delete', 'skip|cancel'] }) },
  { id: 'mi14', language: 'en', construction: 'three.mixed', turns: one('move the report to tomorrow, mark milk done, and add pick up laundry at 6pm', { outcome: 'confirm', kinds: ['window', 'complete', 'create'] }) },

  // ── Q&A + writes ─────────────────────────────────────────────────────
  { id: 'qa01', language: 'uk', construction: 'question.plus.create', turns: one('що в мене сьогодні і додай задачу купити хліб', { outcome: 'confirm', kinds: ['create'], maxIntents: 1, answer: true }) },
  { id: 'qa02', language: 'uk', construction: 'free.time.plus.complete', turns: one('коли я вільний завтра? і звіт уже зробив', { outcome: 'confirm', kinds: ['complete'], answer: true }) },
  { id: 'qa03', language: 'en', construction: 'question.plus.create', turns: one('what is next, and add a task to book flights', { outcome: 'confirm', kinds: ['create'], answer: true }) },
  { id: 'qa04', language: 'uk', construction: 'question.only', turns: one('що в мене в списку без часу?', { outcome: 'answer', maxIntents: 0, answer: true }) },
  { id: 'qa05', language: 'en', construction: 'question.only', turns: one('am I free tomorrow afternoon?', { outcome: 'answer', maxIntents: 0, answer: true }) },

  // ── Single intent stays single ───────────────────────────────────────
  { id: 'si01', language: 'uk', construction: 'one.create.with.and.in.name', turns: one('додай задачу купити хліб і масло', { outcome: 'confirm', kinds: ['create'], maxIntents: 1 }) },
  { id: 'si02', language: 'uk', construction: 'one.complete', turns: one('закінчив звіт', { outcome: 'confirm', kinds: ['complete'], maxIntents: 1 }) },
  { id: 'si03', language: 'en', construction: 'one.create.compound.name', turns: one('add rock and roll practice on friday', { outcome: 'confirm', kinds: ['create'], maxIntents: 1 }) },

  // ── Partial clarify ──────────────────────────────────────────────────
  {
    id: 'pc01',
    language: 'uk',
    construction: 'clear.plus.vague.then.answer',
    turns: [
      { transcript: 'купи хліб і перенеси ту штуку', expect: { outcome: 'clarify', maxIntents: 0 } },
      { transcript: 'звіт, на завтра', expect: { outcome: 'confirm', kinds: ['create', 'window|update|shift'] } },
    ],
  },
  {
    id: 'pc02',
    language: 'en',
    construction: 'clear.plus.vague.then.answer',
    turns: [
      { transcript: 'add buy eggs and delete that one', expect: { outcome: 'clarify', maxIntents: 0 } },
      { transcript: 'milk', expect: { outcome: 'confirm', kinds: ['create', 'delete'] } },
    ],
  },

  // ── Confirm / cancel by voice ────────────────────────────────────────
  {
    id: 'cf01',
    language: 'uk',
    construction: 'confirm.by.voice',
    turns: [
      { transcript: 'видали молоко і додай задачу купити кефір', expect: { outcome: 'confirm', kinds: ['delete', 'create'] } },
      { transcript: 'так, давай', expect: { outcome: 'act', kinds: ['delete', 'create'] } },
    ],
  },
  {
    id: 'cf02',
    language: 'en',
    construction: 'cancel.by.voice',
    turns: [
      { transcript: 'delete the report and milk', expect: { outcome: 'confirm', kinds: ['delete', 'delete'] } },
      { transcript: 'no, never mind', expect: { outcome: 'answer', maxIntents: 0 } },
    ],
  },

  // ── Day plan ─────────────────────────────────────────────────────────
  { id: 'dp01', language: 'uk', construction: 'plan.today.direct', turns: one('сплануй мені сьогодні', { outcome: ['confirm', 'clarify'], plan: 'any' }) },
  { id: 'dp02', language: 'uk', construction: 'plan.tomorrow.direct', turns: one('склади план на завтра', { outcome: ['confirm', 'clarify'], plan: 'any' }) },
  { id: 'dp03', language: 'en', construction: 'plan.today.direct', turns: one('plan my day', { outcome: ['confirm', 'clarify'], plan: 'any' }) },
  {
    id: 'dp04',
    language: 'uk',
    construction: 'plan.with.new.task',
    turns: one('сплануй завтра, і ще додай туди спортзал на годину ввечері', {
      outcome: ['confirm', 'clarify'],
      plan: 'any',
    }),
  },
  {
    id: 'dp05',
    language: 'uk',
    construction: 'interview.then.build',
    turns: [
      { transcript: 'давай сплануємо завтра', expect: { outcome: ['confirm', 'clarify'], plan: 'any' } },
      { actionId: 'build_plan', expect: { outcome: 'confirm', plan: 'review', planNamesInclude: ['Звіт'] } },
    ],
  },
  {
    id: 'dp06',
    language: 'uk',
    construction: 'review.remove.item',
    turns: [
      { transcript: 'сплануй сьогодні без питань', expect: { outcome: 'confirm', plan: 'review' } },
      { transcript: 'молоко прибери з плану', expect: { outcome: 'confirm', plan: 'review', planNamesExclude: ['Молоко'] } },
    ],
  },
  {
    id: 'dp07',
    language: 'uk',
    construction: 'review.add.item',
    turns: [
      { transcript: 'сплануй сьогодні без питань', expect: { outcome: 'confirm', plan: 'review' } },
      { transcript: 'додай ще пробіжку на пів години', expect: { outcome: 'confirm', plan: 'review', planNamesInclude: ['проб'] } },
    ],
  },
  {
    id: 'dp08',
    language: 'en',
    construction: 'review.move.item',
    turns: [
      { transcript: 'plan today, no questions', expect: { outcome: 'confirm', plan: 'review' } },
      { transcript: 'put the report after 4pm', expect: { outcome: 'confirm', plan: 'review', planNamesInclude: ['Звіт'] } },
    ],
  },
  {
    id: 'dp09',
    language: 'uk',
    construction: 'review.question.keeps.plan',
    turns: [
      { transcript: 'сплануй сьогодні без питань', expect: { outcome: 'confirm', plan: 'review' } },
      { transcript: 'а скільки часу займе звіт?', expect: { outcome: 'confirm', plan: 'review', answer: true } },
    ],
  },
  {
    id: 'dp10',
    language: 'uk',
    construction: 'review.confirm.by.voice',
    turns: [
      { transcript: 'сплануй сьогодні без питань', expect: { outcome: 'confirm', plan: 'review' } },
      { transcript: 'супер, застосовуй', expect: { outcome: ['act', 'answer'] } },
    ],
  },
  {
    id: 'dp11',
    language: 'en',
    construction: 'review.cancel.by.voice',
    turns: [
      { transcript: 'plan today, no questions', expect: { outcome: 'confirm', plan: 'review' } },
      { transcript: 'forget the plan', expect: { outcome: 'answer', maxIntents: 0 } },
    ],
  },
  {
    id: 'dp12',
    language: 'uk',
    construction: 'interview.answer.adds.constraint',
    turns: [
      { transcript: 'допоможи спланувати завтрашній день, спитай що треба', expect: { outcome: 'clarify', plan: 'interview' } },
      { transcript: 'зранку в мене зал на годину, а звіт треба до обіду', expect: { outcome: ['clarify', 'confirm'], plan: 'any' } },
    ],
  },
];

export type MultiIntentTurnMatch = {
  ok: boolean;
  failures: string[];
  actual: {
    outcome: VoiceTurnOutcome;
    kinds: string[];
    planStage: string | null;
    planNames: string[];
    assistantMessage: string;
  };
};

export function intentKind(intent: VoiceTurnResponse['intents'][number]): string {
  if (intent.type === 'create') return 'create';
  const kind = (intent.command as { kind?: unknown }).kind;
  return typeof kind === 'string' ? kind : 'unknown';
}

export function matchMultiIntentTurn(
  expect: MultiIntentTurnExpect,
  response: VoiceTurnResponse,
): MultiIntentTurnMatch {
  const failures: string[] = [];
  const kinds = response.intents.map(intentKind);
  const planNames = response.plan?.items.map((item) => item.name) ?? [];
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
  if (expect.minIntents != null && kinds.length < expect.minIntents) {
    failures.push(`intents ${kinds.length} < ${expect.minIntents}`);
  }
  if (expect.maxIntents != null && kinds.length > expect.maxIntents) {
    failures.push(`intents ${kinds.length} > ${expect.maxIntents}`);
  }
  if (expect.plan) {
    const stage = response.plan?.stage ?? null;
    if (!stage) failures.push('no plan');
    else if (expect.plan !== 'any' && stage !== expect.plan) {
      failures.push(`plan stage ${stage} ≠ ${expect.plan}`);
    }
  }
  const lower = planNames.map((name) => name.toLowerCase());
  for (const needle of expect.planNamesInclude ?? []) {
    if (!lower.some((name) => name.includes(needle.toLowerCase()))) {
      failures.push(`plan lacks ${needle} in [${planNames.join(', ')}]`);
    }
  }
  for (const needle of expect.planNamesExclude ?? []) {
    if (lower.some((name) => name.includes(needle.toLowerCase()))) {
      failures.push(`plan still has ${needle}`);
    }
  }
  if (expect.answer && !response.assistantMessage.trim()) {
    failures.push('empty answer');
  }
  return {
    ok: failures.length === 0,
    failures,
    actual: {
      outcome: response.outcome,
      kinds,
      planStage: response.plan?.stage ?? null,
      planNames,
      assistantMessage: response.assistantMessage,
    },
  };
}
