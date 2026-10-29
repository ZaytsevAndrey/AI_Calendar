import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
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
  STATUS_OPTIONS,
  RECURRENCE_PATTERN_OPTIONS,
  TASK_PRESETS,
  WEEKDAY_OPTIONS,
  type TaskPresetId,
} from '../task-wizard/constants';
import { KindIcon } from 'modules/calendar/kindIcons';
import {
  buildPreferredStartSlotOptions,
  getPhaseSchedulingTimeBounds,
  isPreferredStartOutsidePhaseWindow,
  mergeSavedPreferredStartIntoOptions,
} from '../task-wizard/phaseSchedulingBounds';
import { GoogleEventSettingsFields } from '../../calendar/components/GoogleEventSettingsFields';
import { dateTimeLocalYmd } from '../../../utils/ianaDateTime';
import { Bell, Check, Plus, SkipForward, Trash2, X } from 'lucide-react';
import { Button } from 'ui/Button';
import { DateRangeField } from 'ui/DateRangeField';
import { FixedSlotFields } from './FixedSlotFields';
import { Input } from 'ui/Input';
import { Select } from 'ui/Select';
import { Textarea } from 'ui/Textarea';

const lbl = 'mb-0.5 block text-xs font-medium text-ide-text';

interface TaskFormProps {
  initialData?: TaskDTO;
  createDefaults?: {
    deadline?: string;
    earliestStartTime?: string;
    formPrefill?: TaskFormValues;
    unscheduled?: boolean;
    scheduleIntent?: boolean;
  };
  phases: PhaseDTO[];
  onSubmit: (data: CreateTaskDTO | UpdateTaskDTO) => void;
  isSubmitting: boolean;
  onCancel: () => void;
  onSkipOccurrence?: () => void;
  onDelete?: () => void;
  isDeleting?: boolean;
  mode: 'create' | 'edit';
  onPickReminder?: () => void;
}

const TaskForm: React.FC<TaskFormProps> = ({
  initialData,
  createDefaults,
  phases,
  onSubmit,
  isSubmitting,
  onCancel,
  onSkipOccurrence,
  onDelete,
  isDeleting = false,
  mode,
  onPickReminder,
}) => {
  const { t } = useTranslation();
  const { data: userSettings } = useGetUserSettingsQuery();
  const timeZone = resolveIanaTimeZone(userSettings?.timeZone);
  const defaultTaskDurationMinutes =
    typeof userSettings?.defaultTaskDurationMinutes === 'number' &&
    userSettings.defaultTaskDurationMinutes >= 5
      ? userSettings.defaultTaskDurationMinutes
      : 30;
  const defaultValues = useMemo(
    () =>
      initialFormValues(
        initialData,
        createDefaults,
        timeZone,
        defaultTaskDurationMinutes,
      ),
    [initialData, createDefaults, timeZone, defaultTaskDurationMinutes],
  );
  const [showDescription, setShowDescription] = useState(
    mode !== 'edit' && (!!initialData?.description || !!createDefaults?.formPrefill?.description),
  );
  const [showMore, setShowMore] = useState(false);

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
    reset(
      initialFormValues(
        initialData,
        createDefaults,
        timeZone,
        defaultTaskDurationMinutes,
      ),
    );
    setShowDescription(
      mode !== 'edit' && (!!initialData?.description || !!createDefaults?.formPrefill?.description),
    );
    setShowMore(false);
  }, [initialData, createDefaults, reset, timeZone, defaultTaskDurationMinutes, mode]);

  const isFixed = useWatch({ control, name: 'isFixed' });
  const isUnscheduled = useWatch({ control, name: 'isUnscheduled' });
  const isRecurring = useWatch({ control, name: 'isRecurring' });
  const allowSplit = useWatch({ control, name: 'allowSplit' });
  const recurrencePattern = useWatch({ control, name: 'recurrencePattern' });
  const phaseId = useWatch({ control, name: 'phaseId' });
  const selectedDays = useWatch({ control, name: 'recurrenceWeekDays' }) ?? [];
  const scheduledStartTime = useWatch({ control, name: 'scheduledStartTime' });
  const scheduledEndTime = useWatch({ control, name: 'scheduledEndTime' });
  const earliestStartTime = useWatch({ control, name: 'earliestStartTime' });
  const deadline = useWatch({ control, name: 'deadline' });
  const location = useWatch({ control, name: 'location' });
  const googleColorId = useWatch({ control, name: 'googleColorId' });
  const googleVisibility = useWatch({ control, name: 'googleVisibility' });
  const googleTransparency = useWatch({ control, name: 'googleTransparency' });
  const googleReminderUseDefault = useWatch({ control, name: 'googleReminderUseDefault' });
  const googleReminderOverrides = useWatch({ control, name: 'googleReminderOverrides' });
  const selectedEligibleDays = useWatch({ control, name: 'eligibleWeekDays' }) ?? [];
  const showWindowDays =
    !isUnscheduled && !isFixed && !isRecurring && windowSpansMultipleDays(earliestStartTime, deadline);

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

  const prevPhaseIdRef = useRef(phaseId);
  useEffect(() => {
    if (prevPhaseIdRef.current === phaseId) return;
    prevPhaseIdRef.current = phaseId;
    const current = getValues('preferredStartTime')?.trim();
    if (
      current &&
      isPreferredStartOutsidePhaseWindow(current, phaseTimeBounds)
    ) {
      setValue('preferredStartTime', '');
    }
  }, [phaseId, phaseTimeBounds, getValues, setValue]);

  const activePreset = matchPreset({
    isFixed: !!isFixed,
    isUnscheduled: !!isUnscheduled,
    isRecurring: !!isRecurring,
    allowSplit,
    recurrencePattern,
  });

  const applyPreset = (id: TaskPresetId) => {
    reset(
      { ...getValues(), ...presetPatch(id, defaultTaskDurationMinutes) },
      { keepDirty: true },
    );
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
        <div className="inline-flex max-w-full flex-wrap rounded-lg border border-ide-border p-0.5">
          {TASK_PRESETS.map((preset) => {
            const active = preset.id === activePreset;
            return (
              <button
                key={preset.id}
                type="button"
                title={`${preset.label}: ${preset.hint}`}
                aria-label={preset.label}
                onClick={() => applyPreset(preset.id)}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${
                  active
                    ? 'bg-ide-link text-white'
                    : 'text-ide-muted hover:text-ide-text'
                }`}
              >
                <KindIcon kind={preset.id} className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{preset.label}</span>
              </button>
            );
          })}
          {onPickReminder ? (
            <button
              type="button"
              title={`${t('tasks.preset.reminder')}: ${t('tasks.preset.reminderHint')}`}
              aria-label={t('tasks.preset.reminder')}
              onClick={onPickReminder}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-ide-muted hover:text-ide-text"
            >
              <Bell className="h-3.5 w-3.5" aria-hidden />
              <span className="hidden sm:inline">{t('tasks.preset.reminder')}</span>
            </button>
          ) : null}
        </div>

        <div>
          <label htmlFor="task-form-name" className={lbl}>
            {t('tasks.form.name')} <span className="text-ide-error">*</span>
          </label>
            <Controller
              name="name"
              control={control}
              render={({ field }) => (
                <Input
                  {...field}
                  id="task-form-name"
                  autoComplete="off"
                  placeholder={t('tasks.form.namePlaceholder')}
                  size="sm"
                  error={!!errors.name}
                />
              )}
            />
          {errors.name ? (
            <p className="mt-0.5 text-xs text-ide-error" role="alert">
              {errors.name.message}
            </p>
          ) : null}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="task-form-priority" className={lbl}>
              {t('tasks.form.priority')}
            </label>
            <Controller
              name="priority"
              control={control}
              render={({ field }) => (
                <Select {...field} id="task-form-priority" size="sm">
                  {PRIORITY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              )}
            />
          </div>
          <div>
            <label htmlFor="task-form-status" className={lbl}>
              {t('tasks.form.status')}
            </label>
            <Controller
              name="status"
              control={control}
              render={({ field }) => (
                <Select
                  {...field}
                  id="task-form-status"
                  size="sm"
                  value={field.value ?? 'todo'}
                >
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              )}
            />
          </div>
        </div>

        {showDescription ? (
          <div>
            <label htmlFor="task-form-description" className={lbl}>
              {t('tasks.form.description')}
            </label>
            <Controller
              name="description"
              control={control}
              render={({ field }) => (
                <Textarea
                  {...field}
                  id="task-form-description"
                  rows={2}
                  size="sm"
                  placeholder={t('tasks.form.descriptionPlaceholder')}
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
            {t('tasks.form.addDescription')}
          </button>
        )}

        {!isUnscheduled ? (
        <>
        {!isFixed ? (
        <div>
          <span id="task-form-phase-label" className={lbl}>
            {t('tasks.form.phase')}
          </span>
          <Controller
            name="phaseId"
            control={control}
            render={({ field }) => {
              const selected = field.value ?? '';
              return (
                <div
                  id="task-form-phase"
                  role="listbox"
                  aria-labelledby="task-form-phase-label"
                  className="flex flex-wrap gap-1.5"
                >
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected === ''}
                    className={`filter-chip h-8 px-2.5 text-xs ${
                      selected === '' ? 'filter-chip-on' : ''
                    }`}
                    onClick={() => field.onChange('')}
                  >
                    {t('tasks.form.anyTime')}
                  </button>
                  {schedulingPhases.map((phase) => {
                    const on = selected === phase.id;
                    const color = phase.color || '#808080';
                    return (
                      <button
                        type="button"
                        key={phase.id}
                        role="option"
                        aria-selected={on}
                        title={`${phase.name} (${phase.startTime}–${phase.endTime})`}
                        className={`filter-chip h-8 max-w-full px-2.5 text-xs ${
                          on ? 'filter-chip-on' : ''
                        }`}
                        style={
                          on
                            ? {
                                borderColor: color,
                                backgroundColor: `${color}33`,
                              }
                            : {
                                borderColor: `${color}88`,
                                boxShadow: `inset 3px 0 0 ${color}`,
                              }
                        }
                        onClick={() => field.onChange(phase.id)}
                      >
                        <span className="truncate">{phase.name}</span>
                        <span className="shrink-0 text-ide-muted">
                          {phase.startTime}–{phase.endTime}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            }}
          />
        </div>
        ) : null}

        {isFixed ? (
          <FixedSlotFields
            startValue={scheduledStartTime}
            endValue={scheduledEndTime}
            setValue={setValue}
            startError={errors.scheduledStartTime?.message}
            endError={errors.scheduledEndTime?.message}
            defaultDurationMinutes={defaultTaskDurationMinutes}
          />
        ) : (
          <>
            {isRecurring ? (
              <div className="space-y-2">
                <div>
                  <label htmlFor="task-form-recurrence" className={lbl}>
                    {t('tasks.form.repeat')}
                  </label>
                  <Controller
                    name="recurrencePattern"
                    control={control}
                    render={({ field }) => (
                      <Select {...field} id="task-form-recurrence" size="sm">
                        {RECURRENCE_PATTERN_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </Select>
                    )}
                  />
                  {errors.recurrencePattern ? (
                    <p className="mt-0.5 text-xs text-ide-error">{errors.recurrencePattern.message}</p>
                  ) : null}
                </div>
                {recurrencePattern !== 'MONTHLY' ? (
                  <div>
                    <span className={lbl}>{t('tasks.form.days')}</span>
                    <div className="weekdays-toggle">
                      {WEEKDAY_OPTIONS.map(({ value, label }) => (
                        <Button
                          key={value}
                          type="button"
                          variant="secondary"
                          size="sm"
                          pressed={selectedDays.includes(value)}
                          className="min-w-8 px-2"
                          onClick={() => toggleDay(value)}
                        >
                          {label}
                        </Button>
                      ))}
                    </div>
                    <p className="mt-1 text-xs text-ide-muted">
                      {phaseTimeBounds ? t('tasks.form.daysHintWithPhase') : t('tasks.form.daysHint')}
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="task-form-duration" className={lbl}>
                  {t('tasks.form.durationMin')} <span className="text-ide-error">*</span>
                </label>
                <Controller
                  name="estimatedTimeInMinutes"
                  control={control}
                  render={({ field }) => (
                    <Input
                      {...field}
                      id="task-form-duration"
                      type="number"
                      min={1}
                      max={1440}
                      size="sm"
                      error={!!errors.estimatedTimeInMinutes}
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
                  {t('tasks.form.preferredStart')}
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
                    const selected = field.value ?? '';
                    const displayValue = options.some((o) => o.value === selected)
                      ? selected
                      : '';
                    return (
                      <Select
                        id="task-form-preferred-start"
                        size="sm"
                        value={displayValue}
                        onChange={(e) => field.onChange(e.target.value)}
                        onBlur={field.onBlur}
                        ref={field.ref}
                        name={field.name}
                      >
                        {options.map((opt) => (
                          <option key={opt.value || '__none__'} value={opt.value}>
                            {opt.value === '' ? t('tasks.form.noPreference') : opt.label}
                          </option>
                        ))}
                      </Select>
                    );
                  }}
                />
              </div>
            </div>

            <div>
              <span id="task-form-window-label" className={lbl}>
                {t('tasks.form.dates')}
              </span>
              <DateRangeField
                id="task-form-window"
                labelledBy="task-form-window-label"
                start={dateTimeLocalYmd(earliestStartTime) ?? dateTimeLocalYmd(deadline) ?? ''}
                end={dateTimeLocalYmd(deadline) ?? dateTimeLocalYmd(earliestStartTime) ?? ''}
                error={!!errors.deadline}
                emptyLabel={t('tasks.form.dateRangeEmpty')}
                clearLabel={t('tasks.form.dateRangeClear')}
                onChange={(start, end) => {
                  setValue('earliestStartTime', start ? `${start}T00:00` : '', {
                    shouldDirty: true,
                    shouldValidate: true,
                  });
                  setValue('deadline', end ? `${end}T23:59` : '', {
                    shouldDirty: true,
                    shouldValidate: true,
                  });
                }}
              />
              {errors.deadline ? (
                <p className="mt-0.5 text-xs text-ide-error">{errors.deadline.message}</p>
              ) : null}
              <p className="mt-1 text-xs text-ide-muted">
                {t('tasks.form.windowHint', { timeZone })}
              </p>
            </div>

            <label
              className="inline-flex items-center gap-2 text-sm text-ide-muted"
              title={t('tasks.form.allowSplitHint')}
            >
              <Input type="checkbox" checked={!!allowSplit} disabled />
              {t('tasks.form.allowSplit')}
            </label>

            {showWindowDays ? (
              <div>
                <span className={lbl}>{t('tasks.form.onlyTheseDays')}</span>
                <div className="weekdays-toggle">
                  {WEEKDAY_OPTIONS.map(({ value, label }) => (
                    <Button
                      key={value}
                      type="button"
                      variant="secondary"
                      size="sm"
                      pressed={selectedEligibleDays.includes(value)}
                      className="min-w-8 px-2"
                      onClick={() => toggleEligibleDay(value)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
                <p className="mt-1 text-xs text-ide-muted">
                  {t('tasks.form.eligibleDaysHint')}
                </p>
              </div>
            ) : null}
          </>
        )}

        </>
        ) : null}

        {showMore ? (
          <GoogleEventSettingsFields
            allowEmptyColor
            value={{
              location: location ?? '',
              colorId: googleColorId ?? '',
              visibility: googleVisibility ?? '',
              transparency: googleTransparency ?? 'opaque',
              keepDefaultReminders: googleReminderUseDefault !== false,
              reminders: googleReminderOverrides ?? [{ method: 'popup', minutes: 10 }],
            }}
            onChange={(next) => {
              setValue('location', next.location, { shouldDirty: true });
              setValue('googleColorId', next.colorId, { shouldDirty: true });
              setValue('googleVisibility', next.visibility, { shouldDirty: true });
              setValue('googleTransparency', next.transparency, { shouldDirty: true });
              setValue('googleReminderUseDefault', next.keepDefaultReminders, { shouldDirty: true });
              setValue('googleReminderOverrides', next.reminders, { shouldDirty: true });
            }}
          />
        ) : (
          <button
            type="button"
            className="text-xs text-ide-link hover:underline"
            onClick={() => setShowMore(true)}
          >
            {t('tasks.form.moreOptions')}
          </button>
        )}
      </div>

      <div className="mt-4 flex flex-col-reverse gap-2 border-t border-ide-border pt-3 sm:flex-row sm:items-center sm:justify-end">
        {mode === 'edit' && onDelete ? (
          <Button
            type="button"
            variant="danger"
            onClick={onDelete}
            className="w-full sm:mr-auto sm:w-auto"
            disabled={isSubmitting || isDeleting}
            icon={Trash2}
          >
            {isDeleting ? t('common.deleting') : t('common.delete')}
          </Button>
        ) : null}
        {onSkipOccurrence ? (
          <Button
            type="button"
            variant="secondary"
            onClick={onSkipOccurrence}
            className={`w-full sm:w-auto${mode === 'edit' && onDelete ? '' : ' sm:mr-auto'}`}
            disabled={isSubmitting || isDeleting}
            icon={SkipForward}
          >
            {t('tasks.form.skipOccurrence')}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
          className="w-full sm:w-auto"
          disabled={isSubmitting || isDeleting}
          icon={X}
        >
          {t('common.cancel')}
        </Button>
        <Button
          type="submit"
          className="w-full sm:w-auto"
          disabled={isSubmitting || isDeleting}
          icon={mode === 'create' ? Plus : Check}
        >
          {isSubmitting
            ? t('common.saving')
            : mode === 'create'
              ? t('tasks.form.createTask')
              : t('tasks.form.saveChanges')}
        </Button>
      </div>
    </form>
  );
};

export default TaskForm;
