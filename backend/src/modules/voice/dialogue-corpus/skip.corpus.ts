/**
 * Skip specialist. An unscheduled one-off is cancelled.
 * Gym has no open occurrence, so skipping it is refused.
 * A later day, or the whole series, is a question: skip only drops the next open time.
 */
import { ask, line, noWrite, scenario } from './define';

scenario(
  'skip',
  'unscheduled',
  line('сьогодні звіт пропускаю', {
    outcome: 'confirm',
    kinds: ['cancel'],
    maxIntents: 1,
    noPlan: true,
    nameIncludes: 'звіт',
  }),
);

scenario('skip', 'another-day', line('пропусти звіт у пʼятницю', ask));

scenario('skip', 'whole-series', line('пропусти всю серію Gym', ask));

scenario(
  'skip',
  'series-no-occurrence',
  line('пропусти Gym', { outcome: 'refuse', maxIntents: 0, noPlan: true }),
);

scenario('skip', 'close-meaning', line('пропусти тренування', ask));

scenario('skip', 'pronoun-without-context', line('пропусти це', noWrite));
