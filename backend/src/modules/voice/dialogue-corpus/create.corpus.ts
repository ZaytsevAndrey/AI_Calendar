/**
 * Create specialist. One utterance, one branch. A split across specialists
 * lives in the dialogue corpus.
 *
 * Clock: tomorrow 07:30 Kyiv, wake 08:00. Morning is still ahead. A named
 * morning hour before 07:30 is already past. A bare hour still has a later place.
 */
import { ask, created, line, scenario } from './define';

scenario('create', 'unscheduled', line('треба підготувати презентацію для ради', created('презентац', { unscheduled: true })));

scenario(
  'create',
  'place-is-not-a-time',
  line('забрати документи з офісу', created('документ', { unscheduled: true })),
);

scenario(
  'create',
  'duration-without-when',
  line('обід на сорок хвилин', created('обід', { unscheduled: true })),
);

scenario(
  'create',
  'long-task-asks-length',
  line('треба написати дипломну', ask),
);

scenario('create', 'day-only', line('завтра оновити резюме', created('резюме')));

scenario('create', 'named-week-asks-day', line('наступного тижня ретроспектива', ask));

scenario('create', 'clock-still-ahead', line('о 16 зустріч з клієнтом', created('зустріч')));

scenario('create', 'clock-on-named-day', line('завтра об 11 стендап', created('стендап')));

scenario(
  'create',
  'relative-hours',
  line('через дві години дзвінок з керівником', created('дзвінок')),
);

scenario('create', 'event-span-is-duration', line('зустріч з 15 до 16', created('зустріч')));

scenario('create', 'whole-day-event', line('завтра весь день відрядження', created('відряджен')));

scenario('create', 'soft-clock', line('десь о 16 обід з партнером', created('обід')));

scenario(
  'create',
  'soft-clock-on-named-day',
  line('завтра орієнтовно о 19 вечеря з друзями', created('вечер')),
);

scenario('create', 'after-work', line('після роботи тренування', created('тренуван')));

scenario('create', 'window', line('дзвінок з бухгалтерією між 14 і 16', created('дзвінок')));

scenario('create', 'earliest-only', line('зустріч не раніше 17', created('зустріч')));

scenario('create', 'deadline-end-of-day', line('закрити тікет до кінця дня', created('тікет')));

scenario(
  'create',
  'from-now-until-clock',
  line('з зараз і до 18 розібрати ревʼю', created('рев')),
);

scenario(
  'create',
  'window-preferred-and-length',
  line(
    'завтра з 10 до 14 обдзвонити клієнтів, краще об 11, на пів години',
    created('клієнт'),
  ),
);

scenario('create', 'morning-still-ahead', line('сьогодні вранці зарядка', created('зарядк')));

scenario('create', 'evening', line('сьогодні ввечері прогулянка', created('прогулян')));

scenario('create', 'before-task-without-time', line('перед звітом підготувати слайди', ask));

scenario(
  'create',
  'after-task-that-is-not-open',
  line('після стоматолога забрати аналізи', ask),
);

scenario('create', 'past-clock-asks', line('зустріч о шостій ранку', ask));

scenario(
  'create',
  'past-clock-stays-on-named-day',
  line('сьогодні о сьомій ранку планерка', created('планер')),
);

scenario('create', 'half-hour-is-clock', line('зустріч о пів на пʼяту', created('зустріч')));

scenario('create', 'noon', line('опівдні обід з командою', created('обід')));

scenario(
  'create',
  'last-clock-wins',
  line('зустріч о 15, ні, краще о 17', created('зустріч')),
);

scenario(
  'create',
  'last-day-wins',
  line('стоматолог сьогодні або завтра, хай завтра', created('стоматолог')),
);

scenario('create', 'deadline-clock', line('відправити договір до 18', created('договір')));

scenario(
  'create',
  'spoken-length-on-clock',
  line('завтра об 11 зустріч на 45 хвилин', created('зустріч')),
);

scenario(
  'create',
  'spoken-length-on-day',
  line('у четвер прибирання офісу на дві години', created('прибиран')),
);

scenario('create', 'event-without-clock', line('зустріч з інвестором', ask));

scenario(
  'create',
  'ambiguous-span',
  line('з 10 до 16 розібрати беклог', ask),
);

scenario('create', 'no-name', line('постав на завтра о 15', ask));

scenario(
  'create',
  'if-there-is-time',
  line('якщо буде вікно, почитати статтю', created('статт', { unscheduled: true })),
);

scenario(
  'create',
  'urgent',
  line('терміново зібрати слайди для ради', created('urgent', { unscheduled: true })),
);

scenario(
  'create',
  'name-contains-and',
  line('підготувати питання і відповіді до співбесіди', created('співбесід', { unscheduled: true })),
);

scenario(
  'create',
  'not-a-delete',
  line('видали старі фото з телефону', created('фото', { unscheduled: true })),
);

scenario('create', 'daily-with-clock', line('щоранку о сьомій розтяжка', created('розтяжк')));

scenario(
  'create',
  'every-n-days',
  line('кожні три дні заняття з англійської', created('англійськ')),
);

scenario(
  'create',
  'last-day-of-month',
  line('в останній день місяця закрити бухгалтерію', created('бухгалтер')),
);

scenario('create', 'weekdays', line('по буднях розбір пошти', created('пошт')));

scenario('create', 'weekly-one-day', line('щопонеділка планерка о 9', created('планер')));

scenario(
  'create',
  'weekly-two-days',
  line('по понеділках і пʼятницях демо о 17', created('демо')),
);

scenario(
  'create',
  'weekend-series',
  line('щосуботи і щонеділі прибирання', created('прибиран')),
);

scenario('create', 'biweekly', line('раз на два тижні стрижка', created('стрижк')));

scenario('create', 'monthly', line('щомісяця оплата офісу', created('оплат')));

scenario(
  'create',
  'recurring-short-span',
  line('щодня планерка з 9:00 до 9:30', created('планер')),
);

scenario(
  'create',
  'series-end',
  line('щодня медитація до кінця місяця', created('медитац')),
);

scenario('create', 'daily-plain', line('щодня медитація', created('медитац')));

scenario('create', 'end-of-week', line('до кінця тижня здати кошторис', created('кошторис')));

scenario('create', 'this-weekend', line('цими вихідними поїздка за місто', created('поїздк')));
