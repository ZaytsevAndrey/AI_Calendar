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
import TimePicker from 'rsuite/TimePicker';
import 'rsuite/dist/rsuite.min.css';

/** Local wall-clock HH:mm; avoids locale-dependent `toTimeString()` truncation bugs. */
function formatPickerTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function parseTimeToDate(time: string | undefined): Date | null {
  if (!time) return null;
  const d = new Date(`2000-01-01T${time}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

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
  const TimePickerAny = TimePicker as any;

  return (
    <div className="form-group">
      <label htmlFor="timeRange">{t('phases.timeRange')}</label>
      <div className="phase-time-range-grid">
        <div className="phase-time-range-col">
          <label className="phase-time-range-label">{t('phases.start')}</label>
          <Controller
            name={'startTime' as Path<TFieldValues>}
            control={control}
            render={({ field }) => (
              <TimePickerAny
                key="phase-start-time"
                format="HH:mm"
                className="phase-time-range-picker"
                popupClassName="phase-time-range-popup"
                placement="auto"
                preventOverflow
                menuStyle={{ zIndex: 10000 }}
                value={parseTimeToDate(field.value)}
                onChange={(val: Date | null) => {
                  if (val) field.onChange(formatPickerTime(val));
                }}
                showMeridiem={false}
                placeholder={t('phases.startPlaceholder')}
                cleanable={false}
                block
                container={() => document.body}
              />
            )}
          />
        </div>

        <div className="phase-time-range-col">
          <label className="phase-time-range-label">{t('phases.end')}</label>
          <Controller
            name={'endTime' as Path<TFieldValues>}
            control={control}
            render={({ field }) => (
              <TimePickerAny
                key="phase-end-time"
                format="HH:mm"
                className="phase-time-range-picker"
                popupClassName="phase-time-range-popup"
                placement="auto"
                preventOverflow
                menuStyle={{ zIndex: 10000 }}
                value={parseTimeToDate(field.value)}
                onChange={(val: Date | null) => {
                  if (val) field.onChange(formatPickerTime(val));
                }}
                showMeridiem={false}
                placeholder={t('phases.endPlaceholder')}
                cleanable={false}
                block
                container={() => document.body}
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
