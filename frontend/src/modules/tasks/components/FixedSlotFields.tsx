import React, { useEffect, useRef, useState } from 'react';
import type { UseFormSetValue } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { DatePicker } from 'ui/DatePicker';
import { TimeRangeField } from 'ui/TimeRangeField';
import type { TaskFormValues } from '../task-wizard/schema';
import {
  fixedSlotDraft,
  fixedSlotFields,
  type FixedSlotDraft,
  type FixedSlotFields as FixedSlotFormFields,
} from '../task-wizard/fixedSlot';

const lbl = 'mb-0.5 block text-xs font-medium text-ide-text';

type Props = {
  startValue?: string;
  endValue?: string;
  setValue: UseFormSetValue<TaskFormValues>;
  startError?: string;
  endError?: string;
};

export function FixedSlotFields({ startValue, endValue, setValue, startError, endError }: Props) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<FixedSlotDraft>(() => fixedSlotDraft(startValue, endValue));
  const draftRef = useRef(draft);
  draftRef.current = draft;
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
    const fields = fixedSlotFields(next.date, next.start, next.end);
    const hadValue = Boolean(
      published.current.scheduledStartTime || published.current.scheduledEndTime,
    );
    const complete = Boolean(fields.scheduledStartTime && fields.scheduledEndTime);
    draftRef.current = next;
    published.current = fields;
    setDraft(next);
    const options = { shouldDirty: true, shouldValidate: complete || hadValue };
    setValue('scheduledStartTime', fields.scheduledStartTime, options);
    setValue('scheduledEndTime', fields.scheduledEndTime, options);
  };

  const dateMissing = !draft.date;
  const timeMessages = [dateMissing ? undefined : startError, endError].filter(
    (message, index, all): message is string => Boolean(message) && all.indexOf(message) === index,
  );

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="min-w-0">
        <span id="task-form-date-label" className={lbl}>
          {t('tasks.form.date')} <span className="text-ide-error">*</span>
        </span>
        <DatePicker
          id="task-form-date"
          labelledBy="task-form-date-label"
          value={draft.date}
          onChange={(date) => publish({ ...draftRef.current, date })}
          error={dateMissing && !!startError}
          emptyLabel={t('tasks.form.dateEmpty')}
          clearLabel={t('tasks.form.dateClear')}
        />
        {dateMissing && startError ? (
          <p className="mt-0.5 text-xs text-ide-error">{startError}</p>
        ) : null}
      </div>
      <div className="min-w-0">
        <TimeRangeField
          startId="task-form-start"
          endId="task-form-end"
          start={draft.start}
          end={draft.end}
          startLabel={t('tasks.form.start')}
          endLabel={t('tasks.form.end')}
          required
          minuteStep={15}
          startError={!dateMissing && !!startError}
          endError={!!endError}
          onChange={(start, end) => publish({ ...draftRef.current, start, end })}
        />
        {timeMessages.map((message) => (
          <p key={message} className="mt-0.5 text-xs text-ide-error">
            {message}
          </p>
        ))}
      </div>
    </div>
  );
}
