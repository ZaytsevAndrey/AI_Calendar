/** Reschedule specialist. Moves of «Звіт». Gym moves need a scope; a single day has no occurrence to move. */
import { ask, line, moved, scenario } from './define';

scenario('reschedule', 'day', line('перенеси звіт на завтра', moved));

scenario('reschedule', 'clock', line('постав звіт на 15:00', moved));

scenario('reschedule', 'window', line('звіт між 14 і 18', moved));

scenario('reschedule', 'now', line('зроби звіт зараз', moved));

scenario('reschedule', 'no-when', line('перенеси звіт', ask));

scenario('reschedule', 'past-clock', line('перенеси звіт на шосту ранку', ask));

scenario('reschedule', 'morning', line('перенеси звіт на ранок', moved));

scenario('reschedule', 'evening', line('перенеси звіт на вечір', moved));

scenario('reschedule', 'in-hours', line('через три години візьмись за звіт', moved));

scenario('reschedule', 'until-clock', line('постав звіт у вікно до 16', moved));

scenario('reschedule', 'close-meaning', line('перенеси звітність на понеділок', ask));

scenario('reschedule', 'pronoun-without-context', line('перенеси його на завтра', {
  outcome: ['clarify', 'refuse'],
  maxIntents: 0,
  noPlan: true,
}));

scenario('reschedule', 'series-no-scope', line('перенеси Gym на завтра', ask));

scenario('reschedule', 'series-all', line('перенеси всю серію Gym на 18:00', {
  outcome: 'confirm',
  kinds: ['window|shift|update'],
  maxIntents: 1,
  noPlan: true,
  nameIncludes: 'Gym',
}));

scenario(
  'reschedule',
  'series-today',
  line('перенеси сьогоднішній Gym на завтра', { outcome: 'refuse', maxIntents: 0, noPlan: true }),
);

scenario('reschedule', 'last-day-wins', line('звіт на пʼятницю, ні, на завтра', moved));
