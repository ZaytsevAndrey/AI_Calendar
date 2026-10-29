/**
 * Independent holdout frozen before the first Phase 4.7.8 holdout call.
 * Utterances are paraphrases. They are not copies of the frozen 4.7.7 suite.
 * Expectations describe the product contract, not a later model transcript.
 */
import type { LiveConversation, LiveSingle } from './phase477-fixtures';
import type { TurnExpect } from './phase477-score';

const confirm = (nameIncludes: string, extra: Partial<TurnExpect> = {}): TurnExpect => ({
  outcomes: ['confirm'],
  nameIncludes,
  ...extra,
});

const clarify: TurnExpect = { outcomes: ['clarify', 'refuse'], clarificationRequired: true, intents: 0 };
const noPending: TurnExpect = { outcomes: ['answer', 'refuse', 'clarify'], intents: 0 };

export const HOLDOUT_SINGLES: LiveSingle[] = [
  { id: 'h-s-lamp', utterance: 'Кинь у список задачу купити лампочку, без календарної дати.', world: 'empty', expect: confirm('лампоч', { unscheduled: true }) },
  { id: 'h-s-books', utterance: 'Запиши на 22 жовтня задачу віднести книжки.', world: 'empty', expect: confirm('книж', { includes: '2026-10-22' }) },
  { id: 'h-s-keys', utterance: 'О 14:15 21 жовтня постав задачу здати ключі.', world: 'empty', expect: confirm('ключ', { includes: '14:15' }) },
  { id: 'h-s-internet', utterance: '20 жовтня нагадай оплатити інтернет.', world: 'empty', expect: confirm('інтернет', { includes: '2026-10-20' }) },
  { id: 'h-s-dog', utterance: 'Нагадай 19 жовтня о 07:45 вигуляти пса.', world: 'empty', expect: confirm('пса', { includes: '07:45' }) },
  { id: 'h-s-ficus', utterance: 'Задача без годинника: полити фікус.', world: 'empty', expect: confirm('фікус', { unscheduled: true }) },
  { id: 'h-s-remove-report', utterance: 'Прибери зі списку звіт.', world: 'one-report', expect: { outcomes: ['confirm'], taskId: 'task-report' } },
  { id: 'h-s-which-report', utterance: 'Заверши звіт.', expect: { ...clarify, forbidTaskId: 'task-finance' } },
  { id: 'h-s-afternoon', utterance: 'Зсунь післяобідню зустріч із дизайнером на 22 жовтня о 16:30.', expect: { outcomes: ['confirm'], taskId: 'design-pm', includes: '16:30', forbidTaskId: 'design-am' } },
  { id: 'h-s-flight-locked', utterance: 'Зміни час польоту на 19 жовтня о 18:00.', world: 'readonly-flight', expect: { outcomes: ['clarify', 'refuse'], clarificationRequired: true, forbidTaskId: 'ext-flight' } },
  { id: 'h-s-flight-open', utterance: 'Зміни час польоту на 19 жовтня о 18:00.', world: 'writable-flight', expect: { outcomes: ['confirm'], taskId: 'ext-flight-w', includes: '18:00' } },
  { id: 'h-s-after-meeting', utterance: 'Постав звіт одразу після зустрічі з клієнтом.', world: 'one-report', expect: { outcomes: ['clarify', 'refuse'], clarificationRequired: true } },
  { id: 'h-s-invent-gap', utterance: 'Закинь щось у найближчий вільний проміжок.', world: 'empty', expect: clarify },
  { id: 'h-s-weekly-note', utterance: 'На п\'ятницю постав задачу написати підсумок тижня.', world: 'empty', expect: confirm('підсум', { includes: '2026-10-23' }) },
  { id: 'h-s-budget-year', utterance: 'Додай задачу бюджет 2026 без дати.', world: 'empty', expect: confirm('2026', { unscheduled: true }) },
  { id: 'h-s-stamps', utterance: 'Add an unscheduled task: buy stamps.', world: 'empty', expect: confirm('stamps', { unscheduled: true }) },
  { id: 'h-s-shift-report', utterance: 'Shift the report to Thursday.', world: 'one-report', expect: { outcomes: ['confirm'], taskId: 'task-report', includes: '2026-10-22' } },
  { id: 'h-s-mark-done', utterance: 'Познач звіт виконаним.', world: 'one-report', expect: { outcomes: ['confirm'], taskId: 'task-report' } },
  { id: 'h-s-yoga', utterance: 'Завтра о 11:20 задача йога на 45 хвилин.', world: 'empty', expect: confirm('йога', { includes: '11:20' }) },
  { id: 'h-s-revised-clock', utterance: 'Постав звіт на 21 жовтня о 13:00, стоп, хай буде 17:10.', world: 'one-report', expect: { outcomes: ['confirm'], taskId: 'task-report', includes: '17:10' } },
  { id: 'h-s-agenda', utterance: 'Який у мене розклад на сьогодні?', expect: { outcomes: ['answer', 'clarify'] } },
  { id: 'h-s-nearest', utterance: 'Яка найближча подія?', expect: { outcomes: ['answer', 'clarify'] } },
  { id: 'h-s-windows', utterance: 'Де завтра є вільні вікна?', expect: { outcomes: ['answer', 'clarify'] } },
  { id: 'h-s-april', utterance: 'Створи задачу архів на 31 квітня.', world: 'empty', expect: { outcomes: ['clarify', 'refuse'], clarificationRequired: true } },
  { id: 'h-s-early', utterance: 'Постав дзвінок на 06:15.', world: 'empty', expect: clarify },
  { id: 'h-s-spring-forward', utterance: 'Заплануй дзвінок 8 березня 2026 на 02:15.', world: 'empty', zone: 'America/New_York', nowIso: '2026-03-08T06:00:00.000Z', expect: { outcomes: ['clarify', 'refuse'], clarificationRequired: true } },
  { id: 'h-s-balcony', utterance: 'У неділю додай задачу прибрати балкон.', world: 'empty', expect: confirm('балкон', { includes: '2026-10-25' }) },
  { id: 'h-s-every-report', utterance: 'Видали кожну задачу, яка зветься Звіт.', world: 'one-report', expect: { outcomes: ['confirm'], taskId: 'task-report' } },
  { id: 'h-s-which-client', utterance: 'Скасуй нараду з клієнтом.', expect: clarify },
  { id: 'h-s-untitled', utterance: 'Створи щось нове.', world: 'empty', expect: clarify },
  { id: 'h-s-idle-cancel', utterance: 'Відміна.', world: 'empty', expect: noPending },
  { id: 'h-s-idle-yes', utterance: 'Ок, підтверджую.', world: 'empty', expect: noPending },
  { id: 'h-s-archive', utterance: 'Закрий архів.', world: 'done', expect: clarify },
  { id: 'h-s-unknown-medicine', utterance: 'Закрий medicine.', world: 'one-report', expect: clarify },
  { id: 'h-s-leave-finance', utterance: 'Фінансовий звіт не чіпай. Закрий звичайний.', expect: { outcomes: ['confirm', 'clarify'], forbidTaskId: 'task-finance' } },
  { id: 'h-s-weekly-mail', utterance: 'Нагадуй щопонеділка перевіряти пошту.', world: 'empty', expect: clarify },
  { id: 'h-s-weekly-mail-start', utterance: 'З 19 жовтня щопонеділка о 08:15 нагадуй перевіряти пошту.', world: 'empty', expect: confirm('пошт') },
  { id: 'h-s-stretch', utterance: 'Завтра ввечері додай задачу розтяжка, це не план дня.', world: 'empty', expect: confirm('розтяж') },
  { id: 'h-s-sketch-day', utterance: 'Склади мені день на завтра.', world: 'empty', expect: { outcomes: ['clarify', 'confirm', 'answer'] } },
  { id: 'h-s-insurance', utterance: 'Додай задачу страховка і в описі напиши: порівняти тарифи.', world: 'empty', expect: confirm('страхов') },
];

function turns(rows: Array<[string, TurnExpect]>): LiveConversation['turns'] {
  return rows.map(([utterance, expect]) => ({ utterance, expect }));
}

export const HOLDOUT_CONVERSATIONS: LiveConversation[] = [
  {
    id: 'h-c-clock',
    world: 'empty',
    turns: turns([
      ['Нагадай 21 жовтня о 08:00 про вітаміни.', confirm('вітамін', { includes: '08:00' })],
      ['Краще о 08:45.', confirm('вітамін', { includes: '08:45' })],
      ['Так.', { outcomes: ['act'], nameIncludes: 'вітамін', includes: '08:45' }],
    ]),
  },
  {
    id: 'h-c-yes-but',
    world: 'one-report',
    turns: turns([
      ['Перенеси звіт на середу.', { outcomes: ['confirm'], taskId: 'task-report' }],
      ['Так, але тільки на четвер.', { outcomes: ['confirm'], taskId: 'task-report', includes: '2026-10-22' }],
    ]),
  },
  {
    id: 'h-c-unparsed',
    world: 'empty',
    turns: turns([
      ['Додай задачу лампа.', confirm('лампа', { unscheduled: true })],
      ['перенеси це інакше', { outcomes: ['clarify', 'refuse', 'confirm'] }],
      ['Так.', { outcomes: ['clarify', 'refuse', 'answer'], intents: 0 }],
    ]),
  },
  {
    id: 'h-c-cancel-yes',
    world: 'one-report',
    turns: turns([
      ['Видали звіт, будь ласка.', { outcomes: ['confirm'], taskId: 'task-report' }],
      ['Ні, залиш як є.', noPending],
      ['Так.', noPending],
    ]),
  },
  {
    id: 'h-c-read-then-yes',
    world: 'one-report',
    turns: turns([
      ['Перенеси звіт на 21 жовтня о 12:40.', { outcomes: ['confirm'], taskId: 'task-report', includes: '12:40' }],
      ['А який сьогодні розклад?', { outcomes: ['answer', 'clarify'] }],
      ['Так.', { outcomes: ['act'], taskId: 'task-report', includes: '12:40' }],
    ]),
  },
  {
    id: 'h-c-other-meeting',
    turns: turns([
      ['Познач виконаною ранкову зустріч із дизайнером.', { outcomes: ['confirm'], taskId: 'design-am', forbidTaskId: 'design-pm' }],
      ['Ні, ту після обіду.', { outcomes: ['confirm'], taskId: 'design-pm', forbidTaskId: 'design-am' }],
    ]),
  },
  {
    id: 'h-c-draft-yoga',
    world: 'empty',
    turns: turns([
      ['Давай зберемо план на завтра.', { outcomes: ['clarify', 'confirm', 'answer'] }],
      ['Додай у цей план вечірню йогу.', { outcomes: ['confirm', 'clarify'], draftIncludes: 'йог' }],
    ]),
  },
  {
    id: 'h-c-tape',
    world: 'empty',
    turns: turns([
      ['Давай зберемо план на завтра.', { outcomes: ['clarify', 'confirm', 'answer'] }],
      ['Окремо, не в план: купити скотч.', confirm('скотч')],
    ]),
  },
  {
    id: 'h-c-two-gaps',
    turns: turns([
      ['Перенеси зустріч із дизайнером на завтра і нагадай щопонеділка перевіряти звіт.', { outcomes: ['clarify'], clarificationRequired: true }],
    ]),
  },
  {
    id: 'h-c-first',
    turns: turns([
      ['Закрий звіт.', clarify],
      ['Першу.', { outcomes: ['confirm', 'clarify'] }],
    ]),
  },
  {
    id: 'h-c-other-report',
    turns: turns([
      ['Закрий звіт.', clarify],
      ['Не цей, а фінансовий.', { outcomes: ['confirm'], taskId: 'task-finance', forbidTaskId: 'task-report' }],
    ]),
  },
  {
    id: 'h-c-shorter',
    world: 'one-report',
    turns: turns([
      ['Зроби звіт на годину 21 жовтня о 10:00.', { outcomes: ['confirm'], taskId: 'task-report' }],
      ['Хай буде 40 хвилин.', { outcomes: ['confirm'], taskId: 'task-report', includes: '40' }],
    ]),
  },
  {
    id: 'h-c-rename',
    world: 'empty',
    turns: turns([
      ['Додай задачу лист.', confirm('лист', { unscheduled: true })],
      ['Перейменуй її на лист адвокату.', confirm('адвокат')],
    ]),
  },
  {
    id: 'h-c-second-yes',
    world: 'one-report',
    turns: turns([
      ['Прибери звіт.', { outcomes: ['confirm'], taskId: 'task-report' }],
      ['Так.', { outcomes: ['act'], taskId: 'task-report' }],
      ['Так.', noPending],
    ]),
  },
  {
    id: 'h-c-thursday',
    world: 'one-report',
    turns: turns([
      ['Move the report to Wednesday.', { outcomes: ['confirm'], taskId: 'task-report' }],
      ['No, Thursday.', { outcomes: ['confirm'], taskId: 'task-report', includes: '2026-10-22' }],
    ]),
  },
  {
    id: 'h-c-english-yes',
    world: 'empty',
    turns: turns([
      ['Додай задачу чай без дати.', confirm('чай', { unscheduled: true })],
      ['Yes, confirm.', { outcomes: ['act'], nameIncludes: 'чай' }],
    ]),
  },
  {
    id: 'h-c-no-clock-invent',
    world: 'one-report',
    turns: turns([
      ['Постав звіт після наради, час не вигадуй.', { outcomes: ['clarify', 'refuse'], clarificationRequired: true }],
      ['Тоді просто на 21 жовтня о 17:20.', { outcomes: ['confirm'], taskId: 'task-report', includes: '17:20' }],
    ]),
  },
  {
    id: 'h-c-drop-one',
    world: 'empty',
    turns: turns([
      ['Додай задачу сік і задачу печиво.', { outcomes: ['confirm'], nameIncludes: 'сік' }],
      ['Печиво скасуй, сік залиш.', { outcomes: ['confirm', 'clarify'], nameIncludes: 'сік' }],
    ]),
  },
  {
    id: 'h-c-new-after-cancel',
    world: 'one-report',
    turns: turns([
      ['Перенеси звіт на п\'ятницю.', { outcomes: ['confirm'], taskId: 'task-report' }],
      ['Скасуй цю зміну.', noPending],
      ['Додай задачу зарядка без дати.', confirm('заряд', { unscheduled: true })],
    ]),
  },
  {
    id: 'h-c-draft-question',
    world: 'empty',
    turns: turns([
      ['Давай зберемо план на завтра.', { outcomes: ['clarify', 'confirm', 'answer'] }],
      ['Додай у цей план пробіжку.', { outcomes: ['confirm', 'clarify'], draftIncludes: 'пробіж' }],
      ['Які завтра вільні проміжки?', { outcomes: ['answer', 'clarify'] }],
    ]),
  },
];
