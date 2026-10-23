/** Done-only updates. A one-off is kind complete. A series day with no placed occurrence cannot be marked done. */
import { ask, created, line, noWrite, scenario } from './define';

scenario(
  'complete',
  'named',
  line('закінчив звіт', {
    outcome: 'confirm',
    kinds: ['complete'],
    maxIntents: 1,
    noPlan: true,
    nameIncludes: 'звіт',
  }),
);

scenario('complete', 'close-meaning', line('закінчив звітність', ask));

scenario(
  'complete',
  'unknown-is-a-new-errand',
  line('закінчив презентацію для клієнта', created('презентац', { unscheduled: true })),
);

scenario('complete', 'pronoun-without-context', line('зробив це', noWrite));

scenario('complete', 'series-no-scope', line('закінчив Gym', ask));

scenario(
  'complete',
  'series-today',
  line('сьогоднішній Gym уже зробив', { outcome: 'refuse', maxIntents: 0, noPlan: true }),
);

scenario(
  'complete',
  'series-all',
  line('всю серію Gym познач виконаною', {
    outcome: 'confirm',
    kinds: ['complete'],
    maxIntents: 1,
    noPlan: true,
    nameIncludes: 'Gym',
  }),
);
