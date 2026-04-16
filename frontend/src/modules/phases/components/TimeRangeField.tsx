import React from 'react';
import TimePicker from 'rsuite/TimePicker';
import 'rsuite/dist/rsuite.min.css';

interface TimeRangeFieldProps {
  errors: any;
  watchedValues: any;
  setValue: any;
}

export const TimeRangeField = ({
  errors,
  watchedValues,
  setValue
}: TimeRangeFieldProps) => {
  const TimePickerAny = TimePicker as any;

  return (
    <div className="form-group">
      <label htmlFor="timeRange">Time Range*</label>
      <div className="phase-time-range-grid">
        <div className="phase-time-range-col">
          <label className="phase-time-range-label">Start</label>
          <TimePickerAny
            format="HH:mm"
            className="phase-time-range-picker"
            popupClassName="phase-time-range-popup"
            placement="auto"
            preventOverflow
            menuStyle={{ zIndex: 10000 }}
            value={watchedValues.startTime ? new Date(`2020-01-01T${watchedValues.startTime}`) : null}
            onChange={(val: Date | null) => {
              if (val) {
                setValue('startTime', val.toTimeString().slice(0, 5), { shouldDirty: true, shouldValidate: true });
              }
            }}
            showMeridiem={false}
            placeholder="Start time"
            cleanable={false}
            block
            container={() => document.body}
          />
        </div>

        <div className="phase-time-range-col">
          <label className="phase-time-range-label">End</label>
          <TimePickerAny
            format="HH:mm"
            className="phase-time-range-picker"
            popupClassName="phase-time-range-popup"
            placement="auto"
            preventOverflow
            menuStyle={{ zIndex: 10000 }}
            value={watchedValues.endTime ? new Date(`2020-01-01T${watchedValues.endTime}`) : null}
            onChange={(val: Date | null) => {
              if (val) {
                setValue('endTime', val.toTimeString().slice(0, 5), { shouldDirty: true, shouldValidate: true });
              }
            }}
            showMeridiem={false}
            placeholder="End time"
            cleanable={false}
            block
            container={() => document.body}
          />
        </div>
      </div>
      {(errors.startTime || errors.endTime) && (
        <span className="error-message">
          {errors.startTime?.message || errors.endTime?.message}
        </span>
      )}
    </div>
  );
}; 