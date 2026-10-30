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
  PRIORITY_OPTIONS,
  STATUS_OPTIONS,
  ALL_DAYS,
  recurrenceOptionsFor,
  TASK_PRESETS,
  WEEKDAY_OPTIONS,
  WORKDAYS,
  type TaskPresetId,
} from '../task-wizard/constants';
import { switchPreset } from '../task-wizard/presetSwitch';
import { quickWindows } from '../task-wizard/quickWindows';
import { KindIcon } from 'modules/calendar/kindIcons';
import {
  buildPreferredStartSlotOptions,
  getPhaseSchedulingTimeBounds,
  isPreferredStartOutsidePhaseWindow,
  mergeSavedPreferredStartIntoOptions,
} from '../task-wizard/phaseSchedulingBounds';
import { GoogleEventSettingsFields } from '../../calendar/components/GoogleEventSettingsFields';
import { LocationField } from '../../calendar/components/LocationField';
import { dateTimeLocalYmd, localYmd } from '../../../utils/ianaDateTime';
import { Bell, Check, Info, Plus, SkipForward, Trash2, X } from 'lucide-react';
import { Button } from 'ui/Button';
import { DatePicker } from 'ui/DatePicker';
import { DateRangeField } from 'ui/DateRangeField';
import { HelpTip } from 'ui/HelpTip';
import { IconButton } from 'ui/IconButton';
import { FixedSlotFields } from './FixedSlotFields';
import { readDismissedTypes, TaskTypeInfo } from './TaskTypeInfo';
import { Input } from 'ui/Input';
import { Select } from 'ui/Select';
import { Textarea } from 'ui/Textarea';

const labelText = 'block text-xs font-medium text-ide-text';
const DURATION_CHIPS = [15, 30, 60, 90] as const;

/** Small one-tap preset, same look as the phase chips. */
function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      className={`filter-chip h-7 px-2 text-xs font-normal ${on ? 'filter-chip-on' : 'text-ide-muted'}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function sameDays(a: number[], b: number[]): boolean {
  return a.length === b.length && b.every((day) => a.includes(day));
}

type FieldLabelProps = {
  label: string;
  htmlFor?: string;
  id?: string;
  required?: boolean;
  help?: React.ReactNode;
};

function FieldLabel({ label, htmlFor, id, required, help }: FieldLabelProps) {
  const { t } = useTranslation();
  const text = (
    <>
      {label}
      {required ? <span className="text-ide-error"> *</span> : null}
    </>
  );
  return (
    <div className="mb-0.5 flex items-center gap-1">
      {htmlFor ? (
        <label htmlFor={htmlFor} id={id} className={labelText}>
          {text}
        </label>
      ) : (
        <span id={id} className={labelText}>
          {text}
        </span>
      )}
      {help ? <HelpTip label={t('tasks.form.helpAbout', { field: label })}>{help}</HelpTip> : null}
    </div>
  );
}

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
  /** Lets the host ask before closing over unsaved input. */
  onDirtyChange?: (dirty: boolean) => void;
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
  onDirtyChange,
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
  const hasDescription =
    !!initialData?.description || !!createDefaults?.formPrefill?.description;
  const [showDescription, setShowDescription] = useState(hasDescription);
  const [showMore, setShowMore] = useState(false);
  const [fixedDay, setFixedDay] = useState('');
  const [dismissedTypes] = useState(readDismissedTypes);
  const [infoVisible, setInfoVisible] = useState<Partial<Record<TaskPresetId, boolean>>>({});
  const formRef = useRef<HTMLFormElement>(null);

  const {
    control,
    handleSubmit,
    formState: { errors, isDirty },
    setValue,
    getValues,
    reset,
  } = useForm<TaskFormValues>({
    resolver: zodResolver(taskFormSchema),
    defaultValues,
    // Validate on submit: a blur error would shift the form under the next tap.
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });

  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;
  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    // Settings can arrive after the user started typing; never wipe their input.
    if (isDirtyRef.current) return;
    reset(
      initialFormValues(
        initialData,
        createDefaults,
        timeZone,
        defaultTaskDurationMinutes,
      ),
    );
    setShowDescription(
      !!initialData?.description || !!createDefaults?.formPrefill?.description,
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
  const estimatedTimeInMinutes = useWatch({ control, name: 'estimatedTimeInMinutes' });
  const location = useWatch({ control, name: 'location' });
  const googleColorId = useWatch({ control, name: 'googleColorId' });
  const googleVisibility = useWatch({ control, name: 'googleVisibility' });
  const googleTransparency = useWatch({ control, name: 'googleTransparency' });
  const googleReminderUseDefault = useWatch({ control, name: 'googleReminderUseDefault' });
  const googleReminderOverrides = useWatch({ control, name: 'googleReminderOverrides' });
  const selectedEligibleDays = useWatch({ control, name: 'eligibleWeekDays' }) ?? [];
  const showWindowDays =
    !isUnscheduled && !isFixed && !isRecurring && windowSpansMultipleDays(earliestStartTime, deadline);
  const windowStartYmd = dateTimeLocalYmd(earliestStartTime) ?? dateTimeLocalYmd(deadline) ?? '';
  const windowEndYmd = dateTimeLocalYmd(deadline) ?? dateTimeLocalYmd(earliestStartTime) ?? '';
  const seatedStartTime = useWatch({ control, name: 'seatedStartTime' });
  // Monthly repeats on the date of the first occurrence: the fixed slot day,
  // else the From day, else the seat.
  const seriesStartYmd = isFixed
    ? dateTimeLocalYmd(scheduledStartTime)
    : dateTimeLocalYmd(earliestStartTime) ??
      (seatedStartTime ? localYmd(seatedStartTime, timeZone) : null);

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

  // "Any time" still means wake → sleep, so the list stops at the day's edges.
  const dayTimeBounds = useMemo(
    () =>
      getPhaseSchedulingTimeBounds({
        startTime: userSettings?.wakeTime ?? '',
        endTime: userSettings?.sleepTime ?? '',
      }),
    [userSettings?.wakeTime, userSettings?.sleepTime],
  );
  const preferredBounds = phaseTimeBounds ?? dayTimeBounds;

  const preferredOptions = useMemo(
    () => buildPreferredStartSlotOptions(preferredBounds),
    [preferredBounds],
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

  // Hide / show is per tab: closing Fixed's block leaves Flexible's alone.
  const showInfo =
    !!activePreset &&
    (infoVisible[activePreset] ?? !dismissedTypes.includes(activePreset));
  const setInfoShown = (shown: boolean) => {
    if (!activePreset) return;
    setInfoVisible((prev) => ({ ...prev, [activePreset]: shown }));
  };

  const applyPreset = (id: TaskPresetId) => {
    if (id === activePreset) return;
    const next = switchPreset(getValues(), id, defaultTaskDurationMinutes);
    setFixedDay(next.fixedDay);
    reset({ ...getValues(), ...next.patch }, { keepDirty: true });
  };

  const setWindow = (start: string, end: string) => {
    setValue('earliestStartTime', start ? `${start}T00:00` : '', {
      shouldDirty: true,
      shouldValidate: true,
    });
    setValue('deadline', end ? `${end}T23:59` : '', {
      shouldDirty: true,
      shouldValidate: true,
    });
  };

  /** Repeat on a fixed slot: weekly on the slot's weekday until the user picks days. */
  const toggleFixedRepeat = (on: boolean) => {
    const options = { shouldDirty: true, shouldValidate: true };
    if (!on) {
      setValue('isRecurring', false, options);
      setValue('deadline', '', options);
      return;
    }
    const startYmd = dateTimeLocalYmd(getValues('scheduledStartTime'));
    const weekday = startYmd ? new Date(`${startYmd}T00:00:00Z`).getUTCDay() : null;
    setValue('recurrencePattern', 'DAILY', options);
    setValue('recurrenceWeekDays', weekday == null ? [...WORKDAYS] : [weekday], options);
    setValue('isRecurring', true, options);
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

  const windows = quickWindows(new Date().toISOString(), timeZone);

  /** Fixed adds "Does not repeat"; Recurring is always a series. */
  const chooseRepeat = (pattern: string) => {
    if (pattern === 'NONE') {
      toggleFixedRepeat(false);
      return;
    }
    if (!getValues('isRecurring')) toggleFixedRepeat(true);
    setValue('recurrencePattern', pattern, { shouldDirty: true, shouldValidate: true });
  };

  const repeatSelect = (withNone: boolean) => (
    <div>
      <FieldLabel
        label={t('tasks.form.repeat')}
        htmlFor="task-form-recurrence"
        help={withNone ? t('tasks.form.help.repeatFixed') : t('tasks.form.help.repeat')}
      />
      <Select
        id="task-form-recurrence"
        size="sm"
        value={isRecurring ? recurrencePattern || 'DAILY' : 'NONE'}
        onChange={(e) => chooseRepeat(e.target.value)}
      >
        {withNone ? <option value="NONE">{t('tasks.recurrence.none')}</option> : null}
        {recurrenceOptionsFor(initialData?.recurrencePattern ?? undefined).map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </Select>
      {errors.recurrencePattern ? (
        <p className="mt-0.5 text-xs text-ide-error">{errors.recurrencePattern.message}</p>
      ) : null}
    </div>
  );

  // Monthly shows its date; the other patterns pick weekdays.
  const repeatDays =
    recurrencePattern === 'MONTHLY' ? (
      <p className="text-xs text-ide-muted">
        {seriesStartYmd
          ? t('tasks.recurrence.monthlyOnDay', { day: Number(seriesStartYmd.slice(8, 10)) })
          : t('tasks.recurrence.monthlyFirstDay')}
      </p>
    ) : (
      <div>
        <FieldLabel
          label={t('tasks.form.days')}
          help={phaseTimeBounds ? t('tasks.form.daysHintWithPhase') : t('tasks.form.daysHint')}
        />
        <div className="flex flex-wrap items-center gap-1">
          {WEEKDAY_OPTIONS.map(({ value, label }) => (
            <Button
              key={value}
              type="button"
              variant="secondary"
              size="sm"
              pressed={selectedDays.includes(value)}
              className="min-w-9 px-2"
              onClick={() => toggleDay(value)}
            >
              {label}
            </Button>
          ))}
          <span className="mx-1 h-5 w-px bg-ide-border" aria-hidden />
          <Chip
            on={sameDays(selectedDays, WORKDAYS)}
            onClick={() => setValue('recurrenceWeekDays', [...WORKDAYS], { shouldDirty: true })}
          >
            {t('tasks.recurrence.workdays')}
          </Chip>
          <Chip
            on={selectedDays.length === 0 || sameDays(selectedDays, ALL_DAYS)}
            onClick={() => setValue('recurrenceWeekDays', [], { shouldDirty: true })}
          >
            {t('tasks.recurrence.everyDay')}
          </Chip>
        </div>
      </div>
    );

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit((data) => onSubmit(buildTaskPayload(data, timeZone)))}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          formRef.current?.requestSubmit();
        }
      }}
      className="task-form"
    >
      <div className="space-y-3">
        <div className="flex items-center gap-1">
          <div className="inline-flex max-w-full flex-wrap rounded-lg border border-ide-border p-0.5">
            {TASK_PRESETS.map((preset) => {
              const active = preset.id === activePreset;
              return (
                <button
                  key={preset.id}
                  type="button"
                  title={`${preset.label}: ${preset.hint}`}
                  aria-label={preset.label}
                  aria-pressed={active}
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
          {activePreset && !showInfo ? (
            <IconButton
              label={t('tasks.typeInfo.show')}
              size="sm"
              onClick={() => setInfoShown(true)}
            >
              <Info className="h-3.5 w-3.5" aria-hidden />
            </IconButton>
          ) : null}
        </div>

        {showInfo && activePreset ? (
          <TaskTypeInfo
            type={activePreset}
            onHide={() => setInfoShown(false)}
          />
        ) : null}

        {mode === 'edit' && initialData?.isRecurring && isRecurring ? (
          <p className="text-xs text-ide-muted">{t('tasks.form.seriesEditNotice')}</p>
        ) : null}

        <div>
          <FieldLabel
            label={t('tasks.form.name')}
            htmlFor="task-form-name"
            required
            help={t('tasks.form.help.name')}
          />
          <Controller
            name="name"
            control={control}
            render={({ field }) => (
              <Input
                {...field}
                id="task-form-name"
                autoComplete="off"
                autoFocus={mode === 'create'}
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

        {mode === 'edit' ? (
          <div className="sm:w-1/2 sm:pr-1.5">
            <FieldLabel
              label={t('tasks.form.status')}
              htmlFor="task-form-status"
              help={t('tasks.form.help.status')}
            />
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
        ) : null}

        {showDescription ? (
          <div>
            <FieldLabel label={t('tasks.form.description')} htmlFor="task-form-description" />
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
          <FieldLabel
            label={t('tasks.form.phase')}
            id="task-form-phase-label"
            help={t('tasks.form.help.phase')}
          />
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
          <>
            <FixedSlotFields
              startValue={scheduledStartTime}
              endValue={scheduledEndTime}
              setValue={setValue}
              startError={errors.scheduledStartTime?.message}
              endError={errors.scheduledEndTime?.message}
              defaultDurationMinutes={defaultTaskDurationMinutes}
              suggestedDay={fixedDay}
              help={
                <HelpTip label={t('tasks.form.helpAbout', { field: t('tasks.form.when') })}>
                  {t('tasks.form.help.when', { timeZone })}
                </HelpTip>
              }
            />
            <div>
              <FieldLabel label={t('calendar.eventSettings.location')} htmlFor="task-form-location" />
              <Controller
                name="location"
                control={control}
                render={({ field }) => (
                  <LocationField
                    id="task-form-location"
                    value={field.value ?? ''}
                    onChange={field.onChange}
                  />
                )}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {repeatSelect(true)}
              {isRecurring ? (
                <div>
                  <FieldLabel
                    label={t('tasks.form.seriesUntil')}
                    id="task-form-series-until-label"
                    help={t('tasks.form.help.seriesUntil')}
                  />
                  <DatePicker
                    id="task-form-series-until"
                    labelledBy="task-form-series-until-label"
                    value={dateTimeLocalYmd(deadline) ?? ''}
                    minYmd={dateTimeLocalYmd(scheduledStartTime) ?? undefined}
                    error={!!errors.deadline}
                    emptyLabel={t('tasks.form.seriesNoEnd')}
                    clearLabel={t('tasks.form.dateRangeClear')}
                    onChange={(ymd) =>
                      setValue('deadline', ymd ? `${ymd}T23:59` : '', {
                        shouldDirty: true,
                        shouldValidate: true,
                      })
                    }
                  />
                  {errors.deadline ? (
                    <p className="mt-0.5 text-xs text-ide-error">{errors.deadline.message}</p>
                  ) : null}
                </div>
              ) : null}
            </div>
            {isRecurring ? repeatDays : null}
          </>
        ) : (
          <>
            {isRecurring ? (
              <div className="space-y-3">
                {repeatSelect(false)}
                {repeatDays}
              </div>
            ) : null}

            <div>
              <FieldLabel
                label={t('tasks.form.durationMin')}
                htmlFor="task-form-duration"
                required
                help={t('tasks.form.help.duration')}
              />
              <div className="flex flex-wrap items-center gap-1.5">
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
                      className="w-20"
                      error={!!errors.estimatedTimeInMinutes}
                      onChange={(e) => field.onChange(parseInt(e.target.value, 10) || 0)}
                    />
                  )}
                />
                {DURATION_CHIPS.map((minutes) => (
                  <Chip
                    key={minutes}
                    on={estimatedTimeInMinutes === minutes}
                    onClick={() =>
                      setValue('estimatedTimeInMinutes', minutes, {
                        shouldDirty: true,
                        shouldValidate: true,
                      })
                    }
                  >
                    {t('common.minutesShort', { count: minutes })}
                  </Chip>
                ))}
              </div>
              {errors.estimatedTimeInMinutes ? (
                <p className="mt-0.5 text-xs text-ide-error">
                  {errors.estimatedTimeInMinutes.message}
                </p>
              ) : null}
            </div>

            <div className="sm:w-1/2 sm:pr-1.5">
              <FieldLabel
                label={t('tasks.form.preferredStart')}
                htmlFor="task-form-preferred-start"
                help={t('tasks.form.help.preferredStart')}
              />
              <Controller
                name="preferredStartTime"
                control={control}
                render={({ field }) => {
                  const options = mergeSavedPreferredStartIntoOptions(
                    preferredOptions,
                    field.value,
                    preferredBounds,
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

            <div>
              <FieldLabel
                label={isRecurring ? t('tasks.form.seriesDates') : t('tasks.form.dates')}
                id="task-form-window-label"
                help={
                  isRecurring
                    ? t('tasks.form.help.seriesDates', { timeZone })
                    : t('tasks.form.windowHint', { timeZone })
                }
              />
              <DateRangeField
                id="task-form-window"
                labelledBy="task-form-window-label"
                start={windowStartYmd}
                end={windowEndYmd}
                error={!!errors.deadline}
                emptyLabel={t('tasks.form.dateRangeEmpty')}
                clearLabel={t('tasks.form.dateRangeClear')}
                onChange={setWindow}
              />
              {!isRecurring ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  {windows.map((w) => (
                    <Chip
                      key={w.id}
                      on={windowStartYmd === w.start && windowEndYmd === w.end}
                      onClick={() => setWindow(w.start, w.end)}
                    >
                      {t(`tasks.form.quickWindow.${w.id}`)}
                    </Chip>
                  ))}
                </div>
              ) : null}
              {errors.deadline ? (
                <p className="mt-0.5 text-xs text-ide-error">{errors.deadline.message}</p>
              ) : null}
            </div>

            {showWindowDays ? (
              <div>
                <FieldLabel
                  label={t('tasks.form.onlyTheseDays')}
                  help={t('tasks.form.eligibleDaysHint')}
                />
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
              </div>
            ) : null}
          </>
        )}

        </>
        ) : null}

        {showMore ? (
          <div className="space-y-3">
            <div className="sm:w-1/2 sm:pr-1.5">
              <FieldLabel
                label={t('tasks.form.priority')}
                htmlFor="task-form-priority"
                help={t('tasks.form.help.priority')}
              />
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
            {/* Later is never synced, so calendar settings wait until it is scheduled. */}
            {!isUnscheduled ? (
              <GoogleEventSettingsFields
                allowEmptyColor
                hideLocation={!!isFixed}
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
            ) : null}
          </div>
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
