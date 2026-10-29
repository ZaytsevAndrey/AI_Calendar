/**
 * Fold experiment gold. Fixed before any model call.
 * A right segment count is not enough: final parameters and cancelled values are separate.
 */

export type FoldKind =
  | 'fold-date'
  | 'fold-replace-day'
  | 'fold-clock'
  | 'fold-duration'
  | 'fold-several'
  | 'withdraw-cancel'
  | 'withdraw-delete'
  | 'independent'
  | 'two-creates'
  | 'same-name'
  | 'pronoun-one'
  | 'pronoun-many'
  | 'missing-target'
  | 'plain-create'
  | 'existing-duration'
  | 'existing-fold';

export type FoldScenario = {
  id: string;
  kind: FoldKind;
  utterance: string;
  note: string;
  decision: 'steps' | 'final';
  outcome?: 'answer';
  /** Stem groups that must appear somewhere. */
  objects: string[][];
  /** One unit must contain the object and every final parameter group. */
  fold?: { object: string[]; params: string[][] };
  /** Each entry must match a different unit. */
  separate?: Array<{ must: string[][]; none?: string[] }>;
  /** Stems that must not survive in any unit. */
  cancelled: string[];
  /** Stems that were not in the utterance and must not be introduced. */
  invented: string[];
  /** Stem groups that must appear somewhere, without forcing them onto one object. */
  present?: string[][];
  /** Required when the gold is one number. Omitted when the count is not the claim. */
  count?: number;
  /**
   * The parameter exists, but which antecedent receives it is not a unique gold.
   * That axis is review. Missing the parameter, or dropping an operation, still fails.
   */
  targetReview?: { param: string[] };
};

export const FOLD_SCENARIOS: FoldScenario[] = [
  {
    id: 'date-tickets',
    kind: 'fold-date',
    utterance: 'Замов квитки на поїзд і перенеси їх на п\'ятницю',
    note: 'The later day belongs to the ticket create. One segment: tickets and Friday.',
    decision: 'steps',
    objects: [['квит']],
    fold: { object: ['квит'], params: [["п'ят", 'пʼят', 'пятниц']] },
    cancelled: [],
    invented: ['звіт', 'нарад', 'молок'],
    count: 1,
  },
  {
    id: 'clock-call',
    kind: 'fold-clock',
    utterance: 'Постав дзвінок клієнту і зроби його о четвертій',
    note: '16:00 is still ahead of 09:00. One create keeps the call and that clock. Do not move it to tomorrow.',
    decision: 'steps',
    objects: [['дзвін'], ['клієнт']],
    fold: { object: ['дзвін'], params: [['четверт', '16']] },
    cancelled: [],
    invented: ['звіт', 'нарад', 'завтра', 'молок'],
    count: 1,
  },
  {
    id: 'duration-cleaning',
    kind: 'fold-duration',
    utterance: 'Додай прибирання офісу і заклади на нього дві години',
    note: 'One create keeps the cleaning and the two-hour length. No day was spoken.',
    decision: 'steps',
    objects: [['прибиран']],
    fold: { object: ['прибиран'], params: [['дві годин', '2 годин', '120']] },
    cancelled: [],
    invented: ['звіт', 'нарад', 'завтра', 'сьогодні', 'молок'],
    count: 1,
  },
  {
    id: 'several-yoga',
    kind: 'fold-several',
    utterance: 'Запиши йогу на сьогодні на дев\'яту, перенеси її на завтра і зроби її на сорок п\'ять хвилин',
    note: 'The last day is tomorrow and the last length is 45 minutes. Nine o\'clock was not restated, so it stays. Today is cancelled.',
    decision: 'steps',
    objects: [['йог']],
    fold: { object: ['йог'], params: [['завтра'], ['сорок', '45'], ["дев'ят", 'девʼят', '09:00', '9:00']] },
    cancelled: ['сьогодні'],
    invented: ['звіт', 'нарад', 'молок'],
    count: 1,
  },
  {
    id: 'cancel-laundry',
    kind: 'withdraw-cancel',
    utterance: 'Додай прання, ні, не треба',
    note: 'The create is withdrawn. Nothing is kept, and no open task is deleted.',
    decision: 'final',
    outcome: 'answer',
    objects: [],
    cancelled: ['пран', 'звіт', 'нарад'],
    invented: ['молок'],
    count: 0,
  },
  {
    id: 'delete-draft',
    kind: 'withdraw-delete',
    utterance: 'Створи чернетку листа і відразу видали її',
    note: 'The delete names the create in this utterance, so nothing remains. Two segments, a create followed by a delete, are not that result. A delete of a task that already existed would stay.',
    decision: 'final',
    outcome: 'answer',
    objects: [],
    cancelled: ['чернет', 'лист', 'звіт', 'нарад'],
    invented: ['молок'],
    count: 0,
  },
  {
    id: 'independent-bread',
    kind: 'independent',
    utterance: 'Додай хліб і перенеси нараду на п\'ятницю',
    note: 'The bread create and the move of Нарада stay apart. Friday does not move onto the bread.',
    decision: 'steps',
    objects: [['хліб'], ['нарад']],
    separate: [
      { must: [['хліб']], none: ['нарад', "п'ят", 'пʼят', 'пятниц'] },
      { must: [['нарад'], ["п'ят", 'пʼят', 'пятниц']], none: ['хліб'] },
    ],
    cancelled: [],
    invented: ['звіт', 'молок'],
    count: 2,
  },
  {
    id: 'two-errands',
    kind: 'two-creates',
    utterance: 'Забери посилку і подзвони лікарю',
    note: 'Two different errands stay two segments. No day was spoken.',
    decision: 'steps',
    objects: [['посил'], ['лікар']],
    separate: [
      { must: [['посил']], none: ['лікар'] },
      { must: [['лікар']], none: ['посил'] },
    ],
    cancelled: [],
    invented: ['звіт', 'нарад', 'сьогодні', 'завтра', 'молок'],
    count: 2,
  },
  {
    id: 'same-budget',
    kind: 'same-name',
    utterance: 'Створи новий бюджет і видали старий бюджет',
    note: 'The new budget and the delete of the old one stay two operations. The delete does not cancel the create.',
    decision: 'steps',
    objects: [['бюджет']],
    separate: [
      { must: [['бюджет'], ['нов']], none: ['видал', 'стар'] },
      { must: [['бюджет'], ['видал'], ['стар']], none: ['нов'] },
    ],
    cancelled: [],
    invented: ['звіт', 'нарад', 'молок'],
    count: 2,
  },
  {
    id: 'pronoun-taxi',
    kind: 'pronoun-one',
    utterance: 'Замов таксі і перенеси його на завтра на одинадцяту',
    note: 'Таксі is the only antecedent. One segment carries it, tomorrow, and 11:00.',
    decision: 'steps',
    objects: [['такс']],
    fold: { object: ['такс'], params: [['завтра'], ['одинадц', '11']] },
    cancelled: [],
    invented: ['звіт', 'нарад', 'молок'],
    count: 1,
  },
  {
    id: 'pronoun-taxi-meeting',
    kind: 'pronoun-many',
    utterance: 'Додай таксі і перенеси нараду на п\'ятницю, а його зроби на годину',
    note: 'Таксі and Нарада are both named, so the hour has two antecedents. Keeping it on його, or placing it on either name, is review. Dropping either operation is a failure.',
    decision: 'steps',
    objects: [['такс'], ['нарад']],
    separate: [
      { must: [['такс']], none: ['нарад'] },
      { must: [['нарад'], ["п'ят", 'пʼят', 'пятниц']], none: ['такс'] },
    ],
    cancelled: [],
    invented: ['звіт', 'молок'],
    present: [['годин', '60']],
    targetReview: { param: ['годин', '60'] },
  },
  {
    id: 'pronoun-bare',
    kind: 'missing-target',
    utterance: 'Перенеси це на вечір',
    note: 'No antecedent is established. The segment keeps це and the evening. It does not become Звіт or Нарада.',
    decision: 'steps',
    objects: [['це'], ['вечір']],
    cancelled: [],
    invented: ['звіт', 'нарад', 'такс', 'хліб', 'молок'],
    count: 1,
  },
  {
    id: 'plain-coat',
    kind: 'plain-create',
    utterance: 'Треба віднести пальто в хімчистку',
    note: 'One create. No day, clock, or open task is added.',
    decision: 'steps',
    objects: [['пальт'], ['хімчист']],
    cancelled: [],
    invented: ['звіт', 'нарад', 'завтра', 'сьогодні', 'молок'],
    count: 1,
  },
  {
    id: 'replace-dentist',
    kind: 'fold-replace-day',
    utterance: 'Постав стоматолога на понеділок, ні, на вівторок',
    note: 'Tuesday replaces Monday for the same create. Monday does not remain.',
    decision: 'steps',
    objects: [['стоматолог']],
    fold: { object: ['стоматолог'], params: [['вівтор']] },
    cancelled: ['понед'],
    invented: ['звіт', 'нарад', 'молок'],
    count: 1,
  },
  {
    id: 'existing-length',
    kind: 'existing-duration',
    utterance: 'Зроби нараду на півтори години',
    note: 'One update of the existing Нарада. It does not become a new task and it does not gain a day.',
    decision: 'steps',
    objects: [['нарад']],
    fold: { object: ['нарад'], params: [['півтор', '90']] },
    cancelled: [],
    invented: ['звіт', 'завтра', "п'ят", 'пʼят', 'молок', 'такс'],
    count: 1,
  },
  {
    id: 'existing-both',
    kind: 'existing-fold',
    utterance: 'Перенеси нараду на п\'ятницю і зроби її на півтори години',
    note: 'Нарада is the only antecedent. Friday and the length are one update.',
    decision: 'steps',
    objects: [['нарад']],
    fold: { object: ['нарад'], params: [["п'ят", 'пʼят', 'пятниц'], ['півтор', '90']] },
    cancelled: [],
    invented: ['звіт', 'такс', 'хліб', 'молок'],
    count: 1,
  },
];
