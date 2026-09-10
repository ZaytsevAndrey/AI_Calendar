import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useGetUserSettingsQuery } from 'api/userSettingsApi';
import { CreateTaskDTO, TaskDTO, UpdateTaskDTO } from '../../../api/tasks.api';
import { PhaseDTO } from '../../../api/phases.api';
import { resolveIanaTimeZone } from '../../user-settings/ianaTimeZones';
import { taskFormSchema, type TaskFormValues } from '../task-wizard/schema';
import { buildTaskPayload, initialFormValues, windowSpansMultipleDays } from '../task-wizard/buildPayload';
import {
  matchPreset,
  presetPatch,
  PRIORITY_OPTIONS,
  RECURRENCE_PATTERN_OPTIONS,
  TASK_PRESETS,
  WEEKDAY_OPTIONS,
  type TaskPresetId,
} from '../task-wizard/constants';
import {
  buildPreferredStartSlotOptions,
  getPhaseSchedulingTimeBounds,
  mergeSavedPreferredStartIntoOptions,
} from '../task-wizard/phaseSchedulingBounds';

const inp =
  'w-full rounded border border-ide-border bg-ide-input px-2.5 py-1.5 text-sm text-ide-text focus:border-ide-link focus:outline-none focus:ring-1 focus:ring-ide-link';
const lbl = 'mb-0.5 block text-xs font-medium text-ide-text';

interface TaskFormProps {
  initialData?: TaskDTO;
  createDefaults?: { deadline?: string; earliestStartTime?: string; formPrefill?: TaskFormValues };
  phases: PhaseDTO[];
  onSubmit: (data: CreateTaskDTO | UpdateTaskDTO) => void;
  isSubmitting: boolean;
  onCancel: () => void;
  mode: 'create' | 'edit';
}

const TaskForm: React.FC<TaskFormProps> = ({
  initialData,
  createDefaults,
  phases,
  onSubmit,
  isSubmitting,
  onCancel,
  mode,
}) => {
  const { data: userSettings } = useGetUserSettingsQuery();
  const timeZone = resolveIanaTimeZone(userSettings?.timeZone);
  const defaultValues = useMemo(
    () => initialFormValues(initialData, createDefaults, timeZone),
    [initialData, createDefaults, timeZone],
  );
  const [showDescription, setShowDescription] = useState(
    !!initialData?.description || !!createDefaults?.formPrefill?.description,
  );

  const {
    control,
    handleSubmit,
    formState: { errors },
    setValue,
    getValues,
    reset,
  } = useForm<TaskFormValues>({
    resolver: zodResolver(taskFormSchema),
    defaultValues,
    mode: 'onTouched',
  });

  useEffect(() => {
    reset(initialFormValues(initialData, createDefaults, timeZone));
    setShowDescription(!!initialData?.description || !!createDefaults?.formPrefill?.description);
  }, [initialData, createDefaults, reset, timeZone]);

  const isFixed = useWatch({ control, name: 'isFixed' });
  const isRecurring = useWatch({ control, name: 'isRecurring' });
  const allowSplit = useWatch({ control, name: 'allowSplit' });
  const recurrencePattern = useWatch({ control, name: 'recurrencePattern' });
  const phaseId = useWatch({ control, name: 'phaseId' });
  const selectedDays = useWatch({ control, name: 'recurrenceWeekDays' }) ?? [];
  const earliestStartTime = useWatch({ control, name: 'earliestStartTime' });
  const deadline = useWatch({ control, name: 'deadline' });
  const selectedEligibleDays = useWatch({ control, name: 'eligibleWeekDays' }) ?? [];
  const showWindowDays =
    !isFixed && !isRecurring && windowSpansMultipleDays(earliestStartTime, deadline);

  const wasFixed = useRef(!!isFixed);
  useEffect(() => {
    if (isFixed) {
      setValue('allowSplit', false);
      setValue('isRecurring', false);
      setValue('preferredStartTime', '');
    } else if (wasFixed.current) {
      setValue('allowSplit', true);
    }
    wasFixed.current = !!isFixed;
  }, [isFixed, setValue]);

  useEffect(() => {
    if (isRecurring && !getValues('recurrencePattern')) {
      setValue('recurrencePattern', 'DAILY');
    }
  }, [isRecurring, getValues, setValue]);

  const schedulingPhases = useMemo(() => {
    const toMinutes = (time?: string) => {
      if (!time) return Number.MAX_SAFE_INTEGER;
      const [h, m] = time.split(':').map(Number);
      if (Number.isNaN(h) || Number.isNaN(m)) return Number.MAX_SAFE_INTEGER;
      return h * 60 + m;
    };
    return phases
      .filter((p) => p.type === 'time_phase' || p.type == null)
      .sort((a, b) => {
        const diff = toMinutes(a.startTime) - toMinutes(b.startTime);
        return diff !== 0 ? diff : a.name.localeCompare(b.name);
      });
  }, [phases]);

  const phaseTimeBounds = useMemo(() => {
    const id = typeof phaseId === 'string' ? phaseId.trim() : '';
    if (!id) return null;
    const phase = phases.find((p) => p.id === id);
    return phase ? getPhaseSchedulingTimeBounds(phase) : null;
  }, [phases, phaseId]);

  const preferredOptions = useMemo(
    () => buildPreferredStartSlotOptions(phaseTimeBounds),
    [phaseTimeBounds],
  );

  const activePreset = matchPreset({
    isFixed: !!isFixed,
    isRecurring: !!isRecurring,
    allowSplit,
    recurrencePattern,
  });

  const applyPreset = (id: TaskPresetId) => {
    reset({ ...getValues(), ...presetPatch(id) }, { keepDirty: true });
  };

  const toggleDay = (day: number) => {
    const next = selectedDays.includes(day)
      ? selectedDays.filter((d) => d !== day)
      : [...selectedDays, day];
    setValue('recurrenceWeekDays', next, { shouldDirty: true });
  };

  const toggleEligibleDay = (day: number) => {
    const next = selectedEligibleDays.includes(day)
      ? selectedEligibleDays.filter((d) => d !== day)
      : [...selectedEligibleDays, day];
    setValue('eligibleWeekDays', next, { shouldDirty: true });
  };

  return (
    <form onSubmit={handleSubmit((data) => onSubmit(buildTaskPayload(data, timeZone)))} className="task-form">
      <div className="space-y-3">
        <div className="inline-flex rounded-lg border border-ide-border p-0.5">
          {TASK_PRESETS.map((preset) => {
            const active = preset.id === activePreset;
            return (
              <button
                key={preset.id}
                type="button"
                title={preset.hint}
                onClick={() => applyPreset(preset.id)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                  active
                    ? 'bg-ide-link text-white'
                    : 'text-ide-muted hover:text-ide-text'
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_8.5rem]">
          <div>
            <label htmlFor="task-form-name" className={lbl}>
              Name <span className="text-ide-error">*</span>
            </label>
            <Controller
              name="name"
              control={control}
              render={({ field }) => (
                <input
                  {...field}
                  id="task-form-name"
                  autoComplete="off"
                  placeholder="e.g. Prepare quarterly review"
                  className={`${inp} ${errors.name ? 'border-ide-error' : ''}`}
                />
              )}
            />
            {errors.name ? (
              <p className="mt-0.5 text-xs text-ide-error" role="alert">
                {errors.name.message}
              </p>
            ) : null}
          </div>
          <div>
            <label htmlFor="task-form-priority" className={lbl}>
              Priority
            </label>
            <Controller
              name="priority"
              control={control}
              render={({ field }) => (
                <select {...field} id="task-form-priority" className={inp}>
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

        {showDescription ? (
          <div>
            <label htmlFor="task-form-description" className={lbl}>
              Description
            </label>
            <Controller
              name="description"
              control={control}
              render={({ field }) => (
                <textarea
                  {...field}
                  id="task-form-description"
                  rows={2}
                  className={inp}
                  placeholder="Optional context"
                />
              )}
            />
          </div>
        ) : (
          <button
            type="button"
            className="text-xs text-ide-link hover:underline"
            onClick={() => setShowDescription(true)}
          >
            + Description
          </button>
        )}

        <div>
          <label htmlFor="task-form-phase" className={lbl}>
            Phase
          </label>
          <Controller
            name="phaseId"
            control={control}
            render={({ field }) => (
              <select
                {...field}
                id="task-form-phase"
                className={inp}
                value={field.value ?? ''}
              >
                <option value="">Any time</option>
                {schedulingPhases.map((phase) => (
                  <option key={phase.id} value={phase.id}>
                    {phase.name} ({phase.startTime}–{phase.endTime})
                  </option>
                ))}
              </select>
            )}
          />
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-ide-text">
          <Controller
            name="isFixed"
            control={control}
            render={({ field }) => (
              <label className="inline-flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!field.value}
                  onChange={(e) => field.onChange(e.target.checked)}
                  onBlur={field.onBlur}
                  ref={field.ref}
                  name={field.name}
                />
                Fixed time
              </label>
            )}
          />
          {!isFixed ? (
            <>
              <Controller
                name="isRecurring"
                control={control}
                render={({ field }) => (
                  <label className="inline-flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={!!field.value}
                      onChange={(e) => field.onChange(e.target.checked)}
                      onBlur={field.onBlur}
                      ref={field.ref}
                      name={field.name}
                    />
                    Recurring
                  </label>
                )}
              />
              <Controller
                name="allowSplit"
                control={control}
                render={({ field }) => (
                  <label className="inline-flex cursor-pointer items-center gap-2" title="Planner may split this into smaller chunks">
                    <input
                      type="checkbox"
                      checked={!!field.value}
                      onChange={(e) => field.onChange(e.target.checked)}
                      onBlur={field.onBlur}
                      ref={field.ref}
                      name={field.name}
                    />
                    Allow split
                  </label>
                )}
              />
            </>
          ) : null}
        </div>

        {isFixed ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="task-form-start" className={lbl}>
                Start <span className="text-ide-error">*</span>
              </label>
              <Controller
                name="scheduledStartTime"
                control={control}
                render={({ field }) => (
                  <input
                    {...field}
                    id="task-form-start"
                    type="datetime-local"
                    className={`${inp} ${errors.scheduledStartTime ? 'border-ide-error' : ''}`}
                  />
                )}
              />
              {errors.scheduledStartTime ? (
                <p className="mt-0.5 text-xs text-ide-error">{errors.scheduledStartTime.message}</p>
              ) : null}
            </div>
            <div>
              <label htmlFor="task-form-end" className={lbl}>
                End <span className="text-ide-error">*</span>
              </label>
              <Controller
                name="scheduledEndTime"
                control={control}
                render={({ field }) => (
                  <input
                    {...field}
                    id="task-form-end"
                    type="datetime-local"
                    className={`${inp} ${errors.scheduledEndTime ? 'border-ide-error' : ''}`}
                  />
                )}
              />
              {errors.scheduledEndTime ? (
                <p className="mt-0.5 text-xs text-ide-error">{errors.scheduledEndTime.message}</p>
              ) : null}
            </div>
          </div>
        ) : (
          <>
            {isRecurring ? (
              <div className="space-y-2">
                <div>
                  <label htmlFor="task-form-recurrence" className={lbl}>
                    Repeat
                  </label>
                  <Controller
                    name="recurrencePattern"
                    control={control}
                    render={({ field }) => (
                      <select {...field} id="task-form-recurrence" className={inp}>
                        {RECURRENCE_PATTERN_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    )}
                  />
                  {errors.recurrencePattern ? (
                    <p className="mt-0.5 text-xs text-ide-error">{errors.recurrencePattern.message}</p>
                  ) : null}
                </div>
                {recurrencePattern !== 'MONTHLY' ? (
                  <div>
                    <span className={lbl}>Days</span>
                    <div className="weekdays-toggle">
                      {WEEKDAY_OPTIONS.map(({ value, label }) => (
                        <button
                          key={value}
                          type="button"
                          className={`weekday-btn${selectedDays.includes(value) ? ' active' : ''}`}
                          onClick={() => toggleDay(value)}
                          aria-pressed={selectedDays.includes(value)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <p className="mt-1 text-xs text-ide-muted">
                      None selected = every day{phaseTimeBounds ? ' (still limited by the phase)' : ''}.
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="task-form-duration" className={lbl}>
                  Duration (min) <span className="text-ide-error">*</span>
                </label>
                <Controller
                  name="estimatedTimeInMinutes"
                  control={control}
                  render={({ field }) => (
                    <input
                      {...field}
                      id="task-form-duration"
                      type="number"
                      min={1}
                      max={1440}
                      className={`${inp} ${errors.estimatedTimeInMinutes ? 'border-ide-error' : ''}`}
                      onChange={(e) => field.onChange(parseInt(e.target.value, 10) || 0)}
                    />
                  )}
                />
                {errors.estimatedTimeInMinutes ? (
                  <p className="mt-0.5 text-xs text-ide-error">
                    {errors.estimatedTimeInMinutes.message}
                  </p>
                ) : null}
              </div>
              <div>
                <label htmlFor="task-form-preferred-start" className={lbl}>
                  Preferred start
                </label>
                <Controller
                  name="preferredStartTime"
                  control={control}
                  render={({ field }) => {
                    const options = mergeSavedPreferredStartIntoOptions(
                      preferredOptions,
                      field.value,
                      phaseTimeBounds,
                    );
                    return (
                      <select
                        id="task-form-preferred-start"
                        className={inp}
                        value={field.value ?? ''}
                        onChange={(e) => field.onChange(e.target.value)}
                        onBlur={field.onBlur}
                        ref={field.ref}
                        name={field.name}
                      >
                        {options.map((opt) => (
                          <option
                            key={opt.value || '__none__'}
                            value={opt.value}
                            disabled={opt.disabled}
                          >
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    );
                  }}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="task-form-from" className={lbl}>
                  From
                </label>
                <Controller
                  name="earliestStartTime"
                  control={control}
                  render={({ field }) => (
                    <input
                      {...field}
                      id="task-form-from"
                      type="datetime-local"
                      className={inp}
                    />
                  )}
                />
              </div>
              <div>
                <label htmlFor="task-form-deadline" className={lbl}>
                  Until
                </label>
                <Controller
                  name="deadline"
                  control={control}
                  render={({ field }) => (
                    <input
                      {...field}
                      id="task-form-deadline"
                      type="datetime-local"
                      className={`${inp} ${errors.deadline ? 'border-ide-error' : ''}`}
                    />
                  )}
                />
                {errors.deadline ? (
                  <p className="mt-0.5 text-xs text-ide-error">{errors.deadline.message}</p>
                ) : null}
              </div>
            </div>
            <p className="text-xs text-ide-muted">
              Optional. One day, a range, or empty for any time. Times use {timeZone}.
            </p>

            {showWindowDays ? (
              <div>
                <span className={lbl}>Only these days</span>
                <div className="weekdays-toggle">
                  {WEEKDAY_OPTIONS.map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      className={`weekday-btn${selectedEligibleDays.includes(value) ? ' active' : ''}`}
                      onClick={() => toggleEligibleDay(value)}
                      aria-pressed={selectedEligibleDays.includes(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-xs text-ide-muted">
                  None selected = any day in the window.
                </p>
              </div>
            ) : null}
          </>
        )}

        {isFixed ? (
          <div>
            <label htmlFor="task-form-fixed-deadline" className={lbl}>
              Deadline
            </label>
            <Controller
              name="deadline"
              control={control}
              render={({ field }) => (
                <input
                  {...field}
                  id="task-form-fixed-deadline"
                  type="datetime-local"
                  className={inp}
                />
              )}
            />
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex flex-col-reverse gap-2 border-t border-ide-border pt-3 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="ui-btn-secondary w-full sm:w-auto"
          disabled={isSubmitting}
        >
          Cancel
        </button>
        <button type="submit" className="ui-btn-primary w-full sm:w-auto" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : mode === 'create' ? 'Create task' : 'Save changes'}
        </button>
      </div>
    </form>
  );
};

export default TaskForm;
