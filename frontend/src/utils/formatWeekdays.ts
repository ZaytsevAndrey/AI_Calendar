import i18n from 'i18n';

/** Monday-first order of JS weekday numbers (0 = Sunday). */
const ORDER = [1, 2, 3, 4, 5, 6, 0];
const KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

type Translate = (key: string) => string;

function shortName(day: number, t: Translate): string {
  return t(`phases.${KEYS[day]}`);
}

/**
 * Weekdays for people: «Щодня», «Будні», «Вихідні», «Пн–Чт», «Пн, Ср, Пт».
 * Consecutive days (Monday-first) collapse into a range of three or more.
 */
export function formatWeekdays(days: readonly number[] | null | undefined, t: Translate = (k) => i18n.t(k)): string {
  const set = new Set((days ?? []).filter((d) => d >= 0 && d <= 6));
  if (set.size === 0 || set.size === 7) return t('common.weekdays.everyDay');
  const ordered = ORDER.filter((d) => set.has(d));
  if (ordered.length === 5 && ordered.every((d) => d >= 1 && d <= 5)) return t('common.weekdays.workdays');
  if (ordered.length === 2 && set.has(6) && set.has(0)) return t('common.weekdays.weekend');

  const runs: number[][] = [];
  for (const day of ordered) {
    const last = runs[runs.length - 1];
    const prev = last?.[last.length - 1];
    if (last && prev !== undefined && ORDER.indexOf(day) === ORDER.indexOf(prev) + 1) last.push(day);
    else runs.push([day]);
  }
  return runs
    .map((run) =>
      run.length >= 3
        ? `${shortName(run[0], t)}–${shortName(run[run.length - 1], t)}`
        : run.map((d) => shortName(d, t)).join(', '),
    )
    .join(', ');
}
