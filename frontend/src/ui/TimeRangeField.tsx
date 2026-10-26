import React from 'react';
import { TimeField } from './TimeField';
import type { ResponsiveSize } from './controlSize';

export type TimeRangeFieldProps = {
  start: string;
  end: string;
  onChange: (start: string, end: string) => void;
  startLabel: string;
  endLabel: string;
  startId?: string;
  endId?: string;
  size?: ResponsiveSize;
  /** Minute interval. Values off the interval stay visible. */
  minuteStep?: number;
  startError?: boolean;
  endError?: boolean;
  disabled?: boolean;
  required?: boolean;
};

const labelClass = 'mb-0.5 block text-xs font-medium text-ide-text';

export function TimeRangeField({
  start,
  end,
  onChange,
  startLabel,
  endLabel,
  startId,
  endId,
  size = 'sm',
  minuteStep = 15,
  startError,
  endError,
  disabled,
  required,
}: TimeRangeFieldProps) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <div>
        <label htmlFor={startId} className={labelClass}>
          {startLabel}
          {required ? <span className="text-ide-error"> *</span> : null}
        </label>
        <TimeField
          id={startId}
          value={start}
          onChange={(next) => onChange(next, end)}
          size={size}
          minuteStep={minuteStep}
          error={startError}
          disabled={disabled}
          aria-label={startLabel}
        />
      </div>
      <div>
        <label htmlFor={endId} className={labelClass}>
          {endLabel}
          {required ? <span className="text-ide-error"> *</span> : null}
        </label>
        <TimeField
          id={endId}
          value={end}
          onChange={(next) => onChange(start, next)}
          size={size}
          minuteStep={minuteStep}
          error={endError}
          disabled={disabled}
          aria-label={endLabel}
        />
      </div>
    </div>
  );
}
