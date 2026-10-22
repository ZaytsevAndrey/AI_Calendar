/**
 * Planner and multi-turn dialogue. Each construction is a different situation:
 * a split, a question, a day plan, or a later turn that changes what is pending.
 * Single-specialist branches stay in their own corpus.
 */
import {
  ask,
  created,
  line,
  moved,
  readCalendar,
  scenario,
  SEEDED_INBOX,
} from './define';

const planOpen = {
  outcome: 'clarify' as const,
  maxIntents: 0,
  answer: true,
  minPlannerCalls: 2,
  planStage: 'interview' as const,
  actionsInclude: 'build_plan',
  planNames: [...SEEDED_INBOX],
};

scenario('dialogue', 'noise', line('дякую', { outcome: 'answer', maxIntents: 0, noLlm: true, noPlan: true }));

scenario(
  'dialogue',
  'smalltalk',
  line('привіт, як справи?', { outcome: 'answer', maxIntents: 0, noPlan: true, answer: true }),
);

scenario(
  'dialogue',
  'settings-refused',
  line('зміни час підйому на сьому', { outcome: 'refuse', maxIntents: 0, noPlan: true }),
);

scenario('dialogue', 'agenda-today', line('що в мене сьогодні?', readCalendar));

scenario('dialogue', 'gaps-today', line('коли я сьогодні вільний?', readCalendar));

scenario('dialogue', 'unscheduled-list', line('що в мене без часу?', readCalendar));

scenario('dialogue', 'now-and-next', line('що в мене зараз і що далі?', readCalendar));

scenario('dialogue', 'agenda-tomorrow', line('що в мене завтра?', readCalendar));

scenario('dialogue', 'agenda-week', line('що в мене на цей тиждень?', readCalendar));

scenario('dialogue', 'one-task', line('коли в мене звіт?', readCalendar));

scenario(
  'dialogue',
  'question-and-create',
  line('що в мене сьогодні, і додай обід з клієнтом', {
    outcome: 'confirm',
    kinds: ['create'],
    maxIntents: 1,
    noPlan: true,
    answer: true,
    minPlannerCalls: 2,
    nameIncludes: 'обід',
  }),
);

scenario(
  'dialogue',
  'question-and-complete',
  line('коли я вільний завтра, і звіт уже готовий', {
    outcome: 'confirm',
    kinds: ['complete'],
    maxIntents: 1,
    noPlan: true,
    answer: true,
    minPlannerCalls: 2,
    nameIncludes: 'звіт',
  }),
);

scenario(
  'dialogue',
  'two-errands',
  line('треба забронювати переговорку і записатися до стоматолога', {
    outcome: 'confirm',
    kinds: ['create', 'create'],
    maxIntents: 2,
    noPlan: true,
    nameIncludes: 'переговор',
  }),
);

scenario(
  'dialogue',
  'errands-for-a-day-are-not-a-plan',
  line('завтра стендап, обід з клієнтом і зустріч з партнером', {
    outcome: 'confirm',
    kinds: ['create', 'create', 'create'],
    maxIntents: 3,
    noPlan: true,
    nameIncludes: 'стендап',
  }),
);

scenario(
  'dialogue',
  'two-days-one-clock',
  line('у вівторок і в пʼятницю о 18 тренування', {
    outcome: 'confirm',
    kinds: ['create', 'create'],
    maxIntents: 2,
    noPlan: true,
    nameIncludes: 'тренуван',
  }),
);

scenario(
  'dialogue',
  'two-weekend-days-once',
  line('у суботу і в неділю прибирання', {
    outcome: 'confirm',
    kinds: ['create', 'create'],
    maxIntents: 2,
    noPlan: true,
    nameIncludes: 'прибиран',
  }),
);

scenario(
  'dialogue',
  'revise-to-final-time',
  line('додай тренування на 18 і перенеси його на 19', {
    outcome: 'confirm',
    kinds: ['create'],
    maxIntents: 1,
    noPlan: true,
    nameIncludes: '19',
  }),
);

scenario(
  'dialogue',
  'field-and-placement',
  line('звіт терміновий і перенеси його на завтра', {
    outcome: 'confirm',
    kinds: ['update', 'window|shift|update'],
    maxIntents: 2,
    noPlan: true,
    nameIncludes: 'звіт',
  }),
);

scenario(
  'dialogue',
  'create-and-delete',
  line('додай стендап на завтра і видали звіт', {
    outcome: 'confirm',
    kinds: ['create', 'delete'],
    noPlan: true,
    nameIncludes: 'стендап',
  }),
);

scenario(
  'dialogue',
  'move-and-create',
  line('перенеси звіт на вечір і додай обід з командою', {
    outcome: 'confirm',
    kinds: ['window|shift|update', 'create'],
    noPlan: true,
    nameIncludes: 'обід',
  }),
);

scenario(
  'dialogue',
  'skip-today-and-create',
  line('сьогодні звіт відпадає, і додай стендап на завтра', {
    outcome: 'confirm',
    kinds: ['cancel', 'create'],
    noPlan: true,
    nameIncludes: 'стендап',
  }),
);

scenario(
  'dialogue',
  'two-deletes',
  line('видали звіт і видали всю серію Gym', {
    outcome: 'confirm',
    kinds: ['delete', 'delete'],
    maxIntents: 2,
    noPlan: true,
    nameIncludes: 'звіт',
  }),
);

scenario('dialogue', 'hold-then-answer', [
  { transcript: 'додай обід з клієнтом і перенеси ту штуку', expect: ask },
  {
    transcript: 'звіт, на завтра',
    expect: {
      outcome: 'confirm',
      kinds: ['create', 'window|shift|update'],
      noPlan: true,
      nameIncludes: 'обід',
    },
  },
]);

scenario('dialogue', 'drop-after-two-blanks', [
  { transcript: 'додай стендап і перенеси оце', expect: ask },
  { transcript: 'не знаю яку', expect: ask },
  {
    transcript: 'та й байдуже',
    expect: created('стендап'),
  },
]);

scenario('dialogue', 'no-intent-then-refuse', [
  { transcript: 'ну таке, зроби щось', expect: ask },
  { transcript: 'ну не знаю', expect: ask },
  { transcript: 'та байдуже', expect: { outcome: 'refuse', maxIntents: 0, noPlan: true } },
]);

scenario('dialogue', 'write-resets-clarify', [
  { transcript: 'ну таке, зроби щось', expect: ask },
  { transcript: 'ну не знаю', expect: ask },
  {
    transcript: 'додай зустріч з командою на завтра',
    expect: created('зустріч'),
  },
]);

scenario('dialogue', 'pronoun-after-create', [
  { transcript: 'додай обід з командою', expect: created('обід') },
  { transcript: 'перенеси його на завтра', expect: { ...moved, nameIncludes: 'обід' } },
]);

scenario('dialogue', 'new-request-is-not-a-yes', [
  { transcript: 'перенеси звіт на завтра', expect: moved },
  {
    transcript: 'і зроби його терміновим',
    expect: {
      outcome: 'confirm',
      kinds: ['update'],
      maxIntents: 2,
      noPlan: true,
      nameIncludes: 'urgent',
    },
  },
]);

scenario('dialogue', 'spoken-yes', [
  {
    transcript: 'видали звіт',
    expect: {
      outcome: 'confirm',
      kinds: ['delete'],
      maxIntents: 1,
      noPlan: true,
      nameIncludes: 'звіт',
    },
  },
  {
    transcript: 'так, прибирай',
    expect: { outcome: 'act', kinds: ['delete'], maxIntents: 1, noPlan: true, nameIncludes: 'звіт' },
  },
]);

scenario('dialogue', 'spoken-no', [
  {
    transcript: 'видали звіт',
    expect: {
      outcome: 'confirm',
      kinds: ['delete'],
      maxIntents: 1,
      noPlan: true,
      nameIncludes: 'звіт',
    },
  },
  { transcript: 'ні, залиш', expect: { outcome: 'answer', maxIntents: 0, noPlan: true } },
]);

scenario('dialogue', 'question-does-not-confirm', [
  {
    transcript: 'видали звіт',
    expect: {
      outcome: 'confirm',
      kinds: ['delete'],
      maxIntents: 1,
      noPlan: true,
      nameIncludes: 'звіт',
    },
  },
  { transcript: 'а що в мене завтра?', expect: { ...readCalendar, maxIntents: 0 } },
]);

scenario('dialogue', 'plan-today', line('сплануй сьогодні', planOpen));

scenario('dialogue', 'plan-add', [
  { transcript: 'сплануй сьогодні', expect: planOpen },
  {
    transcript: 'додай годину на тренування',
    expect: {
      outcome: 'clarify',
      maxIntents: 0,
      planStage: 'interview',
      actionsInclude: 'build_plan',
      planNames: [...SEEDED_INBOX, 'тренуван'],
    },
  },
]);

scenario('dialogue', 'plan-remove', [
  { transcript: 'сплануй сьогодні', expect: planOpen },
  {
    transcript: 'прибери звіт із плану',
    expect: {
      outcome: 'clarify',
      maxIntents: 0,
      planStage: 'interview',
      actionsInclude: 'build_plan',
      planNames: ['Нарада'],
      planAbsent: ['Звіт'],
      planRevisionMin: 1,
    },
  },
]);

scenario('dialogue', 'plan-question', [
  { transcript: 'сплануй сьогодні', expect: planOpen },
  {
    transcript: 'коли я вільний?',
    expect: {
      ...readCalendar,
      outcome: ['clarify', 'answer'],
      planStage: 'interview',
      actionsInclude: 'build_plan',
      planNames: [...SEEDED_INBOX],
      noPlan: false,
    },
  },
]);

scenario('dialogue', 'plan-other-day-then-report', [
  { transcript: 'сплануй сьогодні', expect: planOpen },
  {
    transcript: 'завтра треба стендап з командою',
    expect: created('стендап'),
  },
  {
    actionId: 'report',
    executionReport: { results: [{ summary: 'стендап', status: 'applied' }] },
    expect: {
      outcome: 'clarify',
      noLlm: true,
      planStage: 'interview',
      actionsInclude: 'build_plan',
      planNames: [...SEEDED_INBOX],
    },
  },
]);

scenario('dialogue', 'plan-apply', [
  { transcript: 'сплануй сьогодні', expect: planOpen },
  {
    actionId: 'build_plan',
    expect: { outcome: 'confirm', noLlm: true, planStage: 'review' },
  },
]);

scenario(
  'dialogue',
  'filler-then-errand',
  line('ну значить так, треба підготувати презентацію для клієнта', created('презентац', { unscheduled: true })),
);

scenario(
  'dialogue',
  'complete-and-move',
  line('закінчив звіт і перенеси нараду на завтра', {
    outcome: 'confirm',
    kinds: ['complete', 'window|shift|update'],
    maxIntents: 2,
    noPlan: true,
    nameIncludes: 'нарад',
  }),
);

scenario(
  'dialogue',
  'now-then-later',
  line('спочатку візьмись за звіт зараз, потім стендап о 18', {
    outcome: 'confirm',
    kinds: ['window|shift|update', 'create'],
    maxIntents: 2,
    noPlan: true,
    nameIncludes: 'стендап',
  }),
);

scenario(
  'dialogue',
  'mind-change-and-delete',
  line('додай стендап… ні, планерку, і ще видали нараду', {
    outcome: 'confirm',
    kinds: ['create', 'delete'],
    maxIntents: 2,
    noPlan: true,
    nameIncludes: 'планер',
  }),
);

scenario('dialogue', 'plan-tomorrow', line('сплануй завтра', {
  outcome: 'clarify',
  maxIntents: 0,
  answer: true,
  minPlannerCalls: 2,
  planStage: 'interview',
  actionsInclude: 'build_plan',
}));

scenario('dialogue', 'plan-opening-with-task', line('сплануй сьогодні і додай тренування на вечір', {
  outcome: 'clarify',
  maxIntents: 0,
  planStage: 'interview',
  actionsInclude: 'build_plan',
  planNames: [...SEEDED_INBOX, 'тренуван'],
}));

scenario('dialogue', 'plan-unclear-add', [
  { transcript: 'сплануй сьогодні', expect: { ...planOpen, maxPlanItems: 2 } },
  {
    transcript: 'додай ще одну справу',
    expect: {
      outcome: 'clarify',
      maxIntents: 0,
      planStage: 'interview',
      actionsInclude: 'build_plan',
      planNames: [...SEEDED_INBOX],
      maxPlanItems: 2,
    },
  },
  {
    transcript: 'не знаю яку саме',
    expect: {
      outcome: 'clarify',
      maxIntents: 0,
      planStage: 'interview',
      actionsInclude: 'build_plan',
      planNames: [...SEEDED_INBOX],
      maxPlanItems: 2,
    },
  },
]);
