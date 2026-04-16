import React from 'react';
import { Controller, Control, FieldErrors, useWatch } from 'react-hook-form';
import type { TaskWizardFormValues } from './schema';
import { EVENT_TYPE_OPTIONS } from './constants';

const inp =
  'w-full rounded border border-ide-border bg-ide-input px-3 py-2 text-sm text-ide-text focus:border-ide-link focus:outline-none focus:ring-1 focus:ring-ide-link';
const lbl = 'mb-1 block text-sm font-medium text-ide-text';

type Props = {
  control: Control<TaskWizardFormValues>;
  errors: FieldErrors<TaskWizardFormValues>;
};

export const TaskTypeStep: React.FC<Props> = ({ control, errors }) => {
  const eventType = useWatch({ control, name: 'eventType' });
  const meta = EVENT_TYPE_OPTIONS.find((o) => o.value === eventType);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-ide-muted">
          Start by choosing the task type. Next steps will show only fields relevant for this type.
        </p>
      </div>
      <div>
        <label htmlFor="task-wizard-event-type" className={lbl}>
          Task type <span className="text-ide-error">*</span>
        </label>
        <Controller
          name="eventType"
          control={control}
          render={({ field }) => (
            <select
              {...field}
              value={field.value ?? ''}
              id="task-wizard-event-type"
              className={`${inp} ${errors.eventType ? 'border-ide-error' : ''}`}
            >
              <option value="">Select task type</option>
              {EVENT_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          )}
        />
        {errors.eventType ? (
          <p className="mt-1 text-sm text-ide-error" role="alert">
            {errors.eventType.message as string}
          </p>
        ) : null}
        {meta ? (
          <p className="mt-2 rounded-md border border-ide-border bg-ide-surface px-3 py-2 text-sm text-ide-muted">
            {meta.hint}
          </p>
        ) : null}
      </div>
    </div>
  );
};
