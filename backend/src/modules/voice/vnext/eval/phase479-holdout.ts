/**
 * Fresh Phase 4.7.9 holdout. Frozen before its first model call.
 * Paraphrases of the 4.7.9 failure classes. Not copies of the frozen or 4.7.8 holdout utterances.
 * Expectations are the product contract. Do not edit them after the first fresh run.
 */
import type { LiveConversation, LiveSingle } from './phase477-fixtures';
import type { TurnExpect } from './phase477-score';

const confirm = (nameIncludes: string, extra: Partial<TurnExpect> = {}): TurnExpect => ({
  outcomes: ['confirm'],
  nameIncludes,
  ...extra,
});

const clarify: TurnExpect = { outcomes: ['clarify', 'refuse'], clarificationRequired: true, intents: 0 };
const noWrite: TurnExpect = { outcomes: ['answer', 'refuse', 'clarify'], intents: 0 };

export const FRESH_SINGLES: LiveSingle[] = [
  { id: 'f-s-add-same-title', utterance: 'Додай окрему задачу звіт, навіть якщо така вже є.', world: 'one-report', expect: confirm('звіт', { unscheduled: true, forbidTaskId: 'task-report' }) },
  { id: 'f-s-move-only', utterance: 'Пересунь наявний звіт на 23 жовтня.', world: 'one-report', expect: { outcomes: ['confirm'], taskId: 'task-report', includes: '2026-10-23' } },
  { id: 'f-s-existing-hour', utterance: 'Постав наявний звіт на 21 жовтня о 11:40 на півтори години.', world: 'one-report', expect: { outcomes: ['confirm'], taskId: 'task-report', includes: '11:40' } },
  { id: 'f-s-project-42', utterance: 'Додай задачу проєкт 42 без дати.', world: 'empty', expect: confirm('42', { unscheduled: true }) },
  { id: 'f-s-react', utterance: 'Додай задачу React 19.', world: 'empty', expect: confirm('19', { unscheduled: true }) },
  { id: 'f-s-q4', utterance: 'Додай задачу план Q4.', world: 'empty', expect: confirm('Q4', { unscheduled: true }) },
  { id: 'f-s-tickets', utterance: 'Купити 2 квитки — додай як задачу без дати.', world: 'empty', expect: confirm('квит', { unscheduled: true }) },
  { id: 'f-s-nineteen', utterance: 'Зустріч о 19:00 — додай задачу на 21 жовтня.', world: 'empty', expect: confirm('зустріч', { includes: '19:00' }) },
  { id: 'f-s-bare-type', utterance: 'Створи задачу.', world: 'empty', expect: clarify },
  { id: 'f-s-close-short', utterance: 'Закрий ок.', world: 'empty', expect: clarify },
  { id: 'f-s-dentist', utterance: 'Нагадай мені завдання зателефонувати стоматологу, часу ще немає.', world: 'empty', expect: confirm('стоматолог', { unscheduled: true }) },
  { id: 'f-s-when-one', utterance: 'Коли в мене звіт?', world: 'one-report', expect: { outcomes: ['answer'], intents: 0 } },
  { id: 'f-s-when-two', utterance: 'Коли в мене звіт?', expect: clarify },
  { id: 'f-s-afternoon-move', utterance: 'Перестав післяобідню зустріч дизайнера на 23 жовтня о 15:45.', expect: { outcomes: ['confirm'], taskId: 'design-pm', includes: '15:45', forbidTaskId: 'design-am' } },
  { id: 'f-s-morning-move', utterance: 'Зсунь ранкову зустріч із дизайнером на 22 жовтня о 11:00.', expect: { outcomes: ['confirm'], taskId: 'design-am', includes: '11:00', forbidTaskId: 'design-pm' } },
  { id: 'f-s-readonly', utterance: 'Перестав чужий політ на 19 жовтня о 18:00.', world: 'readonly-flight', expect: { outcomes: ['clarify', 'refuse'], clarificationRequired: true, forbidTaskId: 'ext-flight' } },
  { id: 'f-s-year-title', utterance: 'Додай задачу звіт 2027 без годинника.', world: 'empty', expect: confirm('2027', { unscheduled: true }) },
  { id: 'f-s-friday-report', utterance: 'Звіт перенеси на п\'ятницю.', world: 'one-report', expect: { outcomes: ['confirm'], taskId: 'task-report', includes: '2026-10-23' } },
  { id: 'f-s-forty', utterance: 'Зроби наявний звіт на 40 хвилин 22 жовтня о 09:30.', world: 'one-report', expect: { outcomes: ['confirm'], taskId: 'task-report', includes: '09:30' } },
  { id: 'f-s-english-move', utterance: 'Move the existing report to 21 October at 16:05.', world: 'one-report', expect: { outcomes: ['confirm'], taskId: 'task-report', includes: '16:05' } },
  { id: 'f-s-which-report', utterance: 'Закрий звіт.', expect: clarify },
  { id: 'f-s-finance', utterance: 'Закрий фінансовий звіт.', expect: { outcomes: ['confirm'], taskId: 'task-finance', forbidTaskId: 'task-report' } },
  { id: 'f-s-not-plan', utterance: 'Завтра ввечері додай задачу медитація, окремо від плану дня.', world: 'empty', expect: confirm('медитац') },
  { id: 'f-s-plan-item', utterance: 'Додай у план на післязавтра розминку вранці.', world: 'empty', expect: { outcomes: ['confirm', 'clarify'], draftIncludes: 'розмин' } },
  { id: 'f-s-archive', utterance: 'Закрий архів.', world: 'done', expect: clarify },
  { id: 'f-s-idle-yes', utterance: 'Так.', world: 'empty', expect: noWrite },
  { id: 'f-s-idle-forget', utterance: 'Забудь.', world: 'empty', expect: noWrite },
  { id: 'f-s-bank', utterance: 'Задача подзвонити в банк, поки без часу.', world: 'empty', expect: confirm('банк', { unscheduled: true }) },
  { id: 'f-s-writable-flight', utterance: 'Перенеси політ на 20 жовтня о 12:20.', world: 'writable-flight', expect: { outcomes: ['confirm'], taskId: 'ext-flight-w', includes: '12:20' } },
  { id: 'f-s-no-invent', utterance: 'Постав звіт після наради і не вигадуй годину.', world: 'one-report', expect: { outcomes: ['clarify', 'refuse'], clarificationRequired: true } },
];

function turns(rows: Array<[string, TurnExpect]>): LiveConversation['turns'] {
  return rows.map(([utterance, expect]) => ({ utterance, expect }));
}

export const FRESH_CONVERSATIONS: LiveConversation[] = [
  {
    id: 'f-c-duration',
    world: 'one-report',
    turns: turns([
      ['Зроби звіт на годину 22 жовтня о 09:10.', { outcomes: ['confirm'], taskId: 'task-report', includes: '09:10' }],
      ['Не годину, а 75 хвилин.', { outcomes: ['confirm'], taskId: 'task-report', includes: '75' }],
    ]),
  },
  {
    id: 'f-c-replace',
    world: 'one-report',
    turns: turns([
      ['Перенеси звіт на п\'ятницю.', { outcomes: ['confirm'], taskId: 'task-report' }],
      ['Краще познач його виконаним.', { outcomes: ['confirm'], taskId: 'task-report' }],
    ]),
  },
  {
    id: 'f-c-drop-tea',
    world: 'empty',
    turns: turns([
      ['Додай задачу чай і задачу кава.', { outcomes: ['confirm'], nameIncludes: 'чай' }],
      ['Кава не треба, чай залиш.', { outcomes: ['confirm'], nameIncludes: 'чай' }],
    ]),
  },
  {
    id: 'f-c-rename',
    world: 'empty',
    turns: turns([
      ['Додай задачу нотатка.', confirm('нотат', { unscheduled: true })],
      ['Перейменуй її на нотатка для адвоката.', confirm('адвокат')],
    ]),
  },
  {
    id: 'f-c-yes-friday',
    world: 'one-report',
    turns: turns([
      ['Перенеси звіт на середу.', { outcomes: ['confirm'], taskId: 'task-report' }],
      ['Так, але тільки на п\'ятницю.', { outcomes: ['confirm'], taskId: 'task-report', includes: '2026-10-23' }],
    ]),
  },
  {
    id: 'f-c-batteries',
    world: 'empty',
    turns: turns([
      ['Давай зберемо план на завтра.', { outcomes: ['clarify', 'confirm', 'answer'] }],
      ['Окремо, не в план: купити батарейки.', confirm('батаре')],
    ]),
  },
  {
    id: 'f-c-then-clock',
    world: 'one-report',
    turns: turns([
      ['Постав звіт після обіду, годинник не вигадуй.', { outcomes: ['clarify', 'refuse'], clarificationRequired: true }],
      ['Тоді просто на 22 жовтня о 18:05.', { outcomes: ['confirm'], taskId: 'task-report', includes: '18:05' }],
    ]),
  },
  {
    id: 'f-c-readonly-yes',
    world: 'readonly-flight',
    turns: turns([
      ['Перенеси політ на 21 жовтня о 13:10.', { outcomes: ['clarify', 'refuse'], clarificationRequired: true, forbidTaskId: 'ext-flight' }],
      ['Так.', noWrite],
    ]),
  },
  {
    id: 'f-c-remove-walk',
    world: 'empty',
    turns: turns([
      ['Допоможи спланувати завтра.', { outcomes: ['clarify', 'confirm', 'answer'] }],
      ['Додай прогулянку ввечері.', { outcomes: ['confirm', 'clarify'], draftIncludes: 'прогулян' }],
      ['Прибери прогулянку.', { outcomes: ['confirm', 'clarify', 'answer'] }],
    ]),
  },
  {
    id: 'f-c-cancel-new',
    world: 'empty',
    turns: turns([
      ['Додай задачу вода без дати.', confirm('вода', { unscheduled: true })],
      ['Скасуй це.', noWrite],
      ['Додай задачу сік без дати.', confirm('сік', { unscheduled: true })],
    ]),
  },
  {
    id: 'f-c-two-gaps',
    turns: turns([
      ['Перенеси зустріч із дизайнером на п\'ятницю і нагадуй щовівторка про звіт.', { outcomes: ['clarify'], clarificationRequired: true }],
    ]),
  },
  {
    id: 'f-c-switch-report',
    turns: turns([
      ['Закрий звіт.', clarify],
      ['Ні, фінансовий.', { outcomes: ['confirm'], taskId: 'task-finance', forbidTaskId: 'task-report' }],
    ]),
  },
  {
    id: 'f-c-vitamins',
    world: 'empty',
    turns: turns([
      ['Нагадай 22 жовтня о 08:10 про вітаміни.', confirm('вітамін', { includes: '08:10' })],
      ['Краще о 08:50.', confirm('вітамін', { includes: '08:50' })],
      ['Так.', { outcomes: ['act'], nameIncludes: 'вітамін', includes: '08:50' }],
    ]),
  },
  {
    id: 'f-c-budget-rename',
    world: 'empty',
    turns: turns([
      ['Додай задачу бюджет 2026.', confirm('2026', { unscheduled: true })],
      ['Перейменуй її на кошторис 2026.', confirm('кошторис')],
    ]),
  },
  {
    id: 'f-c-split-route',
    world: 'empty',
    turns: turns([
      ['Давай зберемо план на завтра.', { outcomes: ['clarify', 'confirm', 'answer'] }],
      ['Додай у цей план вечірню йогу і окремо, не в план, задачу купити скотч.', { outcomes: ['confirm', 'clarify'] }],
    ]),
  },
];
