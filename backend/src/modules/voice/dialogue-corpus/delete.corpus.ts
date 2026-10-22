/** Delete specialist. «Звіт» is the one-off. Gym is the series and has no occurrence on the calendar. */
import { ask, line, noWrite, scenario } from './define';

const deleted = (needle: string) => ({
  outcome: 'confirm' as const,
  kinds: ['delete'],
  maxIntents: 1,
  noPlan: true,
  nameIncludes: needle,
});

scenario('delete', 'named', line('видали звіт', deleted('звіт')));

scenario('delete', 'unknown', line('видали обід з клієнтом', ask));

scenario('delete', 'close-meaning', line('видали тренування', ask));

scenario('delete', 'pronoun-without-context', line('видали це', noWrite));

scenario('delete', 'series-no-scope', line('видали Gym', ask));

scenario('delete', 'series-all', line('видали всю серію Gym', deleted('Gym')));

scenario(
  'delete',
  'series-today',
  line('видали сьогоднішній Gym', { outcome: 'refuse', maxIntents: 0, noPlan: true }),
);

scenario(
  'delete',
  'series-following',
  line('видали Gym від сьогодні і далі', { outcome: 'refuse', maxIntents: 0, noPlan: true }),
);
