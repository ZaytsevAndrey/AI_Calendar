import React from 'react';
import TimeRangePicker from 'rsuite/TimeRangePicker';
import 'rsuite/dist/rsuite.min.css';

interface TimeRangeFieldProps {
  register: any;
  errors: any;
  watchedValues: any;
  setValue: any;
}

export const TimeRangeField = ({
  register,
  errors,
  watchedValues,
  setValue
}: TimeRangeFieldProps) => {
  const TimeRangePickerAny = TimeRangePicker as any;

  return (
    <div className="form-group">
      <label htmlFor="timeRange">Time Range*</label>
      <TimeRangePickerAny
        format="HH:mm"
        value={
          watchedValues.startTime && watchedValues.endTime
            ? [
                new Date(`2020-01-01T${watchedValues.startTime}`),
                new Date(`2020-01-01T${watchedValues.endTime}`)
              ]
            : null
        }
        onChange={(val: [Date, Date] | null) => {
          if (val && val[0] && val[1]) {
            setValue('startTime', val[0].toTimeString().slice(0, 5));
            setValue('endTime', val[1].toTimeString().slice(0, 5));
          }
        }}
        showMeridiem={false}
        style={{ width: 220 }}
        placeholder="Select time range"
        cleanable={false}
        block
        container={() => document.body}
      />
      {(errors.startTime || errors.endTime) && (
        <span className="error-message">
          {errors.startTime?.message || errors.endTime?.message}
        </span>
      )}
    </div>
  );
}; 