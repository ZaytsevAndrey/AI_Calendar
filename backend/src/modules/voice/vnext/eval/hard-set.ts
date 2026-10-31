/**
 * V7 hard set (31 Oct 2026): realistic multi-operation, multi-turn dialogues over one richer world, in
 * Ukrainian and English. Written after the A–D sets were stabilised (fix4: 93.9%), before its first live
 * run; expectations are not edited after a result (changes, if any, are listed here with the reason).
 *
 * Every scenario names its world, its turns and the criteria the scorer checks (phase477-score.ts):
 * outcome, target id, forbidden id, a clock or date the preview must carry, the number of intents,
 * the pending count. A "clarify" expectation is a supported refusal or question, not a defect.
 */
import type { EntityRecord } from '../reference/reference-resolver';
import type { TurnExpect } from './phase477-score';
import type { GenScenario } from './phase47-generalization';

export const HARD_SUITE = 'phase47-hard-1';

export type HardWorld = 'office' | 'en-office';
export type HardScenario = Omit<GenScenario, 'world' | 'category'> & { world: HardWorld; language: 'uk' | 'en'; category: 'H' };

const USER = 'user-1';
const entity = (id: string, name: string, extra: Partial<EntityRecord> = {}): EntityRecord => ({ id, userId: USER, type: 'task', name, status: 'open', revision: 1, writable: true, ...extra });

/**
 * One office week. Sunday 18 Oct 2026 09:00 Kyiv is now.
 * - Звіт, Фінансовий звіт: Later tasks.
 * - Нарада з клієнтом: Mon 19 Oct 12:00; Нарада з клієнтом щодо бюджету: Tue 20 Oct 12:00 (flexible, one slot each).
 * - Спортзал: flexible series, Mon 19 and Wed 21 Oct 10:00–11:00, no calendar ids.
 * - Стоматолог: fixed, Thu 22 Oct 15:00–15:45.
 * - Оплата оренди: open reminder, 20 Oct 18:00.
 * - Політ до Львова: the user's own calendar event, Fri 23 Oct 07:00–09:00 (addressable, writable).
 */
function office(language: 'uk' | 'en'): EntityRecord[] {
  const uk = language === 'uk';
  return [
    entity('task-report', uk ? 'Звіт' : 'Quarterly report'),
    entity('task-finance', uk ? 'Фінансовий звіт' : 'Finance report'),
    entity('task-client', uk ? 'Нарада з клієнтом' : 'Client meeting', { scheduledStart: '2026-10-19T09:00:00.000Z', scheduledEnd: '2026-10-19T10:00:00.000Z' }),
    entity('task-client-2', uk ? 'Нарада з клієнтом щодо бюджету' : 'Client meeting about the budget', { scheduledStart: '2026-10-20T09:00:00.000Z', scheduledEnd: '2026-10-20T10:00:00.000Z' }),
    entity('task-gym', uk ? 'Спортзал' : 'Gym', {
      recurring: true,
      seriesEventId: null,
      occurrences: [
        { start: '2026-10-19T07:00:00.000Z', end: '2026-10-19T08:00:00.000Z', googleEventId: null },
        { start: '2026-10-21T07:00:00.000Z', end: '2026-10-21T08:00:00.000Z', googleEventId: null },
      ],
    }),
    entity('task-dentist', uk ? 'Стоматолог' : 'Dentist', { fixed: true, scheduledStart: '2026-10-22T12:00:00.000Z', scheduledEnd: '2026-10-22T12:45:00.000Z' }),
    {
      id: 'rem-rent', userId: USER, type: 'reminder', name: uk ? 'Оплата оренди' : 'Rent payment', status: 'open', revision: 1, writable: true,
      reminder: { dueYmd: '2026-10-20', notificationTime: '18:00', description: null, recurrencePattern: null, recurrenceWeekDays: null },
    },
    entity('ext-lviv', uk ? 'Політ до Львова' : 'Flight to Lviv', { type: 'external_event', writable: true, calendarId: 'primary', scheduledStart: '2026-10-23T04:00:00.000Z', scheduledEnd: '2026-10-23T06:00:00.000Z' }),
  ];
}

export function hardWorld(name: HardWorld): EntityRecord[] {
  return office(name === 'en-office' ? 'en' : 'uk');
}

const clarify: TurnExpect = { outcomes: ['clarify', 'refuse'], clarificationRequired: true, intents: 0 };
const noWrite: TurnExpect = { outcomes: ['answer', 'refuse'], intents: 0 };
const read: TurnExpect = { outcomes: ['answer', 'clarify', 'refuse'], intents: 0 };
const act = (extra: Partial<TurnExpect> = {}): TurnExpect => ({ outcomes: ['act'], ...extra });
const on = (extra: Partial<TurnExpect>): TurnExpect => ({ outcomes: ['confirm'], ...extra });

const uk = (row: Omit<HardScenario, 'language' | 'category' | 'world'>): HardScenario => ({ ...row, language: 'uk', category: 'H', world: 'office' });
const en = (row: Omit<HardScenario, 'language' | 'category' | 'world'>): HardScenario => ({ ...row, language: 'en', category: 'H', world: 'en-office' });

const UK: HardScenario[] = [
  uk({
    id: 'h-01', family: 'three-operations-one-breath', invariant: 'a create, a Later-task update and a reminder update stay in one preview and apply together',
    turns: [
      { utterance: 'додай задачу чай, перенеси звіт на вівторок о 10:00 і нагадування про оренду постав на 20:00', expect: on({ taskId: 'task-report', includes: '10:00', intents: 3, forbidTaskId: 'task-finance' }) },
      { utterance: 'так', expect: act({ intents: 3 }) },
    ],
  }),
  uk({
    id: 'h-02', family: 'sequential-corrections', invariant: 'three corrections of one move keep one target and end on Friday 14:00',
    turns: [
      { utterance: 'перенеси нараду з клієнтом щодо бюджету на четвер', expect: on({ taskId: 'task-client-2', includes: '2026-10-22', forbidTaskId: 'task-client' }) },
      { utterance: 'на 14:00', expect: on({ taskId: 'task-client-2', includes: '14:00', forbidTaskId: 'task-client', intents: 1 }) },
      { utterance: 'ні, краще на п\'ятницю о 14:00', expect: on({ taskId: 'task-client-2', includes: '2026-10-23', forbidTaskId: 'task-client', intents: 1 }) },
      { utterance: 'так', expect: act({ taskId: 'task-client-2', includes: '14:00', forbidTaskId: 'task-client' }) },
    ],
  }),
  uk({
    id: 'h-03', family: 'correct-one-keep-other', invariant: 'each correction touches one pending create and the other survives to Apply',
    turns: [
      { utterance: 'додай задачу купити подарунок і задачу написати лист', expect: on({ nameIncludes: 'лист', intents: 2 }) },
      { utterance: 'лист на завтра о 09:00', expect: on({ nameIncludes: 'лист', includes: '09:00', intents: 2 }) },
      { utterance: 'подарунок у суботу', expect: on({ nameIncludes: 'подарун', includes: '2026-10-24', intents: 2 }) },
      { utterance: 'так', expect: act({ intents: 2 }) },
    ],
  }),
  uk({
    id: 'h-04', family: 'create-move-drop-apply', invariant: 'dropping the create leaves only the dentist move, which applies',
    turns: [
      { utterance: 'додай задачу прибрати гараж на суботу о 11:00', expect: on({ nameIncludes: 'гараж', includes: '11:00' }) },
      { utterance: 'і стоматолога перенеси на п\'ятницю о 16:00', expect: on({ taskId: 'task-dentist', includes: '16:00', intents: 2 }) },
      { utterance: 'гараж не треба', expect: on({ taskId: 'task-dentist', includes: '16:00', intents: 1 }) },
      { utterance: 'так', expect: act({ taskId: 'task-dentist', intents: 1 }) },
    ],
  }),
  uk({
    id: 'h-05', family: 'context-reference-after-read', invariant: 'the pronoun after a question is the dentist, moved by one hour on its own day',
    turns: [
      { utterance: 'о котрій у мене стоматолог?', expect: read, note: 'Thursday 15:00' },
      { utterance: 'перенеси його на годину пізніше', expect: on({ taskId: 'task-dentist', includes: '16:00' }) },
      { utterance: 'так', expect: act({ taskId: 'task-dentist' }) },
    ],
  }),
  uk({
    id: 'h-06', family: 'ambiguous-then-settled', invariant: 'the plain client meeting is never completed',
    turns: [
      { utterance: 'закрий нараду', expect: clarify },
      { utterance: 'ту, що про бюджет', expect: on({ taskId: 'task-client-2', action: 'complete', forbidTaskId: 'task-client' }) },
      { utterance: 'так', expect: act({ taskId: 'task-client-2', forbidTaskId: 'task-client' }) },
    ],
  }),
  uk({
    id: 'h-07', family: 'occurrence-then-following', invariant: 'one day moves within its day; the rest of the series changes from Monday on',
    turns: [
      { utterance: 'спортзал у середу перенеси на 19:00', expect: on({ taskId: 'task-gym', includes: '19:00', action: 'move' }) },
      { utterance: 'а з наступного понеділка хай буде о 08:00', expect: { outcomes: ['confirm', 'clarify'], taskId: 'task-gym', includes: '08:00' }, note: 'the following scope needs a day in the series; 26 Oct is beyond the two placed days, so a question is acceptable' },
    ],
  }),
  uk({
    id: 'h-08', family: 'later-schedule-then-unschedule', invariant: 'the report ends in Later, not on Thursday',
    turns: [
      { utterance: 'звіт постав на четвер о 09:00', expect: on({ taskId: 'task-report', includes: '09:00', action: 'update', forbidTaskId: 'task-finance' }) },
      { utterance: 'ні, зніми з нього час, хай висить без години', expect: on({ taskId: 'task-report', unscheduled: true, forbidTaskId: 'task-finance' }) },
      { utterance: 'так', expect: act({ taskId: 'task-report', unscheduled: true }) },
    ],
  }),
  uk({
    id: 'h-09', family: 'reminder-day-and-clock', invariant: 'the stored reminder moves to 22 October 19:30, no task is created',
    turns: [
      { utterance: 'нагадування про оренду перенеси на 22 жовтня о 19:30', expect: on({ taskId: 'rem-rent', includes: '19:30', action: 'remind_update', intents: 1 }) },
      { utterance: 'так', expect: act({ taskId: 'rem-rent' }) },
    ],
  }),
  uk({
    id: 'h-10', family: 'drop-then-change-mind', invariant: 'the dropped coffee comes back as a task and tea is never lost',
    turns: [
      { utterance: 'додай чай і каву на завтра о 10:00', expect: on({ nameIncludes: 'чай', intents: 2, includes: '10:00' }) },
      { utterance: 'каву прибери', expect: on({ nameIncludes: 'чай', intents: 1 }) },
      { utterance: 'а ні, каву теж додай, на 11:00', expect: on({ nameIncludes: 'кав', intents: 2, includes: '11:00' }) },
      { utterance: 'так', expect: act({ intents: 2 }) },
    ],
  }),
  uk({
    id: 'h-11', family: 'contradiction-in-one-sentence', invariant: 'a move and a delete of the same task in one breath is a question, never both',
    turns: [{ utterance: 'перенеси звіт на понеділок і одночасно видали його', expect: { outcomes: ['clarify', 'refuse', 'confirm'], forbidTaskId: 'task-finance' }, note: 'confirm is acceptable only with a single operation; the scorer cannot check that here — reviewed by hand' }],
  }),
  uk({
    id: 'h-12', family: 'long-dialogue-read-write', invariant: 'two reads, a move with a reminder about it, one apply, a thanks that writes nothing',
    turns: [
      { utterance: 'що в мене в понеділок?', expect: read },
      { utterance: 'а у вівторок?', expect: read },
      { utterance: 'нараду щодо бюджету посунь на 15:00', expect: on({ taskId: 'task-client-2', includes: '15:00', forbidTaskId: 'task-client' }) },
      { utterance: 'і нагадай мені про неї о 14:30', expect: on({ includes: '14:30', intents: 2 }) },
      { utterance: 'так', expect: act({ intents: 2 }) },
      { utterance: 'дякую', expect: noWrite },
    ],
  }),
  uk({
    id: 'h-13', family: 'colloquial-two-series-days', invariant: 'Monday is skipped and Wednesday moves to 19:00, the series stays',
    turns: [
      { utterance: 'слухай, спортзал у понеділок я пропускаю, а в середу давай о сьомій вечора', expect: on({ taskId: 'task-gym', includes: '19:00', intents: 2 }) },
      { utterance: 'так', expect: act({ intents: 2 }) },
    ],
  }),
  uk({
    id: 'h-14', family: 'refuse-not-guess', invariant: 'no bulk delete without a set, no series move to another day',
    turns: [
      { utterance: 'видали всі зустрічі', expect: { outcomes: ['clarify', 'refuse', 'answer'], intents: 0 } },
      { utterance: 'перенеси спортзал на вівторок', expect: clarify },
    ],
  }),
  uk({
    id: 'h-15', family: 'double-confirm', invariant: 'a second and third yes create nothing',
    turns: [
      { utterance: 'додай задачу чай', expect: on({ nameIncludes: 'чай', unscheduled: true }) },
      { utterance: 'так', expect: act({ nameIncludes: 'чай' }) },
      { utterance: 'так', expect: noWrite },
      { utterance: 'ще раз так', expect: { outcomes: ['answer', 'refuse', 'clarify'], intents: 0 } },
    ],
  }),
  uk({
    id: 'h-16', family: 'own-calendar-event-move', invariant: 'the flight moves through its provider event; nothing is created',
    turns: [
      { utterance: 'політ до Львова перенеси на суботу о 08:00', expect: on({ taskId: 'ext-lviv', includes: '08:00', intents: 1 }) },
      { utterance: 'так', expect: act({ taskId: 'ext-lviv' }) },
    ],
  }),
  uk({
    id: 'h-17', family: 'later-window', invariant: 'a Later task with "after 15:00 tomorrow" gets a window on Monday, no invented start',
    turns: [{ utterance: 'звіт зроби завтра, але не раніше 15:00', expect: on({ taskId: 'task-report', includes: '15:00', action: 'update', forbidTaskId: 'task-finance' }) }],
  }),
  uk({
    id: 'h-18', family: 'fixed-date-only', invariant: 'a fixed event given only a day keeps its clock',
    turns: [{ utterance: 'стоматолога перестав на понеділок', expect: on({ taskId: 'task-dentist', includes: '15:00', action: 'update' }) }],
  }),
  uk({
    id: 'h-19', family: 'two-corrections-two-targets', invariant: 'each correction lands on its own pending operation',
    turns: [
      { utterance: 'нараду з клієнтом посунь на 14:00, а нараду щодо бюджету на 16:00', expect: on({ intents: 2, includes: '14:00' }) },
      { utterance: 'бюджетну краще на 17:00', expect: on({ taskId: 'task-client-2', includes: '17:00', intents: 2 }) },
      { utterance: 'так', expect: act({ intents: 2 }) },
    ],
  }),
  uk({
    id: 'h-20', family: 'cancel-mid-dialogue-then-new', invariant: 'after a cancel, a later yes writes nothing and a new command starts clean',
    turns: [
      { utterance: 'видали фінансовий звіт', expect: on({ taskId: 'task-finance', forbidTaskId: 'task-report' }) },
      { utterance: 'ні', expect: { ...noWrite, pendingCount: 0 } },
      { utterance: 'так', expect: noWrite },
      { utterance: 'нагадай про оренду завтра о 09:00', expect: on({ includes: '09:00' }), note: 'a new reminder or an update of the stored one are both acceptable' },
    ],
  }),
];

const EN: HardScenario[] = [
  en({
    id: 'he-01', family: 'three-operations-one-breath', invariant: 'a create, a Later-task update and a reminder update in one preview',
    turns: [
      { utterance: 'add a task tea, put the quarterly report on Tuesday at 10 and set the rent reminder to 8pm', expect: on({ taskId: 'task-report', includes: '10:00', intents: 3, forbidTaskId: 'task-finance' }) },
      { utterance: 'yes', expect: act({ intents: 3 }) },
    ],
  }),
  en({
    id: 'he-02', family: 'sequential-corrections', invariant: 'one target through three corrections',
    turns: [
      { utterance: 'move the budget meeting to Thursday', expect: on({ taskId: 'task-client-2', includes: '2026-10-22', forbidTaskId: 'task-client' }) },
      { utterance: 'make it 2pm', expect: on({ taskId: 'task-client-2', includes: '14:00', intents: 1 }) },
      { utterance: 'no, Friday at 2pm', expect: on({ taskId: 'task-client-2', includes: '2026-10-23', intents: 1 }) },
      { utterance: 'yes', expect: act({ taskId: 'task-client-2', includes: '14:00' }) },
    ],
  }),
  en({
    id: 'he-03', family: 'correct-one-keep-other', invariant: 'the gift survives the letter correction',
    turns: [
      { utterance: 'add buy a gift and write the letter', expect: on({ nameIncludes: 'letter', intents: 2 }) },
      { utterance: 'the letter tomorrow at 9', expect: on({ nameIncludes: 'letter', includes: '09:00', intents: 2 }) },
      { utterance: 'yes', expect: act({ intents: 2 }) },
    ],
  }),
  en({
    id: 'he-04', family: 'colloquial-two-series-days', invariant: 'skip Monday, move Wednesday to 7pm',
    turns: [
      { utterance: "skip Monday's gym and move Wednesday's to 7pm", expect: on({ taskId: 'task-gym', includes: '19:00', intents: 2 }) },
      { utterance: 'yes', expect: act({ intents: 2 }) },
    ],
  }),
  en({
    id: 'he-05', family: 'ambiguous-then-settled', invariant: 'the plain client meeting is never completed',
    turns: [
      { utterance: 'close the meeting', expect: clarify },
      { utterance: 'the budget one', expect: on({ taskId: 'task-client-2', action: 'complete', forbidTaskId: 'task-client' }) },
      { utterance: 'yes', expect: act({ taskId: 'task-client-2', forbidTaskId: 'task-client' }) },
    ],
  }),
  en({
    id: 'he-06', family: 'refuse-not-guess', invariant: 'no bulk delete, no series moved to another day',
    turns: [
      { utterance: 'delete everything for next week', expect: { outcomes: ['clarify', 'refuse', 'answer'], intents: 0 } },
      { utterance: 'move the gym to Tuesday', expect: clarify },
    ],
  }),
  en({
    id: 'he-07', family: 'context-reference-after-read', invariant: 'it is the dentist',
    turns: [
      { utterance: 'when is the dentist?', expect: read },
      { utterance: 'move it to 4pm', expect: on({ taskId: 'task-dentist', includes: '16:00' }) },
      { utterance: 'yes', expect: act({ taskId: 'task-dentist' }) },
    ],
  }),
  en({
    id: 'he-08', family: 'own-calendar-event-move', invariant: 'the flight is a provider event, not a new task',
    turns: [{ utterance: 'move the flight to Lviv to Saturday 8am', expect: on({ taskId: 'ext-lviv', includes: '08:00', intents: 1 }) }],
  }),
  en({
    id: 'he-09', family: 'drop-then-change-mind', invariant: 'tea is never lost; coffee comes back',
    turns: [
      { utterance: 'add tea and coffee tomorrow at 10', expect: on({ nameIncludes: 'tea', intents: 2, includes: '10:00' }) },
      { utterance: 'drop the coffee', expect: on({ nameIncludes: 'tea', intents: 1 }) },
      { utterance: 'actually keep the coffee too, at 11', expect: on({ nameIncludes: 'coffee', intents: 2, includes: '11:00' }) },
      { utterance: 'yes', expect: act({ intents: 2 }) },
    ],
  }),
  en({
    id: 'he-10', family: 'later-schedule-then-unschedule', invariant: 'the report ends in Later',
    turns: [
      { utterance: 'put the quarterly report on Thursday at 9', expect: on({ taskId: 'task-report', includes: '09:00', action: 'update', forbidTaskId: 'task-finance' }) },
      { utterance: 'no, take the time off it, leave it without a time', expect: on({ taskId: 'task-report', unscheduled: true }) },
      { utterance: 'yes', expect: act({ taskId: 'task-report', unscheduled: true }) },
    ],
  }),
];

export const HARD_SCENARIOS: HardScenario[] = [...UK, ...EN];
