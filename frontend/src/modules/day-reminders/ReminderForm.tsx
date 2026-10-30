import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell, Check, Plus, Trash2, X } from 'lucide-react';
import { useGetUserSettingsQuery } from 'api/userSettingsApi';
import {
  type DayReminderDTO,
  type DayReminderPattern,
  type WriteDayReminderDTO,
} from 'api/dayReminders.api';
import { KindIcon } from 'modules/calendar/kindIcons';
import { TASK_PRESETS, WEEKDAY_OPTIONS, type TaskPresetId } from 'modules/tasks/task-wizard/constants';
import { localYmd } from 'utils/ianaDateTime';
import { resolveIanaTimeZone } from 'modules/user-settings/ianaTimeZones';
import { Button } from 'ui/Button';
import { DatePicker } from 'ui/DatePicker';
import { Input } from 'ui/Input';
import { Select } from 'ui/Select';
import { Textarea } from 'ui/Textarea';
import { TimeField } from 'ui/TimeField';

const lbl = 'mb-0.5 block text-xs font-medium text-ide-text';

type ReminderFormProps = {
  initial?: DayReminderDTO;
  suggestedDueYmd?: string;
  onSubmit: (body: WriteDayReminderDTO) => void;
  onCancel: () => void;
  onDelete?: () => void;
  onPickTaskPreset?: (id: TaskPresetId) => void;
  isSubmitting?: boolean;
  isDeleting?: boolean;
};

export function ReminderForm({
  initial,
  suggestedDueYmd,
  onSubmit,
  onCancel,
  onDelete,
  onPickTaskPreset,
  isSubmitting = false,
  isDeleting = false,
}: ReminderFormProps) {
  const { t } = useTranslation();
  const { data: settings } = useGetUserSettingsQuery();
  const timeZone = resolveIanaTimeZone(settings?.timeZone);
  const defaultClock = settings?.defaultReminderTime || '09:00';
  const [name, setName] = useState(initial?.name ?? '');
  const [dueYmd, setDueYmd] = useState(
    initial?.dueYmd || suggestedDueYmd || localYmd(new Date().toISOString(), timeZone),
  );
  const [notificationTime, setNotificationTime] = useState(initial?.notificationTime ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [showDescription, setShowDescription] = useState(!!initial?.description);
  const [showMore, setShowMore] = useState(!!initial?.recurrencePattern);
  const [pattern, setPattern] = useState<DayReminderPattern | ''>(initial?.recurrencePattern ?? '');
  const [weekDays, setWeekDays] = useState<number[]>(initial?.recurrenceWeekDays ?? []);
  const [nameError, setNameError] = useState(false);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setNameError(true);
      return;
    }
    onSubmit({
      name: name.trim(),
      description: description.trim() ? description.trim() : null,
      dueYmd,
      notificationTime: notificationTime.trim() ? notificationTime : null,
      recurrencePattern: pattern || null,
      recurrenceWeekDays: pattern === 'WEEKLY' ? weekDays : null,
    });
  };

  const toggleDay = (day: number) => {
    setWeekDays((current) =>
      current.includes(day) ? current.filter((item) => item !== day) : [...current, day],
    );
  };

  return (
    <form id="reminder-form" onSubmit={submit} className="task-form">
      <div className="space-y-4">
        <div
          role="group"
          aria-label={t('tasks.form.type')}
          className="-mx-4 flex min-w-0 gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0 [&::-webkit-scrollbar]:hidden"
        >
          {onPickTaskPreset
            ? TASK_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  title={`${preset.label}: ${preset.hint}`}
                  aria-label={preset.label}
                  onClick={() => onPickTaskPreset(preset.id)}
                  className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-body-sm font-medium transition md:h-8 md:px-3 border-ide-border text-ide-muted hover:text-ide-text"
                >
                  <KindIcon kind={preset.id} className="h-4 w-4" />
                  {preset.label}
                </button>
              ))
            : null}
          <button
            type="button"
            title={`${t('tasks.preset.reminder')}: ${t('tasks.preset.reminderHint')}`}
            aria-label={t('tasks.preset.reminder')}
            aria-pressed
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-body-sm font-medium transition md:h-8 md:px-3 border-transparent bg-ide-accentBlue text-white"
          >
            <Bell className="h-4 w-4" aria-hidden />
            {t('tasks.preset.reminder')}
          </button>
        </div>

        <div>
          <label htmlFor="reminder-name" className={lbl}>
            {t('dayReminders.name')} <span className="text-ide-error">*</span>
          </label>
          <Input
            id="reminder-name"
            value={name}
            error={nameError}
            autoComplete="off"
            onChange={(event) => {
              setName(event.target.value);
              if (event.target.value.trim()) setNameError(false);
            }}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="reminder-day" className={lbl}>
              {t('dayReminders.day')}
            </label>
            <DatePicker
              id="reminder-day"
              value={dueYmd}
              onChange={setDueYmd}
              emptyLabel={t('dayReminders.day')}
            />
          </div>
          <div>
            <label htmlFor="reminder-time" className={lbl}>
              {t('dayReminders.time')}
            </label>
            <TimeField
              id="reminder-time"
              value={notificationTime}
              onChange={setNotificationTime}
              aria-label={t('dayReminders.time')}
            />
            <p className="mt-0.5 text-xs text-ide-muted">
              {t('dayReminders.timeHint', { time: defaultClock })}
            </p>
          </div>
        </div>

        {showDescription ? (
          <div>
            <label htmlFor="reminder-description" className={lbl}>
              {t('dayReminders.description')}
            </label>
            <Textarea
              id="reminder-description"
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
        ) : (
          <button
            type="button"
            className="flex min-h-11 items-center text-body-sm text-ide-link hover:underline md:min-h-0"
            onClick={() => setShowDescription(true)}
          >
            {t('tasks.form.addDescription')}
          </button>
        )}

        {showMore ? (
          <div className="space-y-3">
            <div>
              <label htmlFor="reminder-repeat" className={lbl}>
                {t('dayReminders.repeat')}
              </label>
              <Select
                id="reminder-repeat"
                value={pattern}
                onChange={(event) => setPattern(event.target.value as DayReminderPattern | '')}
              >
                <option value="">{t('dayReminders.repeatNone')}</option>
                <option value="DAILY">{t('tasks.recurrence.daily')}</option>
                <option value="WEEKLY">{t('tasks.recurrence.weekly')}</option>
                <option value="BIWEEKLY">{t('tasks.recurrence.biweekly')}</option>
                <option value="MONTHLY">{t('tasks.recurrence.monthly')}</option>
              </Select>
            </div>
            {pattern === 'WEEKLY' ? (
              <div className="flex flex-wrap gap-1">
                {WEEKDAY_OPTIONS.map((day) => (
                  <Button
                    key={day.value}
                    type="button"
                    variant={weekDays.includes(day.value) ? 'primary' : 'secondary'}
                    pressed={weekDays.includes(day.value)}
                    onClick={() => toggleDay(day.value)}
                  >
                    {day.label}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <button
            type="button"
            className="flex min-h-11 items-center text-body-sm text-ide-link hover:underline md:min-h-0"
            onClick={() => setShowMore(true)}
          >
            {t('tasks.form.moreOptions')}
          </button>
        )}
      </div>

      <div className="mt-4 flex flex-col-reverse gap-2 border-t border-ide-border pt-3 sm:flex-row sm:items-center sm:justify-end">
        {onDelete ? (
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
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
          className="w-full max-md:!hidden sm:w-auto"
          disabled={isSubmitting || isDeleting}
          icon={X}
        >
          {t('common.cancel')}
        </Button>
        <Button
          type="submit"
          className="w-full sm:w-auto"
          disabled={isSubmitting || isDeleting}
          icon={initial ? Check : Plus}
        >
          {isSubmitting
            ? t('common.saving')
            : initial
              ? t('tasks.form.saveChanges')
              : t('dayReminders.create')}
        </Button>
      </div>
    </form>
  );
}
