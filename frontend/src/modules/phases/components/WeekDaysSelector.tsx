import React from 'react';
import { useTranslation } from 'react-i18next';
import { cx } from 'ui/cx';

interface WeekDaysSelectorProps {
  selectedDays: number[];
  setSelectedDays: (days: number[]) => void;
  errors: any;
}

const ORDER = [1, 2, 3, 4, 5, 6, 0];
const WORKDAYS = [1, 2, 3, 4, 5];
const WEEKEND = [6, 0];

const same = (a: number[], b: number[]) => a.length === b.length && b.every((d) => a.includes(d));

/** Weekday toggles with «Будні / Вихідні / Щодня» shortcuts. */
export const WeekDaysSelector = ({ selectedDays, setSelectedDays, errors }: WeekDaysSelectorProps) => {
  const { t } = useTranslation();
  const labels: Record<number, string> = {
    1: t('phases.mon'),
    2: t('phases.tue'),
    3: t('phases.wed'),
    4: t('phases.thu'),
    5: t('phases.fri'),
    6: t('phases.sat'),
    0: t('phases.sun'),
  };
  const toggle = (value: number) =>
    setSelectedDays(selectedDays.includes(value) ? selectedDays.filter((d) => d !== value) : [...selectedDays, value]);
  const quick = [
    { id: 'work', label: t('common.weekdays.workdays'), days: WORKDAYS },
    { id: 'weekend', label: t('common.weekdays.weekend'), days: WEEKEND },
    { id: 'every', label: t('common.weekdays.everyDay'), days: ORDER },
  ];

  return (
    <div className="form-group">
      <span id="weekdays-label" className="mb-1.5 block text-body-sm font-medium text-ide-muted">
        {t('phases.daysOfWeek')}
      </span>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {quick.map((q) => (
          <button
            key={q.id}
            type="button"
            aria-pressed={same(selectedDays, q.days)}
            onClick={() => setSelectedDays(q.days)}
            className={cx(
              'inline-flex h-9 items-center rounded-full border px-3 text-body-sm transition md:h-7',
              same(selectedDays, q.days)
                ? 'border-ide-link/60 bg-ide-link/10 text-ide-link'
                : 'border-ide-border text-ide-muted hover:text-ide-text',
            )}
          >
            {q.label}
          </button>
        ))}
      </div>
      <div id="weekDays-toggle" role="group" aria-labelledby="weekdays-label" className="grid grid-cols-7 gap-1">
        {ORDER.map((value) => {
          const on = selectedDays.includes(value);
          return (
            <button
              type="button"
              key={value}
              aria-pressed={on}
              onClick={() => toggle(value)}
              className={cx(
                'h-11 rounded-control border text-body-sm font-medium transition md:h-9',
                on ? 'border-transparent bg-ide-accentBlue text-white' : 'border-ide-border text-ide-text hover:bg-ide-surface',
              )}
            >
              {labels[value]}
            </button>
          );
        })}
      </div>
      {errors.weekDays && <span className="error-message">{errors.weekDays.message}</span>}
    </div>
  );
};
