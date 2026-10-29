/**
 * Held-out paraphrases for the next live run.
 * They are not copies of the 104 regression utterances and they are not semantic gold for those fixtures.
 */
export type HeldOutCase = {
  id: string;
  language: 'uk' | 'en';
  transcript: string;
  acceptable: Array<'confirm' | 'clarify' | 'answer' | 'refuse'>;
  refusalAllowed: boolean;
  note: string;
};

export const HELD_OUT_CASES: HeldOutCase[] = [
  { id: 'hold-call-later', language: 'uk', transcript: 'Зателефонуй клієнту за дві години', acceptable: ['confirm'], refusalAllowed: false, note: 'Relative clock from the supplied now. No separate day is required.' },
  { id: 'hold-evening-walk', language: 'uk', transcript: 'Хочу прогулятися сьогодні ввечері', acceptable: ['confirm', 'clarify'], refusalAllowed: false, note: 'Evening stays qualitative. A preview that invents a clock is not acceptable.' },
  { id: 'hold-all-day-offsite', language: 'uk', transcript: 'Завтра весь день буду на конференції', acceptable: ['clarify', 'refuse'], refusalAllowed: true, note: 'All-day must not become a short timed task.' },
  { id: 'hold-range-meeting', language: 'uk', transcript: 'Постав зустріч між сьомою і девʼятою', acceptable: ['clarify'], refusalAllowed: false, note: 'The span is ambiguous. Do not pick AM or PM.' },
  { id: 'hold-delete-every', language: 'uk', transcript: 'Прибери кожну сьогоднішню зустріч', acceptable: ['clarify', 'refuse'], refusalAllowed: true, note: 'Bulk delete must not preview a single match.' },
  { id: 'hold-correction', language: 'uk', transcript: 'Додай звіт на понеділок. Ні, хай буде на середу.', acceptable: ['confirm'], refusalAllowed: false, note: 'One create on Wednesday. Not two creates.' },
  { id: 'hold-depends', language: 'uk', transcript: 'Створи чернетку, а ревʼю постав після неї', acceptable: ['confirm', 'clarify'], refusalAllowed: false, note: 'The review stays dependent on the draft.' },
  { id: 'hold-which-report', language: 'uk', transcript: 'Перенеси той звіт на ранок', acceptable: ['clarify'], refusalAllowed: false, note: 'The target is not identified. Do not pick one report.' },
  { id: 'hold-remind-meds', language: 'uk', transcript: 'Нагадай випити ліки о восьмій вечора', acceptable: ['confirm', 'clarify', 'refuse'], refusalAllowed: true, note: 'A reminder that cannot be represented must be blocked, not saved as a plain task.' },
  { id: 'hold-move-friday', language: 'en', transcript: 'Move the budget review to Friday at 10', acceptable: ['confirm', 'clarify'], refusalAllowed: false, note: 'English paraphrase. Wrong day is a critical failure.' },
  { id: 'hold-cancel-open', language: 'en', transcript: 'Cancel that, leave the other task', acceptable: ['clarify', 'answer'], refusalAllowed: false, note: 'Cancellation must not drop an unrelated pending task without being asked.' },
  { id: 'hold-plan-tomorrow', language: 'uk', transcript: 'Давай складемо план на завтра зранку', acceptable: ['clarify', 'confirm'], refusalAllowed: false, note: 'Day-plan start. Apply is not success unless the real planner ran.' },
  { id: 'hold-46-both-meetings', language: 'uk', transcript: 'Скасуй обидві наради', acceptable: ['clarify', 'refuse'], refusalAllowed: true, note: 'Both is a set. One arbitrary cancel is not the set.' },
  { id: 'hold-46-tomorrow-agenda', language: 'uk', transcript: 'Розкажи, що в мене в календарі завтра', acceptable: ['answer', 'clarify', 'refuse'], refusalAllowed: true, note: 'A read. An empty result is not a failed read, and a failed read is not an empty day.' },
  { id: 'hold-46-remind-before', language: 'uk', transcript: 'Постав дзвінок на третю і нагадай за годину до нього', acceptable: ['confirm', 'clarify', 'refuse'], refusalAllowed: true, note: 'Reminder offset must stay attached or be refused. It must not become an unrelated task.' },
  { id: 'hold-46-weekly', language: 'uk', transcript: 'Щопонеділка о девʼятій ранку тренування', acceptable: ['clarify', 'refuse'], refusalAllowed: true, note: 'Weekly recurrence must not be stored as one ordinary task.' },
];
