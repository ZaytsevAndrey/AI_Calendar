import { formatWeekdays } from './formatWeekdays';

const names: Record<string, string> = {
  'phases.mon': 'Пн',
  'phases.tue': 'Вт',
  'phases.wed': 'Ср',
  'phases.thu': 'Чт',
  'phases.fri': 'Пт',
  'phases.sat': 'Сб',
  'phases.sun': 'Нд',
  'common.weekdays.everyDay': 'Щодня',
  'common.weekdays.workdays': 'Будні',
  'common.weekdays.weekend': 'Вихідні',
};
const t = (key: string) => names[key] ?? key;

describe('formatWeekdays', () => {
  it('names every day, workdays and the weekend', () => {
    expect(formatWeekdays([0, 1, 2, 3, 4, 5, 6], t)).toBe('Щодня');
    expect(formatWeekdays([], t)).toBe('Щодня');
    expect(formatWeekdays([1, 2, 3, 4, 5], t)).toBe('Будні');
    expect(formatWeekdays([6, 0], t)).toBe('Вихідні');
  });

  it('collapses runs of three or more, Monday first', () => {
    expect(formatWeekdays([1, 2, 3, 4], t)).toBe('Пн–Чт');
    expect(formatWeekdays([5, 6, 0], t)).toBe('Пт–Нд');
    expect(formatWeekdays([1, 3, 5], t)).toBe('Пн, Ср, Пт');
    expect(formatWeekdays([1, 2, 4, 5, 6], t)).toBe('Пн, Вт, Чт–Сб');
  });
});
