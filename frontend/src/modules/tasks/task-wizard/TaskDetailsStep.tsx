import React from 'react';
import { Controller, Control, FieldErrors } from 'react-hook-form';
import type { TaskWizardFormValues } from './schema';
import { PRIORITY_OPTIONS } from './constants';

const inp =
  'w-full rounded border border-ide-border bg-ide-input px-3 py-2 text-sm text-ide-text focus:border-ide-link focus:outline-none focus:ring-1 focus:ring-ide-link';
const lbl = 'mb-1 block text-sm font-medium text-ide-text';

type Props = {
  control: Control<TaskWizardFormValues>;
  errors: FieldErrors<TaskWizardFormValues>;
};

export const TaskDetailsStep: React.FC<Props> = ({ control, errors }) => {
  return (
    <div className="space-y-5">
      <p className="text-sm text-ide-muted">Add core details shared by all task types.</p>
      <div>
        <label htmlFor="task-wizard-name" className={lbl}>
          Task name <span className="text-ide-error">*</span>
        </label>
        <Controller
          name="name"
          control={control}
          render={({ field }) => (
            <input
              {...field}
              id="task-wizard-name"
              autoComplete="off"
              className={`${inp} ${errors.name ? 'border-ide-error' : ''}`}
              placeholder="e.g. Prepare quarterly review"
            />
          )}
        />
        {errors.name ? (
          <p className="mt-1 text-sm text-ide-error" role="alert">
            {errors.name.message}
          </p>
        ) : null}
      </div>

      <div>
        <label htmlFor="task-wizard-description" className={lbl}>
          Description <span className="text-ide-muted">(optional)</span>
        </label>
        <Controller
          name="description"
          control={control}
          render={({ field }) => (
            <textarea
              {...field}
              id="task-wizard-description"
              rows={3}
              className={inp}
              placeholder="Context, links, or acceptance criteria"
            />
          )}
        />
      </div>

      <div>
        <label htmlFor="task-wizard-priority" className={lbl}>
          Priority
        </label>
        <Controller
          name="priority"
          control={control}
          render={({ field }) => (
            <select {...field} id="task-wizard-priority" className={inp}>
              {PRIORITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          )}
        />
      </div>
    </div>
  );
};
