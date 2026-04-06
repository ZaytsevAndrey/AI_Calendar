import React from 'react';
import clsx from 'clsx';

interface WeekDaysSelectorProps {
  selectedDays: number[];
  setSelectedDays: (days: number[]) => void;
  errors: any;
}

const weekDays = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
];

export const WeekDaysSelector = ({
  selectedDays,
  setSelectedDays,
  errors
}: WeekDaysSelectorProps) => {
  const toggleDay = (value: number) => {
    setSelectedDays(
      selectedDays.includes(value) 
        ? selectedDays.filter(d => d !== value) 
        : [...selectedDays, value]
    );
  };

  return (
    <div className="form-group">
      <label htmlFor="weekDays-toggle">Days of Week*</label>
      <div id="weekDays-toggle" className="weekdays-toggle">
        {weekDays.map(({ value, label }) => (
          <button
            type="button"
            key={value}
            className={clsx('weekday-btn', selectedDays.includes(value) && 'active')}
            onClick={() => toggleDay(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {errors.weekDays && <span className="error-message">{errors.weekDays.message}</span>}
    </div>
  );
}; 