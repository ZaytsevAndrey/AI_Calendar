import React, { useEffect, useRef, useState } from 'react';
import type { UseFormSetValue } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { DateTimeRangeField } from 'ui/DateTimeRangeField';
import type { TaskFormValues } from '../task-wizard/schema';
import {
  fixedSlotDraft,
  fixedSlotFields,
  type FixedSlotDraft,
  type FixedSlotFields as FixedSlotFormFields,
} from '../task-wizard/fixedSlot';

const labelText = 'block text-xs font-medium text-ide-text';

type Props = {
  startValue?: string;
  endValue?: string;
  setValue: UseFormSetValue<TaskFormValues>;
  startError?: string;
  endError?: string;
  defaultDurationMinutes: number;
  /** Civil day to preselect while no slot is set (carried over from another tab). */
  suggestedDay?: string;
  help?: React.ReactNode;
};

export function FixedSlotFields({
  startValue,
  endValue,
  setValue,
  startError,
  endError,
  defaultDurationMinutes,
  suggestedDay,
  help,
}: Props) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<FixedSlotDraft>(() =>
    !startValue && !endValue && suggestedDay
      ? { startDate: suggestedDay, endDate: suggestedDay, start: '', end: '' }
      : fixedSlotDraft(startValue, endValue),
  );
  const published = useRef<FixedSlotFormFields>({
    scheduledStartTime: startValue ?? '',
    scheduledEndTime: endValue ?? '',
  });

  useEffect(() => {
    const start = startValue ?? '';
    const end = endValue ?? '';
    if (
      start === published.current.scheduledStartTime &&
      end === published.current.scheduledEndTime
    ) {
      return;
    }
    setDraft(fixedSlotDraft(start, end));
    published.current = { scheduledStartTime: start, scheduledEndTime: end };
  }, [startValue, endValue]);

  const publish = (next: FixedSlotDraft) => {
    const fields = fixedSlotFields(next);
    const hadValue = Boolean(
      published.current.scheduledStartTime || published.current.scheduledEndTime,
    );
    const complete = Boolean(fields.scheduledStartTime && fields.scheduledEndTime);
    published.current = fields;
    setDraft(next);
    const options = { shouldDirty: true, shouldValidate: complete || hadValue };
    setValue('scheduledStartTime', fields.scheduledStartTime, options);
    setValue('scheduledEndTime', fields.scheduledEndTime, options);
  };

  const messages = [startError, endError].filter(
    (message, index, all): message is string => Boolean(message) && all.indexOf(message) === index,
  );

  return (
    <div>
      <div className="mb-0.5 flex items-center gap-1">
        <span id="task-form-slot-label" className={labelText}>
          {t('tasks.form.when')} <span className="text-ide-error">*</span>
        </span>
        {help}
      </div>
      <DateTimeRangeField
        id="task-form-slot"
        labelledBy="task-form-slot-label"
        startDate={draft.startDate}
        endDate={draft.endDate}
        start={draft.start}
        end={draft.end}
        defaultDurationMinutes={defaultDurationMinutes}
        startLabel={t('tasks.form.start')}
        endLabel={t('tasks.form.end')}
        emptyLabel={t('tasks.form.slotEmpty')}
        clearLabel={t('tasks.form.slotClear')}
        error={messages.length > 0}
        onChange={publish}
      />
      {messages.map((message) => (
        <p key={message} className="mt-0.5 text-xs text-ide-error">
          {message}
        </p>
      ))}
    </div>
  );
}
