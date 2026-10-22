/**
 * Fast create. Only the branches that change when the mode is on, plus the
 * writes and questions the mode must leave alone.
 * Same clock as the assistant corpus: tomorrow 07:30, so the past clock is a
 * named morning hour. A bare hour still has a later place and is not this branch.
 */
import { ask, created, line, readCalendar, scenario, SEEDED_INBOX } from './define';

const fast = 'fast_create' as const;

scenario(
  'fast-create',
  'event-without-clock',
  line('зустріч з інвестором', created('інвестор', { unscheduled: true })),
  fast,
);

scenario(
  'fast-create',
  'past-clock-is-tomorrow',
  line('зустріч о шостій ранку', created('зустріч')),
  fast,
);

scenario(
  'fast-create',
  'named-week',
  line('наступного тижня ретроспектива', created('ретроспектив')),
  fast,
);

scenario(
  'fast-create',
  'long-task-keeps-default',
  line('треба написати дипломну', created('диплом', { unscheduled: true })),
  fast,
);

scenario(
  'fast-create',
  'missing-other-task',
  line('після стоматолога забрати аналізи', created('аналіз', { unscheduled: true })),
  fast,
);

scenario(
  'fast-create',
  'open-task-without-time',
  line('перед звітом підготувати слайди', created('слайд', { unscheduled: true })),
  fast,
);

scenario('fast-create', 'ambiguous-span-still-asks', line('з 10 до 16 розібрати беклог', ask), fast);

scenario('fast-create', 'no-name-still-asks', line('постав на завтра о 15', ask), fast);

scenario('fast-create', 'move-still-asks', line('перенеси звіт', ask), fast);

scenario('fast-create', 'question-still-reads', line('що в мене сьогодні?', readCalendar), fast);

scenario(
  'fast-create',
  'plan-still-opens',
  line('сплануй сьогодні', {
    outcome: 'clarify',
    maxIntents: 0,
    answer: true,
    minPlannerCalls: 2,
    planStage: 'interview',
    actionsInclude: 'build_plan',
    planNames: [...SEEDED_INBOX],
  }),
  fast,
);
