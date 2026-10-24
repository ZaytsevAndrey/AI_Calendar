import React from 'react';
import {
  Control,
  Controller,
  FieldError,
  FieldErrors,
  FieldValues,
  Path,
} from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { TimeField } from 'ui/TimeField';

type WithPhaseTimes = FieldValues & { startTime: string; endTime: string };

interface TimeRangeFieldProps<TFieldValues extends WithPhaseTimes> {
  control: Control<TFieldValues>;
  errors: FieldErrors<TFieldValues>;
}

export function TimeRangeField<TFieldValues extends WithPhaseTimes>({
  control,
  errors,
}: TimeRangeFieldProps<TFieldValues>) {
  const { t } = useTranslation();

  return (
    <div className="form-group">
      <label htmlFor="timeRange">{t('phases.timeRange')}</label>
      <div className="phase-time-range-grid">
        <div className="phase-time-range-col">
          <label className="phase-time-range-label" htmlFor="phase-start-time">
            {t('phases.start')}
          </label>
          <Controller
            name={'startTime' as Path<TFieldValues>}
            control={control}
            render={({ field }) => (
              <TimeField
                id="phase-start-time"
                value={field.value || ''}
                onChange={field.onChange}
                onBlur={field.onBlur}
                aria-label={t('phases.start')}
                error={!!errors.startTime}
              />
            )}
          />
        </div>

        <div className="phase-time-range-col">
          <label className="phase-time-range-label" htmlFor="phase-end-time">
            {t('phases.end')}
          </label>
          <Controller
            name={'endTime' as Path<TFieldValues>}
            control={control}
            render={({ field }) => (
              <TimeField
                id="phase-end-time"
                value={field.value || ''}
                onChange={field.onChange}
                onBlur={field.onBlur}
                aria-label={t('phases.end')}
                error={!!errors.endTime}
              />
            )}
          />
        </div>
      </div>
      {(errors.startTime || errors.endTime) && (
        <span className="error-message">
          {(errors.startTime as FieldError | undefined)?.message ||
            (errors.endTime as FieldError | undefined)?.message}
        </span>
      )}
    </div>
  );
}
