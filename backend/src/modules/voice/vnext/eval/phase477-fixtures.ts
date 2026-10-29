import type { TurnExpect } from './phase477-score';

export type WorldName = 'default' | 'empty' | 'one-report' | 'readonly-flight' | 'writable-flight' | 'done';

export type LiveSingle = {
  id: string;
  utterance: string;
  world?: WorldName;
  zone?: string;
  nowIso?: string;
  expect: TurnExpect;
};

export type LiveConversation = {
  id: string;
  world?: WorldName;
  zone?: string;
  nowIso?: string;
  turns: Array<{ utterance: string; expect: TurnExpect }>;
};

const confirm = (nameIncludes: string, extra: Partial<TurnExpect> = {}): TurnExpect => ({
  outcomes: ['confirm'],
  nameIncludes,
  ...extra,
});

const clarify: TurnExpect = { outcomes: ['clarify', 'refuse'], clarificationRequired: true, intents: 0 };
const noPending: TurnExpect = { outcomes: ['answer', 'refuse'], intents: 0 };

export const LIVE_SINGLES: LiveSingle[] = [
  { id: 's-tea', utterance: 'Додай задачу заварити чай.', world: 'empty', expect: confirm('чай', { unscheduled: true }) },
  { id: 's-dated', utterance: 'Створи задачу купити хліб на 20 жовтня.', world: 'empty', expect: confirm('хліб', { includes: '2026-10-20' }) },
  { id: 's-clock', utterance: 'Постав задачу здати звіт на 21 жовтня о 15:00.', world: 'empty', expect: confirm('звіт', { includes: '15:00' }) },
  { id: 's-two', utterance: 'Додай дві задачі: забрати посилку і полити квіти.', world: 'empty', expect: { outcomes: ['confirm'], nameIncludes: 'посилку' } },
  { id: 's-priority', utterance: 'Додай важливу задачу підготувати презентацію.', world: 'empty', expect: confirm('презентац', { unscheduled: true }) },
  { id: 's-duration', utterance: 'Додай задачу прибирання на півтори години.', world: 'empty', expect: confirm('прибиран', { includes: '90' }) },
  { id: 's-colloquial', utterance: 'Слухай, накинь мені задачу подзвонити мамі, без дати.', world: 'empty', expect: confirm('мам', { unscheduled: true }) },
  { id: 's-english-title', utterance: 'Додай задачу design review.', world: 'empty', expect: confirm('design review', { unscheduled: true }) },
  { id: 's-tomorrow-morning', utterance: 'Завтра зранку треба купити каву.', world: 'empty', expect: confirm('каву') },
  { id: 's-friday', utterance: 'У п\'ятницю зроби follow-up.', world: 'empty', expect: confirm('follow-up', { includes: '2026-10-23' }) },
  { id: 's-call-doctor', utterance: 'Нагадай мені завдання зателефонувати лікарю, поки без часу.', world: 'empty', expect: confirm('лікар', { unscheduled: true }) },
  { id: 's-walk-standalone', utterance: 'Додай до задач прогулянку ввечері.', world: 'empty', expect: confirm('прогулян') },
  { id: 's-rename', utterance: 'Перейменуй звіт на Звіт Q4.', world: 'one-report', expect: { outcomes: ['confirm'], taskId: 'task-report', includes: 'Q4' } },
  { id: 's-complete', utterance: 'Закрий звіт.', world: 'one-report', expect: { outcomes: ['confirm'], taskId: 'task-report' } },
  { id: 's-delete', utterance: 'Видали звіт.', world: 'one-report', expect: { outcomes: ['confirm'], taskId: 'task-report' } },
  { id: 's-move-day', utterance: 'Перенеси звіт на четвер.', world: 'one-report', expect: { outcomes: ['confirm'], taskId: 'task-report', includes: '2026-10-22' } },
  { id: 's-move-clock', utterance: 'Постав звіт на 21 жовтня о 18:00.', world: 'one-report', expect: { outcomes: ['confirm'], taskId: 'task-report', includes: '18:00' } },
  { id: 's-duration-existing', utterance: 'Зроби звіт на годину.', world: 'one-report', expect: { outcomes: ['confirm'], taskId: 'task-report' } },
  { id: 's-ambiguous-report', utterance: 'Закрий звіт.', expect: { ...clarify, forbidTaskId: 'task-finance' } },
  { id: 's-ambiguous-designer', utterance: 'Перенеси зустріч із дизайнером на завтра о 16:00.', expect: clarify },
  { id: 's-unrelated-only', utterance: 'Закрий звіт.', world: 'empty', expect: clarify },
  { id: 's-similar-titles', utterance: 'Видали нараду з клієнтом.', expect: clarify },
  { id: 's-readonly-flight', utterance: 'Перенеси політ на 21 жовтня о 12:00.', world: 'readonly-flight', expect: { outcomes: ['clarify', 'refuse'], clarificationRequired: true, forbidTaskId: 'ext-flight' } },
  { id: 's-writable-flight', utterance: 'Перенеси політ на 21 жовтня о 12:00.', world: 'writable-flight', expect: { outcomes: ['confirm'], taskId: 'ext-flight-w', includes: '12:00' } },
  { id: 's-query-report', utterance: 'Коли в мене звіт?', world: 'one-report', expect: { outcomes: ['answer', 'clarify'] } },
  { id: 's-all-day', utterance: 'Додай на завтра цілий день конференцію.', world: 'empty', expect: confirm('конференц') },
  { id: 's-create-event', utterance: 'Створи зустріч з Олею 20 жовтня о 11:00.', world: 'empty', expect: confirm('Оле', { includes: '11:00' }) },
  { id: 's-reschedule-event', utterance: 'Перенеси ранкову зустріч із дизайнером на 20 жовтня о 11:00.', expect: { outcomes: ['confirm'], taskId: 'design-am', includes: '11:00' } },
  { id: 's-remind-clock', utterance: 'Нагадай 20 жовтня о 08:30 забрати посилку.', world: 'empty', expect: confirm('посилку', { includes: '08:30' }) },
  { id: 's-remind-default', utterance: 'Нагадай 20 жовтня забрати посилку.', world: 'empty', expect: confirm('посилку', { includes: '2026-10-20' }) },
  { id: 's-remind-no-day', utterance: 'Нагадай подзвонити в аптеку.', world: 'empty', expect: clarify },
  { id: 's-remind-daily', utterance: 'Нагадуй щодня пити воду.', world: 'empty', expect: clarify },
  { id: 's-remind-daily-start', utterance: 'З 20 жовтня нагадуй щодня о 09:00 пити воду.', world: 'empty', expect: confirm('воду') },
  { id: 's-remind-vs-task', utterance: 'Це не задача, а нагадування на 20 жовтня о 19:00: вимкнути праску.', world: 'empty', expect: confirm('праску', { includes: '19:00' }) },
  { id: 's-dst-gap', utterance: 'Постав задачу дзвінок на 8 березня 2026 о 02:30.', world: 'empty', zone: 'America/New_York', nowIso: '2026-03-08T06:00:00.000Z', expect: { outcomes: ['clarify', 'refuse'], clarificationRequired: true } },
  { id: 's-dst-fold', utterance: 'Постав задачу дзвінок на 1 листопада 2026 о 01:30.', world: 'empty', zone: 'America/New_York', nowIso: '2026-11-01T05:00:00.000Z', expect: { outcomes: ['clarify', 'refuse'], clarificationRequired: true } },
  { id: 's-plan-tomorrow', utterance: 'Допоможи спланувати завтрашній день.', world: 'empty', expect: { outcomes: ['clarify', 'confirm', 'answer'] } },
  { id: 's-plan-add-evening', utterance: 'Додай у план на завтра прогулянку ввечері.', world: 'empty', expect: { outcomes: ['confirm', 'clarify'], draftIncludes: 'прогулян' } },
  { id: 's-whats-next', utterance: 'Що в мене далі?', expect: { outcomes: ['answer', 'clarify'] } },
  { id: 's-today', utterance: 'Що в мене сьогодні заплановано?', expect: { outcomes: ['answer', 'clarify'] } },
  { id: 's-free-tomorrow', utterance: 'Коли я вільний завтра?', expect: { outcomes: ['answer', 'clarify'] } },
  { id: 's-unfinished', utterance: 'Що в мене ще не зроблено?', expect: { outcomes: ['answer', 'clarify'] } },
  { id: 's-insufficient', utterance: 'А як щодо того?', world: 'empty', expect: clarify },
  { id: 's-past-clock', utterance: 'Постав дзвінок на 07:00.', world: 'empty', expect: clarify },
  { id: 's-invalid-date', utterance: 'Створи задачу звіт на 31 листопада.', world: 'empty', expect: { outcomes: ['clarify', 'refuse'], clarificationRequired: true } },
  { id: 's-ordering', utterance: 'Постав звіт після наради.', world: 'one-report', expect: { outcomes: ['clarify', 'refuse'], clarificationRequired: true, forbidTaskId: 'task-meet' } },
  { id: 's-empty-confirm', utterance: 'Так, підтверджую.', world: 'empty', expect: noPending },
  { id: 's-conflict', utterance: 'Перенеси звіт на четвер і ні, залиш на п\'ятницю.', world: 'one-report', expect: { outcomes: ['confirm', 'clarify'], taskId: 'task-report' } },
  { id: 's-mixed-language', utterance: 'Move the report to Friday.', world: 'one-report', expect: { outcomes: ['confirm'], taskId: 'task-report' } },
  { id: 's-create-and-ask', utterance: 'Що в мене завтра і додай задачу купити молоко.', world: 'empty', expect: { outcomes: ['confirm', 'clarify'], nameIncludes: 'молоко' } },
  { id: 's-move-and-create', utterance: 'Перенеси звіт на четвер і додай задачу купити каву.', world: 'one-report', expect: { outcomes: ['confirm', 'clarify'] } },
  { id: 's-last-wins', utterance: 'Постав звіт на 16:00 21 жовтня, ні, краще на 18:00.', world: 'one-report', expect: { outcomes: ['confirm'], includes: '18:00', taskId: 'task-report' } },
  { id: 's-bulk', utterance: 'Видали всі задачі з назвою Нарада.', expect: { outcomes: ['confirm', 'clarify'] } },
  { id: 's-bulk-one', utterance: 'Видали всі задачі з назвою Звіт.', world: 'one-report', expect: { outcomes: ['confirm'], taskId: 'task-report' } },
  { id: 's-completed', utterance: 'Закрий архів.', world: 'done', expect: clarify },
  { id: 's-short-title', utterance: 'Закрий ок.', world: 'empty', expect: clarify },
  { id: 's-typo', utterance: 'Закрий звті.', world: 'one-report', expect: clarify },
  { id: 's-number-title', utterance: 'Додай задачу звіт 2026.', world: 'empty', expect: confirm('2026', { unscheduled: true }) },
  { id: 's-medicine', utterance: 'Закрий medicine.', world: 'one-report', expect: clarify },
  { id: 's-sunday', utterance: 'У неділю створи задачу пекти пиріг.', world: 'empty', expect: confirm('пиріг', { includes: '2026-10-25' }) },
  { id: 's-explicit-today', utterance: 'Сьогодні о 07:00 створи задачу зарядка.', world: 'empty', expect: { outcomes: ['clarify', 'confirm'], clarificationRequired: false } },
  { id: 's-cancel-words', utterance: 'Забудь, не треба.', world: 'empty', expect: noPending },
  { id: 's-readonly-question-during', utterance: 'Яка зараз година?', world: 'empty', expect: { outcomes: ['answer', 'refuse', 'clarify'] } },
  { id: 's-window', utterance: 'Додай задачу спорт між 18:00 і 19:00 завтра.', world: 'empty', expect: confirm('спорт') },
  { id: 's-deadline', utterance: 'Додай задачу рахунок до 20 жовтня.', world: 'empty', expect: confirm('рахунок') },
  { id: 's-recurring-weekly', utterance: 'Щоп\'ятниці з 23 жовтня додавай задачу ретро.', world: 'empty', expect: { outcomes: ['confirm', 'clarify'] } },
  { id: 's-note', utterance: 'Додай задачу договір і додай опис: погодити з юристом.', world: 'empty', expect: confirm('договір') },
  { id: 's-dont-touch-other', utterance: 'Не чіпай фінансовий звіт, закрий звичайний звіт.', expect: { outcomes: ['confirm', 'clarify'], forbidTaskId: 'task-finance' } },
  { id: 's-second-meeting', utterance: 'Перенеси ту зустріч із дизайнером, що після обіду, на 20 жовтня о 15:00.', expect: { outcomes: ['confirm'], taskId: 'design-pm', includes: '15:00' } },
  { id: 's-first-meeting', utterance: 'Закрий ранкову зустріч із дизайнером.', expect: { outcomes: ['confirm'], taskId: 'design-am', forbidTaskId: 'design-pm' } },
  { id: 's-english-second', utterance: 'Move the afternoon designer meeting to 4 PM tomorrow.', expect: { outcomes: ['confirm', 'clarify'], forbidTaskId: 'design-am' } },
  { id: 's-reminder-zone', utterance: 'Нагадай 20 жовтня о 10:00 про податки.', world: 'empty', expect: confirm('податк', { includes: '10:00' }) },
  { id: 's-missing-title', utterance: 'Створи задачу.', world: 'empty', expect: clarify },
  { id: 's-delete-missing', utterance: 'Видали задачу про космос.', world: 'one-report', expect: clarify },
  { id: 's-two-constraints', utterance: 'Завтра додай прогулянку і не став її зранку, а ввечері.', world: 'empty', expect: confirm('прогулян') },
  { id: 's-partial-fail', utterance: 'Перенеси звіт на четвер і перенеси нараду з клієнтом на п\'ятницю.', world: 'one-report', expect: { outcomes: ['clarify', 'confirm'], clarificationRequired: true } },
  { id: 's-habit', utterance: 'Відміть звичку воду як виконану.', world: 'empty', expect: { outcomes: ['clarify', 'refuse'], clarificationRequired: true } },
  { id: 's-multi-calendar', utterance: 'Покажи звіт тільки з робочого календаря.', expect: { outcomes: ['answer', 'clarify', 'refuse'] } },
  { id: 's-keep-unscheduled', utterance: 'Не плануй звіт на час, просто залиш його в списку.', world: 'one-report', expect: { outcomes: ['answer', 'clarify', 'confirm'] } },
  { id: 's-fixed', utterance: 'Не рухай ранкову зустріч із дизайнером.', expect: { outcomes: ['answer', 'clarify', 'confirm'], forbidTaskId: 'design-pm' } },
  { id: 's-gap-question', utterance: 'Чи є вільна година завтра вдень?', expect: { outcomes: ['answer', 'clarify'] } },
  { id: 's-rename-english', utterance: 'Rename the report to Quarterly report.', world: 'one-report', expect: { outcomes: ['confirm'], taskId: 'task-report', includes: 'Quarterly' } },
  { id: 's-complete-english', utterance: 'Mark the report done.', world: 'one-report', expect: { outcomes: ['confirm'], taskId: 'task-report' } },
  { id: 's-create-low', utterance: 'Додай нетермінову задачу розібрати пошту.', world: 'empty', expect: confirm('пошту', { unscheduled: true }) },
  { id: 's-create-30', utterance: 'Додай задачу дзвінок постачальнику на 30 хвилин завтра о 10:00.', world: 'empty', expect: confirm('постачаль', { includes: '10:00' }) },
  { id: 's-create-named-day', utterance: 'У понеділок додай задачу планерка о 09:30.', world: 'empty', expect: confirm('планерк', { includes: '09:30' }) },
  { id: 's-evening-no-draft', utterance: 'Створи задачу вечерю з друзями на завтра ввечері.', world: 'empty', expect: confirm('вечер') },
  { id: 's-question-only', utterance: 'Скільки в мене відкритих задач?', expect: { outcomes: ['answer', 'clarify'] } },
  { id: 's-no-invent', utterance: 'Постав щось у вільний слот завтра.', world: 'empty', expect: { outcomes: ['clarify', 'refuse'], clarificationRequired: true } },
];

function turns(rows: Array<[string, TurnExpect]>): LiveConversation['turns'] {
  return rows.map(([utterance, expect]) => ({ utterance, expect }));
}

export const LIVE_CONVERSATIONS: LiveConversation[] = [
  {
    id: 'c-designer',
    turns: turns([
      ['Перенеси зустріч із дизайнером на завтра.', clarify],
      ['Ту, що після обіду.', { outcomes: ['confirm', 'clarify'], taskId: 'design-pm', forbidTaskId: 'design-am' }],
      ['Ні, краще на 16:00.', { outcomes: ['confirm'], taskId: 'design-pm', includes: '16:00', forbidTaskId: 'design-am' }],
      ['Так.', { outcomes: ['act', 'confirm'], taskId: 'design-pm', forbidTaskId: 'design-am' }],
    ]),
  },
  {
    id: 'c-preview-day',
    world: 'one-report',
    turns: turns([
      ['Перенеси звіт на середу.', { outcomes: ['confirm'], taskId: 'task-report' }],
      ['Ні, на четвер.', { outcomes: ['confirm'], taskId: 'task-report', includes: '2026-10-22' }],
      ['Так, підтверджую.', { outcomes: ['act'], taskId: 'task-report' }],
    ]),
  },
  {
    id: 'c-preview-clock',
    world: 'one-report',
    turns: turns([
      ['Постав звіт на 21 жовтня о 15:00.', { outcomes: ['confirm'], taskId: 'task-report', includes: '15:00' }],
      ['Краще о сьомій вечора.', { outcomes: ['confirm'], taskId: 'task-report', includes: '19:00' }],
    ]),
  },
  {
    id: 'c-preview-duration',
    world: 'one-report',
    turns: turns([
      ['Зроби звіт на годину 21 жовтня о 10:00.', { outcomes: ['confirm'], taskId: 'task-report' }],
      ['Не на годину, а на півтори.', { outcomes: ['confirm'], taskId: 'task-report', includes: '90' }],
    ]),
  },
  {
    id: 'c-preview-note',
    world: 'empty',
    turns: turns([
      ['Додай задачу договір.', confirm('договір', { unscheduled: true })],
      ['І додай опис: погодити з юристом.', confirm('договір')],
    ]),
  },
  {
    id: 'c-wrong-task',
    turns: turns([
      ['Закрий звіт.', clarify],
      ['Почекай, не цю задачу. Фінансовий звіт.', { outcomes: ['confirm'], taskId: 'task-finance', forbidTaskId: 'task-report' }],
    ]),
  },
  {
    id: 'c-confirm-none',
    world: 'empty',
    turns: turns([['Так.', noPending], ['Підтверджую.', noPending]]),
  },
  {
    id: 'c-confirm-twice',
    world: 'one-report',
    turns: turns([
      ['Видали звіт.', { outcomes: ['confirm'], taskId: 'task-report' }],
      ['Так.', { outcomes: ['act'], taskId: 'task-report' }],
      ['Так.', noPending],
    ]),
  },
  {
    id: 'c-confirm-after-cancel',
    world: 'one-report',
    turns: turns([
      ['Видали звіт.', { outcomes: ['confirm'], taskId: 'task-report' }],
      ['Скасуй, я передумав.', noPending],
      ['Так.', noPending],
    ]),
  },
  {
    id: 'c-replace-preview',
    world: 'one-report',
    turns: turns([
      ['Перенеси звіт на четвер.', { outcomes: ['confirm'], taskId: 'task-report', includes: '2026-10-22' }],
      ['Краще просто закрий його.', { outcomes: ['confirm'], taskId: 'task-report' }],
      ['Так.', { outcomes: ['act'], taskId: 'task-report' }],
    ]),
  },
  {
    id: 'c-cancel-then-other',
    world: 'one-report',
    turns: turns([
      ['Перенеси звіт на четвер.', { outcomes: ['confirm'], taskId: 'task-report' }],
      ['Забудь.', noPending],
      ['Додай задачу купити хліб.', confirm('хліб', { unscheduled: true })],
    ]),
  },
  {
    id: 'c-question-during-clarify',
    turns: turns([
      ['Перенеси зустріч із дизайнером на п\'ятницю.', clarify],
      ['А що в мене завтра?', { outcomes: ['answer', 'clarify'] }],
      ['Ту, що після обіду.', { outcomes: ['confirm', 'clarify'], forbidTaskId: 'design-am' }],
    ]),
  },
  {
    id: 'c-change-mind',
    world: 'empty',
    turns: turns([
      ['Додай задачу біг.', confirm('біг')],
      ['Не треба.', noPending],
      ['Додай задачу йога.', confirm('йога')],
    ]),
  },
  {
    id: 'c-reject-one',
    world: 'empty',
    turns: turns([
      ['Додай задачу хліб і задачу молоко.', { outcomes: ['confirm'], nameIncludes: 'хліб' }],
      ['Молоко не треба, хліб залиш.', { outcomes: ['confirm', 'clarify'], nameIncludes: 'хліб' }],
    ]),
  },
  {
    id: 'c-switch-target',
    turns: turns([
      ['Закрий ранкову зустріч із дизайнером.', { outcomes: ['confirm'], taskId: 'design-am' }],
      ['Ні, іншу, після обіду.', { outcomes: ['confirm'], taskId: 'design-pm', forbidTaskId: 'design-am' }],
    ]),
  },
  {
    id: 'c-dayplan',
    world: 'empty',
    turns: turns([
      ['Допоможи спланувати завтра.', { outcomes: ['clarify', 'confirm', 'answer'] }],
      ['Додай прогулянку ввечері.', { outcomes: ['confirm', 'clarify'], draftIncludes: 'прогулян' }],
      ['Прибери прогулянку.', { outcomes: ['confirm', 'clarify', 'answer'] }],
      ['Що лишилось вільного?', { outcomes: ['answer', 'clarify'] }],
      ['Скасуй план.', { outcomes: ['answer', 'clarify', 'refuse'] }],
    ]),
  },
  {
    id: 'c-evening-standalone',
    world: 'empty',
    turns: turns([
      ['Додай прогулянку ввечері, це окрема задача, не план дня.', confirm('прогулян')],
      ['Так.', { outcomes: ['act'], nameIncludes: 'прогулян' }],
    ]),
  },
  {
    id: 'c-reminder-day',
    world: 'empty',
    turns: turns([
      ['Нагадай забрати посилку.', clarify],
      ['20 жовтня.', confirm('посилку', { includes: '2026-10-20' })],
      ['Так.', { outcomes: ['act', 'confirm'], nameIncludes: 'посилку' }],
    ]),
  },
  {
    id: 'c-reminder-recur',
    world: 'empty',
    turns: turns([
      ['Нагадуй щодня пити воду.', clarify],
      ['Починаючи з 20 жовтня о 09:00.', confirm('воду')],
    ]),
  },
  {
    id: 'c-reminder-clock',
    world: 'empty',
    turns: turns([
      ['Нагадай 21 жовтня о 08:00 про ліки.', confirm('ліки', { includes: '08:00' })],
      ['Краще о 08:30.', confirm('ліки', { includes: '08:30' })],
      ['Не треба.', noPending],
    ]),
  },
  {
    id: 'c-reminder-not-task',
    world: 'empty',
    turns: turns([
      ['Додай задачу ліки.', confirm('ліки')],
      ['Ні, це має бути нагадування на 20 жовтня о 21:00.', confirm('ліки', { includes: '21:00' })],
    ]),
  },
  {
    id: 'c-ordinal',
    turns: turns([
      ['Закрий звіт.', clarify],
      ['Ту першу.', { outcomes: ['confirm', 'clarify'] }],
      ['Ні, другу.', { outcomes: ['confirm', 'clarify'] }],
    ]),
  },
  {
    id: 'c-by-time',
    turns: turns([
      ['Перенеси зустріч із дизайнером.', clarify],
      ['Ту, що о 16:00.', { outcomes: ['confirm', 'clarify'], forbidTaskId: 'design-am' }],
    ]),
  },
  {
    id: 'c-not-this',
    turns: turns([
      ['Закрий звіт.', clarify],
      ['Не цю, іншу.', { outcomes: ['confirm', 'clarify'], forbidTaskId: 'task-report' }],
    ]),
  },
  {
    id: 'c-then-another',
    world: 'one-report',
    turns: turns([
      ['Перенеси звіт на четвер о 10:00.', { outcomes: ['confirm'], taskId: 'task-report' }],
      ['Так.', { outcomes: ['act'], taskId: 'task-report' }],
      ['І додай ще задачу лист.', confirm('лист', { unscheduled: true })],
    ]),
  },
  {
    id: 'c-english-mix',
    turns: turns([
      ['Перенеси design review на завтра.', clarify],
      ['Ні, I meant the second one.', { outcomes: ['confirm', 'clarify'] }],
      ['Move it to 4 PM.', { outcomes: ['confirm', 'clarify'] }],
      ['Так, підтверджую.', { outcomes: ['act', 'confirm', 'answer', 'clarify'] }],
    ]),
  },
  {
    id: 'c-follow-up',
    world: 'empty',
    turns: turns([
      ['Зроби follow-up у п\'ятницю.', confirm('follow-up', { includes: '2026-10-23' })],
      ['Так.', { outcomes: ['act'], nameIncludes: 'follow-up' }],
    ]),
  },
  {
    id: 'c-conflict',
    world: 'one-report',
    turns: turns([
      ['Перенеси звіт на четвер.', { outcomes: ['confirm'], taskId: 'task-report' }],
      ['Ні, на п\'ятницю. Хоча ні, все-таки на четвер.', { outcomes: ['confirm'], taskId: 'task-report', includes: '2026-10-22' }],
    ]),
  },
  {
    id: 'c-dst',
    world: 'empty',
    zone: 'America/New_York',
    nowIso: '2026-03-08T06:00:00.000Z',
    turns: turns([
      ['Постав задачу дзвінок на 8 березня 2026 о 02:30.', { outcomes: ['clarify', 'refuse'], clarificationRequired: true }],
      ['Тоді на 03:30.', { outcomes: ['confirm', 'clarify'] }],
    ]),
  },
  {
    id: 'c-ordering',
    world: 'one-report',
    turns: turns([
      ['Постав звіт після наради.', { outcomes: ['clarify', 'refuse'], clarificationRequired: true }],
      ['Тоді просто на 21 жовтня о 17:00.', { outcomes: ['confirm'], taskId: 'task-report', includes: '17:00' }],
    ]),
  },
  {
    id: 'c-bulk-cancel',
    turns: turns([
      ['Видали всі задачі з назвою Нарада.', { outcomes: ['confirm', 'clarify'] }],
      ['Скасуй.', noPending],
      ['Так.', noPending],
    ]),
  },
  {
    id: 'c-readonly-external',
    world: 'readonly-flight',
    turns: turns([
      ['Перенеси політ на завтра о 15:00.', { outcomes: ['clarify', 'refuse'], clarificationRequired: true, forbidTaskId: 'ext-flight' }],
      ['Так, підтверджую.', noPending],
    ]),
  },
  {
    id: 'c-multi-intent',
    world: 'empty',
    turns: turns([
      ['Додай задачу звіт і задачу лист, лист зроби важливим.', { outcomes: ['confirm'], nameIncludes: 'лист' }],
      ['Лист перейменуй на Лист юристу.', { outcomes: ['confirm', 'clarify'], nameIncludes: 'юрист' }],
      ['Звіт не створюй.', { outcomes: ['confirm', 'clarify', 'answer'] }],
    ]),
  },
  {
    id: 'c-preserve-constraint',
    world: 'empty',
    turns: turns([
      ['Додай задачу спорт завтра о 18:00 на годину.', confirm('спорт', { includes: '18:00' })],
      ['Перенеси на 19:00.', confirm('спорт', { includes: '19:00' })],
    ]),
  },
  {
    id: 'c-read-then-write',
    world: 'one-report',
    turns: turns([
      ['Що в мене відкрито?', { outcomes: ['answer', 'clarify'] }],
      ['Закрий звіт.', { outcomes: ['confirm'], taskId: 'task-report' }],
      ['Ні.', noPending],
    ]),
  },
  {
    id: 'c-stale-yes',
    world: 'empty',
    turns: turns([
      ['Так.', noPending],
      ['Додай задачу вода.', confirm('вода', { unscheduled: true })],
      ['Так.', { outcomes: ['act'], nameIncludes: 'вода' }],
      ['Так ще раз.', noPending],
    ]),
  },
  {
    id: 'c-dayplan-fixed',
    turns: turns([
      ['Сплануй завтра, але ранкову зустріч із дизайнером не рухай.', { outcomes: ['clarify', 'confirm', 'answer'], forbidTaskId: 'design-pm' }],
      ['Додай ввечері прогулянку.', { outcomes: ['confirm', 'clarify'], draftIncludes: 'прогулян' }],
      ['Не треба план.', { outcomes: ['answer', 'clarify', 'refuse'] }],
    ]),
  },
  {
    id: 'c-correction-not-confirm',
    world: 'one-report',
    turns: turns([
      ['Перенеси звіт на 20 жовтня о 10:00.', { outcomes: ['confirm'], taskId: 'task-report', includes: '10:00' }],
      ['Краще о 11:00.', { outcomes: ['confirm'], taskId: 'task-report', includes: '11:00' }],
    ]),
  },
];
