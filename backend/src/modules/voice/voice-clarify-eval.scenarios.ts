/**
 * Clarify-continue eval: previousTranscript + clarificationAnswer → parseTask.
 * UK only. Covers normal answers, pivots, corrections, new creates mid-clarify.
 */
import type { CreateEvalExpect } from './voice-create-eval.scenarios';

export const CLARIFY_EVAL_ANCHORS = {
  timeZone: 'Europe/Kyiv',
  nowIso: '2026-10-13T10:00:00.000Z',
  todayYmd: '2026-10-13',
  tomorrowYmd: '2026-10-14',
  wakeTime: '08:00',
  sleepTime: '23:00',
  defaultTaskDurationMinutes: 30,
} as const;

export type ClarifyEvalScenario = {
  id: string;
  construction: string;
  language: 'uk';
  previousTranscript: string;
  /** What the agent asked (context only; not sent unless needed). */
  clarifyingQuestion?: string;
  /** User's follow-up turn (sent as transcript + clarificationAnswer). */
  answer: string;
  expect: CreateEvalExpect & {
    /**
     * Expected intent after the answer turn.
     * For create: also match CreateEvalExpect fields.
     * For other intents: understanding + commandKind (via intent) is enough.
     */
    intent?:
      | 'create'
      | 'update'
      | 'delete'
      | 'complete'
      | 'skip'
      | 'reschedule'
      | 'habit_create'
      | 'habit_check_in'
      | 'habit_update'
      | 'habit_delete'
      | 'habit_uncheck'
      | 'needs_clarification';
    commandKind?: string;
  };
};

export const CLARIFY_EVAL_BLOCK_SIZE = 50;

export const CLARIFY_EVAL_SCENARIOS: ClarifyEvalScenario[] = [
  {
    id: 'cl01',
    language: 'uk',
    construction: 'ans.name.only.after.add.task',
    previousTranscript: 'додай задачу',
    clarifyingQuestion: 'Яку задачу додати?',
    answer: 'купити молоко',
    expect: {
      understanding: 'complete',
      kind: 'unscheduled',
      nameIncludes: 'молоко',
      isUnscheduled: true,
      noScheduleFields: true,
      intent: 'create',
    },
  },
  {
    id: 'cl02',
    language: 'uk',
    construction: 'ans.name.plus.tomorrow',
    previousTranscript: 'додай задачу',
    answer: 'завтра купити молоко',
    expect: {
      understanding: 'complete',
      kind: 'flexible',
      nameIncludes: 'молоко',
      dayWindowYmd: '2026-10-14',
      intent: 'create',
    },
  },
  {
    id: 'cl03',
    language: 'uk',
    construction: 'ans.name.plus.fixed.clock',
    previousTranscript: 'створи задачу',
    answer: 'завтра о 15 до стоматолога',
    expect: {
      understanding: 'complete',
      kind: 'fixed',
      nameIncludes: 'стоматолог',
      scheduledYmd: '2026-10-14',
      scheduledHour: 15,
      intent: 'create',
    },
  },
  {
    id: 'cl04',
    language: 'uk',
    construction: 'ans.when.only.after.named.unclear',
    previousTranscript: 'додай задачу',
    answer: 'завтра о 15',
    expect: {
      understanding: 'needs_clarification',
      intent: 'needs_clarification',
    },
  },
  {
    id: 'cl05',
    language: 'uk',
    construction: 'ans.pivot.new.create.full',
    previousTranscript: 'додай задачу',
    answer: 'краще щодня розтяжка о 8',
    expect: {
      understanding: 'complete',
      kind: 'recurring',
      nameIncludes: 'розтяж',
      recurrencePattern: 'DAILY',
      scheduledHour: 8,
      intent: 'create',
    },
  },
  {
    id: 'cl06',
    language: 'uk',
    construction: 'ans.pivot.delete.instead',
    previousTranscript: 'додай задачу',
    answer: 'ні, краще видали звіт',
    expect: {
      understanding: 'complete',
      intent: 'delete',
      commandKind: 'delete',
    },
  },
  {
    id: 'cl07',
    language: 'uk',
    construction: 'ans.correct.name.after.partial',
    previousTranscript: 'додай задачу',
    answer: 'молоко… ні, хліб',
    expect: {
      understanding: 'complete',
      kind: 'unscheduled',
      nameIncludes: 'хліб',
      isUnscheduled: true,
      noScheduleFields: true,
      intent: 'create',
    },
  },
  {
    id: 'cl08',
    language: 'uk',
    construction: 'ans.soft.pref.after.name.ask',
    previousTranscript: 'додай задачу',
    answer: 'забрати посилку десь увечері',
    expect: {
      understanding: 'complete',
      kind: 'flexible',
      nameIncludes: 'посил',
      hasScheduledStart: true,
      intent: 'create',
    },
  },
  {
    id: 'cl09',
    language: 'uk',
    construction: 'ans.window.after.add',
    previousTranscript: 'нова задача',
    answer: 'між 14 і 18 купити продукти',
    expect: {
      understanding: 'complete',
      kind: 'flexible',
      nameIncludes: 'продукт',
      hasEarliest: true,
      hasDeadline: true,
      intent: 'create',
    },
  },
  {
    id: 'cl10',
    language: 'uk',
    construction: 'ans.noise.thinking.then.name',
    previousTranscript: 'додай задачу',
    answer:
      'хм… що ж… завтра після роботи поки не втомлений сходити в магазин',
    expect: {
      understanding: 'complete',
      kind: 'flexible',
      nameIncludes: 'магазин',
      dayWindowYmd: '2026-10-14',
      intent: 'create',
    },
  },
  {
    id: 'cl11',
    language: 'uk',
    construction: 'ans.refuse.then.still.create',
    previousTranscript: 'додай задачу',
    answer: 'не треба… хоча купи батарейки',
    expect: {
      understanding: 'complete',
      kind: 'unscheduled',
      nameIncludes: 'батарей',
      isUnscheduled: true,
      noScheduleFields: true,
      intent: 'create',
    },
  },
  {
    id: 'cl12',
    language: 'uk',
    construction: 'ans.still.empty.clarify',
    previousTranscript: 'додай задачу',
    answer: 'ну щось там',
    expect: {
      understanding: 'needs_clarification',
    },
  },
  {
    id: 'cl13',
    language: 'uk',
    construction: 'ans.habit.create.pivot',
    previousTranscript: 'додай задачу',
    answer: 'створи звичку пити воду',
    expect: {
      understanding: 'complete',
      intent: 'habit_create',
      commandKind: 'habit_create',
    },
  },
  {
    id: 'cl14',
    language: 'uk',
    construction: 'ans.reschedule.pivot',
    previousTranscript: 'додай задачу',
    answer: 'перенеси звіт на завтра',
    expect: {
      understanding: 'complete',
      intent: 'reschedule',
      commandKind: 'window',
    },
  },
  {
    id: 'cl15',
    language: 'uk',
    construction: 'ans.after.when.only.clarify.give.name',
    previousTranscript: 'завтра о 15',
    answer: 'зустріч з клієнтом',
    expect: {
      understanding: 'complete',
      kind: 'fixed',
      nameIncludes: 'зустріч',
      scheduledYmd: '2026-10-14',
      scheduledHour: 15,
      intent: 'create',
    },
  },
  {
    id: 'cl16',
    language: 'uk',
    construction: 'ans.duration.plus.name',
    previousTranscript: 'додай задачу',
    answer: 'написати статтю на дві години',
    expect: {
      understanding: 'complete',
      kind: 'unscheduled',
      nameIncludes: 'статт',
      isUnscheduled: true,
      noScheduleFields: true,
      intent: 'create',
    },
  },
  {
    id: 'cl17',
    language: 'uk',
    construction: 'ans.weekday.once',
    previousTranscript: 'запиши задачу',
    answer: 'у пʼятницю здати звіт',
    expect: {
      understanding: 'complete',
      kind: 'flexible',
      nameIncludes: 'звіт',
      dayWindowYmd: '2026-10-16',
      intent: 'create',
    },
  },
  {
    id: 'cl18',
    language: 'uk',
    construction: 'ans.complete.pivot',
    previousTranscript: 'додай задачу',
    answer: 'закінчив звіт',
    expect: {
      understanding: 'complete',
      intent: 'complete',
      commandKind: 'complete',
    },
  },
  {
    id: 'cl19',
    language: 'uk',
    construction: 'ans.relative.hours',
    previousTranscript: 'нова задача',
    answer: 'через годину перекур',
    expect: {
      understanding: 'complete',
      kind: 'fixed',
      nameIncludes: 'перекур',
      scheduledHour: 14,
      intent: 'create',
    },
  },
  {
    id: 'cl20',
    language: 'uk',
    construction: 'ans.or.two.names.last',
    previousTranscript: 'додай задачу',
    answer: 'молоко чи хліб? хай хліб',
    expect: {
      understanding: 'complete',
      kind: 'unscheduled',
      nameIncludes: 'хліб',
      isUnscheduled: true,
      noScheduleFields: true,
      intent: 'create',
    },
  },
  {
    id: 'cl21',
    language: 'uk',
    construction: 'ans.rec.weekdays',
    previousTranscript: 'додай задачу',
    answer: 'по буднях standup о 10',
    expect: {
      understanding: 'complete',
      kind: 'recurring',
      nameIncludes: 'standup',
      recurrencePattern: 'WEEKLY',
      recurrenceWeekDays: [1, 2, 3, 4, 5],
      scheduledHour: 10,
      intent: 'create',
    },
  },
  {
    id: 'cl22',
    language: 'uk',
    construction: 'ans.deadline.only',
    previousTranscript: 'створи задачу',
    answer: 'до 18 відправити акт',
    expect: {
      understanding: 'complete',
      kind: 'flexible',
      nameIncludes: 'акт',
      hasDeadline: true,
      intent: 'create',
    },
  },
  {
    id: 'cl23',
    language: 'uk',
    construction: 'ans.still.meta.clarify',
    previousTranscript: 'додай задачу',
    answer: 'ти сам придумай',
    expect: {
      understanding: 'needs_clarification',
    },
  },
  {
    id: 'cl24',
    language: 'uk',
    construction: 'ans.skip.pivot',
    previousTranscript: 'додай задачу',
    answer: 'пропусти gym',
    expect: {
      understanding: 'complete',
      intent: 'skip',
      commandKind: 'skip',
    },
  },
  {
    id: 'cl25',
    language: 'uk',
    construction: 'ans.location.plus.day',
    previousTranscript: 'додай задачу',
    answer: 'завтра в сервісний центр на Оболоні',
    expect: {
      understanding: 'complete',
      kind: 'flexible',
      nameIncludes: 'сервіс',
      dayWindowYmd: '2026-10-14',
      intent: 'create',
    },
  },
  {
    id: 'cl26',
    language: 'uk',
    construction: 'ans.fix.span',
    previousTranscript: 'постав у календар',
    answer: 'зустріч з 15 до 16',
    expect: {
      understanding: 'complete',
      kind: 'fixed',
      nameIncludes: 'зустріч',
      scheduledHour: 15,
      intent: 'create',
    },
  },
  {
    id: 'cl27',
    language: 'uk',
    construction: 'ans.update.pivot.rename',
    previousTranscript: 'додай задачу',
    answer: 'перейменуй молоко на хліб',
    expect: {
      understanding: 'complete',
      intent: 'update',
      commandKind: 'update',
    },
  },
  {
    id: 'cl28',
    language: 'uk',
    construction: 'ans.after.task.word.only',
    previousTranscript: 'задача',
    answer: 'полити квіти завтра вранці',
    expect: {
      understanding: 'complete',
      kind: 'flexible',
      nameIncludes: 'квіт',
      dayWindowYmd: '2026-10-14',
      intent: 'create',
    },
  },
  {
    id: 'cl29',
    language: 'uk',
    construction: 'ans.habit.checkin.pivot',
    previousTranscript: 'додай задачу',
    answer: 'відміть звичку вода',
    expect: {
      understanding: 'complete',
      intent: 'habit_check_in',
      commandKind: 'habit_check_in',
    },
  },
  {
    id: 'cl30',
    language: 'uk',
    construction: 'ans.unscheduled.imperative',
    previousTranscript: 'додай щось',
    answer: 'полагодити кран',
    expect: {
      understanding: 'complete',
      kind: 'unscheduled',
      nameIncludes: 'кран',
      isUnscheduled: true,
      noScheduleFields: true,
      intent: 'create',
    },
  },
  {
    id: 'cl31',
    language: 'uk',
    construction: 'ans.mind.change.when.in.answer',
    previousTranscript: 'додай задачу',
    answer: 'завтра ввечері… ні, краще після обіду заїхати в аптеку',
    expect: {
      understanding: 'complete',
      kind: 'flexible',
      nameIncludes: 'аптек',
      dayWindowYmd: '2026-10-14',
      intent: 'create',
    },
  },
  {
    id: 'cl32',
    language: 'uk',
    construction: 'ans.biweekly',
    previousTranscript: 'нова задача',
    answer: 'раз на два тижні стрижка',
    expect: {
      understanding: 'complete',
      kind: 'recurring',
      nameIncludes: 'стриж',
      recurrencePattern: 'BIWEEKLY',
      intent: 'create',
    },
  },
  {
    id: 'cl33',
    language: 'uk',
    construction: 'ans.end.of.week',
    previousTranscript: 'додай задачу',
    answer: 'до кінця тижня закрити реліз',
    expect: {
      understanding: 'complete',
      kind: 'flexible',
      nameIncludes: 'реліз',
      hasDeadline: true,
      intent: 'create',
    },
  },
  {
    id: 'cl34',
    language: 'uk',
    construction: 'ans.garbage.still.clarify',
    previousTranscript: 'додай задачу',
    answer: 'ааа ммм',
    expect: {
      understanding: 'needs_clarification',
    },
  },
  {
    id: 'cl35',
    language: 'uk',
    construction: 'ans.polite.name',
    previousTranscript: 'зроби мені задачу',
    answer: 'будь ласка купити корм коту',
    expect: {
      understanding: 'complete',
      kind: 'unscheduled',
      nameIncludes: 'корм',
      isUnscheduled: true,
      noScheduleFields: true,
      intent: 'create',
    },
  },
  {
    id: 'cl36',
    language: 'uk',
    construction: 'ans.after.schedule.something',
    previousTranscript: 'заплануй щось',
    answer: 'о 16 дзвінок з клієнтом',
    expect: {
      understanding: 'complete',
      kind: 'fixed',
      nameIncludes: 'дзвінок',
      scheduledHour: 16,
      intent: 'create',
    },
  },
  {
    id: 'cl37',
    language: 'uk',
    construction: 'ans.habit.delete.pivot',
    previousTranscript: 'додай задачу',
    answer: 'видали звичку вода',
    expect: {
      understanding: 'complete',
      intent: 'habit_delete',
      commandKind: 'habit_delete',
    },
  },
  {
    id: 'cl38',
    language: 'uk',
    construction: 'ans.win.plus.preferred',
    previousTranscript: 'додай задачу',
    answer: 'між 14 і 18 купити продукти краще о 15',
    expect: {
      understanding: 'complete',
      kind: 'flexible',
      nameIncludes: 'продукт',
      hasEarliest: true,
      hasDeadline: true,
      scheduledHour: 15,
      intent: 'create',
    },
  },
  {
    id: 'cl39',
    language: 'uk',
    construction: 'ans.someday.unscheduled',
    previousTranscript: 'нова задача',
    answer: 'якось пофарбувати стіну',
    expect: {
      understanding: 'complete',
      kind: 'unscheduled',
      nameIncludes: 'стін',
      isUnscheduled: true,
      noScheduleFields: true,
      intent: 'create',
    },
  },
  {
    id: 'cl40',
    language: 'uk',
    construction: 'ans.two.errands',
    previousTranscript: 'додай задачу',
    answer: 'купити хліб і молоко',
    expect: {
      understanding: 'complete',
      kind: 'unscheduled',
      nameIncludes: 'хліб',
      isUnscheduled: true,
      noScheduleFields: true,
      intent: 'create',
    },
  },
  {
    id: 'cl41',
    language: 'uk',
    construction: 'ans.after.put.in.calendar',
    previousTranscript: 'постав у календар',
    answer: 'післязавтра о 10 захист проєкту',
    expect: {
      understanding: 'complete',
      kind: 'fixed',
      nameIncludes: 'захист',
      scheduledHour: 10,
      intent: 'create',
    },
  },
  {
    id: 'cl42',
    language: 'uk',
    construction: 'ans.question.as.create',
    previousTranscript: 'додай задачу',
    answer: 'а чи не записати ідею про подкаст',
    expect: {
      understanding: 'complete',
      kind: 'unscheduled',
      nameIncludes: 'подкаст',
      isUnscheduled: true,
      noScheduleFields: true,
      intent: 'create',
    },
  },
  {
    id: 'cl43',
    language: 'uk',
    construction: 'ans.urgent.today',
    previousTranscript: 'додай задачу',
    answer: 'сьогодні терміново відповісти юристу',
    expect: {
      understanding: 'complete',
      kind: 'flexible',
      nameIncludes: 'юрист',
      dayWindowYmd: '2026-10-13',
      intent: 'create',
    },
  },
  {
    id: 'cl44',
    language: 'uk',
    construction: 'ans.monthly.rec',
    previousTranscript: 'нова задача',
    answer: 'раз на місяць звітувати бухгалтеру',
    expect: {
      understanding: 'complete',
      kind: 'recurring',
      nameIncludes: 'звіт',
      recurrencePattern: 'MONTHLY',
      intent: 'create',
    },
  },
  {
    id: 'cl45',
    language: 'uk',
    construction: 'ans.before.sleep.pref',
    previousTranscript: 'додай задачу',
    answer: 'перед сном прочитати главу',
    expect: {
      understanding: 'complete',
      kind: 'flexible',
      nameIncludes: 'глав',
      hasScheduledStart: true,
      intent: 'create',
    },
  },
  {
    id: 'cl46',
    language: 'uk',
    construction: 'ans.still.add.something.clarify',
    previousTranscript: 'додай щось',
    answer: 'щось важливе',
    expect: {
      understanding: 'needs_clarification',
    },
  },
  {
    id: 'cl47',
    language: 'uk',
    construction: 'ans.weekend.block',
    previousTranscript: 'додай задачу',
    answer: 'на вихідних прибрати гараж',
    expect: {
      understanding: 'complete',
      kind: 'flexible',
      nameIncludes: 'гараж',
      hasEarliest: true,
      hasDeadline: true,
      intent: 'create',
    },
  },
  {
    id: 'cl48',
    language: 'uk',
    construction: 'ans.ordinal.evening',
    previousTranscript: 'створи задачу',
    answer: 'о сьомій вечора дзвінок батькам',
    expect: {
      understanding: 'complete',
      kind: 'fixed',
      nameIncludes: 'дзвінок',
      scheduledHour: 19,
      intent: 'create',
    },
  },
  {
    id: 'cl49',
    language: 'uk',
    construction: 'ans.habit.uncheck.pivot',
    previousTranscript: 'додай задачу',
    answer: 'зніми відмітку зі звички вода',
    expect: {
      understanding: 'complete',
      intent: 'habit_uncheck',
      commandKind: 'habit_uncheck',
    },
  },
  {
    id: 'cl50',
    language: 'uk',
    construction: 'ans.full.noise.store.example',
    previousTranscript: 'додай задачу',
    answer:
      'завтра треба сходити в магазин… може ввечері, чи ні, краще вдень після роботи',
    expect: {
      understanding: 'complete',
      kind: 'flexible',
      nameIncludes: 'магазин',
      dayWindowYmd: '2026-10-14',
      intent: 'create',
    },
  },
];

export function clarifyEvalBlockCount(): number {
  return Math.max(
    1,
    Math.ceil(CLARIFY_EVAL_SCENARIOS.length / CLARIFY_EVAL_BLOCK_SIZE),
  );
}

export function selectClarifyEvalBlock(
  which: number | 'latest',
): ClarifyEvalScenario[] {
  const count = clarifyEvalBlockCount();
  const index = which === 'latest' ? count - 1 : which;
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    throw new Error(`Clarify-eval block ${String(which)} out of range.`);
  }
  const start = index * CLARIFY_EVAL_BLOCK_SIZE;
  return CLARIFY_EVAL_SCENARIOS.slice(start, start + CLARIFY_EVAL_BLOCK_SIZE);
}
