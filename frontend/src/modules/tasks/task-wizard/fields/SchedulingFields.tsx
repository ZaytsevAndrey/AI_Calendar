import React, { useMemo } from 'react';
import { Controller, Control, FieldErrors } from 'react-hook-form';
import type { TaskWizardFormValues } from '../schema';
import {
  RECURRENCE_PATTERN_OPTIONS,
  SCHEDULING_FIELD_HINTS,
  SCHEDULING_FIELD_LABELS,
  SPLIT_UNAVAILABLE_HINT,
} from '../schedulingFields.config';
import type { PhaseSchedulingTimeBounds } from '../phaseSchedulingBounds';
import {
  buildPreferredStartSlotOptions,
  mergeSavedPreferredStartIntoOptions,
} from '../phaseSchedulingBounds';

const inp =
  'w-full rounded border border-ide-border bg-ide-input px-3 py-2 text-sm text-ide-text focus:border-ide-link focus:outline-none focus:ring-1 focus:ring-ide-link';
const lbl = 'mb-1 block text-sm font-medium text-ide-text';

type CommonFieldProps = {
  control: Control<TaskWizardFormValues>;
  errors: FieldErrors<TaskWizardFormValues>;
};

type PreferredStartProps = CommonFieldProps & {
  phaseTimeBounds: PhaseSchedulingTimeBounds | null;
};

export const FixedStartField: React.FC<CommonFieldProps> = ({ control, errors }) => (
  <div>
    <label htmlFor="task-wizard-start" className={lbl}>
      {SCHEDULING_FIELD_LABELS.scheduledStartTime} <span className="text-ide-error">*</span>
    </label>
    <Controller
      name="scheduledStartTime"
      control={control}
      render={({ field }) => (
        <input
          {...field}
          id="task-wizard-start"
          type="datetime-local"
          className={`${inp} ${errors.scheduledStartTime ? 'border-ide-error' : ''}`}
        />
      )}
    />
    {errors.scheduledStartTime ? (
      <p className="mt-1 text-sm text-ide-error" role="alert">
        {errors.scheduledStartTime.message}
      </p>
    ) : null}
  </div>
);

export const FixedEndField: React.FC<CommonFieldProps> = ({ control, errors }) => (
  <div>
    <label htmlFor="task-wizard-end" className={lbl}>
      {SCHEDULING_FIELD_LABELS.scheduledEndTime} <span className="text-ide-error">*</span>
    </label>
    <Controller
      name="scheduledEndTime"
      control={control}
      render={({ field }) => (
        <input
          {...field}
          id="task-wizard-end"
          type="datetime-local"
          className={`${inp} ${errors.scheduledEndTime ? 'border-ide-error' : ''}`}
        />
      )}
    />
    {errors.scheduledEndTime ? (
      <p className="mt-1 text-sm text-ide-error" role="alert">
        {errors.scheduledEndTime.message}
      </p>
    ) : null}
  </div>
);

export const DeadlineField: React.FC<CommonFieldProps> = ({ control }) => (
  <div>
    <label htmlFor="task-wizard-deadline" className={lbl}>
      {SCHEDULING_FIELD_LABELS.deadline}{' '}
      <span className="text-ide-muted">{SCHEDULING_FIELD_HINTS.deadline}</span>
    </label>
    <Controller
      name="deadline"
      control={control}
      render={({ field }) => (
        <input {...field} id="task-wizard-deadline" type="datetime-local" className={inp} />
      )}
    />
  </div>
);

export const EstimatedTimeField: React.FC<
  CommonFieldProps & { defaultForType: number }
> = ({ control, errors, defaultForType }) => (
  <div>
    <label htmlFor="task-wizard-duration" className={lbl}>
      {SCHEDULING_FIELD_LABELS.estimatedTimeInMinutes} <span className="text-ide-error">*</span>
    </label>
    <Controller
      name="estimatedTimeInMinutes"
      control={control}
      render={({ field }) => (
        <input
          {...field}
          id="task-wizard-duration"
          type="number"
          min={1}
          max={1440}
          className={`${inp} ${errors.estimatedTimeInMinutes ? 'border-ide-error' : ''}`}
          onChange={(e) => field.onChange(parseInt(e.target.value, 10) || 0)}
        />
      )}
    />
    <p className="mt-1 text-sm text-ide-muted">
      {SCHEDULING_FIELD_HINTS.estimatedTimeInMinutes?.replace(
        '{defaultForType}',
        String(defaultForType),
      )}
    </p>
    {errors.estimatedTimeInMinutes ? (
      <p className="mt-1 text-sm text-ide-error" role="alert">
        {errors.estimatedTimeInMinutes.message}
      </p>
    ) : null}
  </div>
);

export const AllowSplitField: React.FC<CommonFieldProps & { typeAllowsSplit: boolean }> = ({
  control,
  typeAllowsSplit,
}) => (
  <div className="rounded-md border border-ide-border bg-ide-surface p-3">
    <Controller
      name="allowSplit"
      control={control}
      render={({ field }) => (
        <label className="flex cursor-pointer items-start gap-3 text-sm text-ide-text">
          <input
            type="checkbox"
            className="mt-1"
            checked={typeAllowsSplit && !!field.value}
            disabled={!typeAllowsSplit}
            onChange={(e) => field.onChange(e.target.checked)}
            onBlur={field.onBlur}
            ref={field.ref}
            name={field.name}
          />
          <span>
            <span className="font-medium">{SCHEDULING_FIELD_LABELS.allowSplit}</span>
            <span className="mt-0.5 block text-ide-muted">
              {typeAllowsSplit
                ? SCHEDULING_FIELD_HINTS.allowSplit
                : SPLIT_UNAVAILABLE_HINT}
            </span>
          </span>
        </label>
      )}
    />
  </div>
);

export const IsRecurringField: React.FC<CommonFieldProps> = ({ control }) => (
  <div className="rounded-md border border-ide-border bg-ide-surface p-3">
    <Controller
      name="isRecurring"
      control={control}
      render={({ field }) => (
        <label className="flex cursor-pointer items-start gap-3 text-sm text-ide-text">
          <input
            type="checkbox"
            className="mt-1"
            checked={!!field.value}
            onChange={(e) => field.onChange(e.target.checked)}
            onBlur={field.onBlur}
            ref={field.ref}
            name={field.name}
          />
          <span className="font-medium">{SCHEDULING_FIELD_LABELS.isRecurring}</span>
        </label>
      )}
    />
  </div>
);

export const RecurrencePatternField: React.FC<CommonFieldProps> = ({ control, errors }) => (
  <div>
    <label htmlFor="task-wizard-recurrence" className={lbl}>
      {SCHEDULING_FIELD_LABELS.recurrencePattern} <span className="text-ide-error">*</span>
    </label>
    <Controller
      name="recurrencePattern"
      control={control}
      render={({ field: r }) => (
        <select {...r} id="task-wizard-recurrence" className={inp}>
          <option value="">Select pattern</option>
          {RECURRENCE_PATTERN_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      )}
    />
    {errors.recurrencePattern ? (
      <p className="mt-1 text-sm text-ide-error" role="alert">
        {errors.recurrencePattern.message}
      </p>
    ) : null}
  </div>
);

export const PreferredStartField: React.FC<PreferredStartProps> = ({
  control,
  errors,
  phaseTimeBounds,
}) => {
  const slotOptionsBase = useMemo(
    () => buildPreferredStartSlotOptions(phaseTimeBounds),
    [phaseTimeBounds],
  );

  return (
    <div>
      <label htmlFor="task-wizard-preferred-start" className={lbl}>
        {SCHEDULING_FIELD_LABELS.preferredStartTime}{' '}
        <span className="text-ide-muted">(optional)</span>
      </label>
      <Controller
        name="preferredStartTime"
        control={control}
        render={({ field }) => {
          const options = mergeSavedPreferredStartIntoOptions(
            slotOptionsBase,
            field.value,
            phaseTimeBounds,
          );
          return (
            <select
              id="task-wizard-preferred-start"
              className={`${inp} ${errors.preferredStartTime ? 'border-ide-error' : ''}`}
              value={field.value ?? ''}
              onChange={(e) => field.onChange(e.target.value || undefined)}
              onBlur={field.onBlur}
              ref={field.ref}
              name={field.name}
            >
              {options.map((opt) => (
                <option key={opt.value || '__none__'} value={opt.value} disabled={opt.disabled}>
                  {opt.label}
                </option>
              ))}
            </select>
          );
        }}
      />
      <p className="mt-1 text-sm text-ide-muted">
        End time is derived from preferred start plus estimated duration.
      </p>
      {errors.preferredStartTime ? (
        <p className="mt-1 text-sm text-ide-error" role="alert">
          {errors.preferredStartTime.message}
        </p>
      ) : null}
    </div>
  );
};
