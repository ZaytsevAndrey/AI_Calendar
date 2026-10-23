/** Update specialist. Target is the open task «Звіт», or the Gym series when the change is about a repeat. */
import { ask, line, noWrite, scenario } from './define';

const updated = (needle: string) => ({
  outcome: 'confirm' as const,
  kinds: ['update'],
  maxIntents: 1,
  noPlan: true,
  nameIncludes: needle,
});

scenario('update', 'rename', line('перейменуй звіт на квартальний огляд', updated('квартальн')));

scenario('update', 'priority', line('зроби звіт терміновим', updated('urgent')));

scenario(
  'update',
  'note',
  line('до звіту додай нотатку, що чекаю цифри від фінансів', updated('звіт')),
);

scenario('update', 'clear-note', line('прибери нотатку зі звіту', updated('звіт')));

scenario('update', 'location', line('додай до звіту місце: переговорка', updated('звіт')));

scenario('update', 'deadline', line('дедлайн звіту — завтра', updated('звіт')));

scenario('update', 'bound-is-deadline', line('звіт до пʼятниці', updated('звіт')));

scenario('update', 'duration', line('на звіт заклади годину', updated('звіт')));

scenario('update', 'clear-time', line('прибери час у звіту', updated('звіт')));

scenario('update', 'nothing-to-change', line('зміни щось у звіті', ask));

scenario('update', 'close-meaning', line('зроби звітність терміновою', ask));

scenario('update', 'pronoun-without-context', line('зроби його терміновим', noWrite));

scenario('update', 'make-daily', line('хай звіт повторюється щодня', updated('звіт')));

scenario('update', 'allow-split', line('звіт можна розбити на частини', updated('звіт')));

scenario('update', 'weekdays-only', line('звіт став лише по буднях', updated('звіт')));

scenario(
  'update',
  'series-priority-all',
  line('для всієї серії Gym постав високий пріоритет', updated('Gym')),
);

scenario(
  'update',
  'series-priority-one-day',
  line('сьогоднішньому Gym підніми пріоритет', { outcome: 'refuse', maxIntents: 0, noPlan: true }),
);

scenario(
  'update',
  'series-stop-repeating',
  line('прибери повтор з усієї серії Gym', updated('Gym')),
);
