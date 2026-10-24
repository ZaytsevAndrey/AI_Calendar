import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from 'ui/Button';

interface WeekDaysSelectorProps {
  selectedDays: number[];
  setSelectedDays: (days: number[]) => void;
  errors: any;
}

export const WeekDaysSelector = ({
  selectedDays,
  setSelectedDays,
  errors
}: WeekDaysSelectorProps) => {
  const { t } = useTranslation();

  const weekDays = [
    { value: 1, label: t('phases.mon') },
    { value: 2, label: t('phases.tue') },
    { value: 3, label: t('phases.wed') },
    { value: 4, label: t('phases.thu') },
    { value: 5, label: t('phases.fri') },
    { value: 6, label: t('phases.sat') },
    { value: 0, label: t('phases.sun') },
  ];

  const toggleDay = (value: number) => {
    setSelectedDays(
      selectedDays.includes(value) 
        ? selectedDays.filter(d => d !== value) 
        : [...selectedDays, value]
    );
  };

  return (
    <div className="form-group">
      <label htmlFor="weekDays-toggle">{t('phases.daysOfWeek')}</label>
      <div id="weekDays-toggle" className="weekdays-toggle">
        {weekDays.map(({ value, label }) => (
          <Button
            type="button"
            key={value}
            variant="secondary"
            pressed={selectedDays.includes(value)}
            className="min-w-12 px-3"
            onClick={() => toggleDay(value)}
          >
            {label}
          </Button>
        ))}
      </div>
      {errors.weekDays && <span className="error-message">{errors.weekDays.message}</span>}
    </div>
  );
};
