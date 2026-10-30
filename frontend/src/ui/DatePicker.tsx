import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { dateFnsLocale } from '../i18n/dateLocale';
import { addDaysYmd, formatYmd, parseYmd } from './dateRange';
import { CalendarMonth, DateFieldTrigger, startOfMonth } from './CalendarMonth';
import { PickerShell } from './PickerShell';
import { chipClass } from './DurationChips';
import { useIsPhone } from './useViewport';
import type { ResponsiveSize } from './controlSize';

type Props = {
  id?: string;
  labelledBy?: string;
  /** Civil day, `YYYY-MM-DD`. Empty means no day. */
  value: string;
  onChange: (ymd: string) => void;
  error?: boolean;
  emptyLabel: string;
  clearLabel?: string;
  /** Earliest selectable civil day, `YYYY-MM-DD`. */
  minYmd?: string;
  size?: ResponsiveSize;
};

function nextMonday(ymd: string): string {
  const date = parseYmd(ymd)!;
  const shift = ((8 - date.getDay()) % 7) || 7;
  return addDaysYmd(ymd, shift);
}

/** One civil day. Popover on desktop; sheet with «Сьогодні / Завтра / Пн» chips on a phone. */
export function DatePicker({ id, labelledBy, value, onChange, error, emptyLabel, clearLabel, minYmd, size }: Props) {
  const { t } = useTranslation();
  const dateLocale = dateFnsLocale();
  const phone = useIsPhone();
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(() => startOfMonth(parseYmd(value) ?? new Date()));
  const buttonRef = useRef<HTMLButtonElement>(null);
  const selected = parseYmd(value) ? value : '';
  const today = formatYmd(new Date());

  useEffect(() => {
    if (open) setCursor(startOfMonth(parseYmd(value) ?? new Date()));
    // Only when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const day = parseYmd(selected);
  const text = day ? format(day, 'EEE, d MMM yyyy', { locale: dateLocale }) : emptyLabel;
  const choose = (ymd: string) => {
    onChange(ymd);
    setOpen(false);
  };
  const quick = [
    { ymd: today, label: t('common.today') },
    { ymd: addDaysYmd(today, 1), label: t('common.tomorrow') },
    { ymd: nextMonday(today), label: format(parseYmd(nextMonday(today))!, 'EEEEEE, d MMM', { locale: dateLocale }) },
  ].filter((q) => !minYmd || q.ymd >= minYmd);

  return (
    <>
      <DateFieldTrigger
        id={id}
        labelledBy={labelledBy}
        buttonRef={buttonRef}
        open={open}
        error={error}
        hasValue={Boolean(day)}
        text={text}
        clearLabel={clearLabel}
        size={size}
        onToggle={() => setOpen((prev) => !prev)}
        onClear={() => onChange('')}
      />
      <PickerShell open={open} onClose={() => setOpen(false)} anchorRef={buttonRef} title={t('calendar.chooseDate')}>
        {phone ? (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {quick.map((q) => (
              <button key={q.ymd} type="button" className={chipClass(q.ymd === selected)} onClick={() => choose(q.ymd)}>
                {q.label}
              </button>
            ))}
          </div>
        ) : null}
        <CalendarMonth
          cursor={cursor}
          onCursorChange={setCursor}
          markDay={(ymd) => ({ selected: ymd === selected, disabled: !!minYmd && ymd < minYmd })}
          onDayClick={choose}
        />
      </PickerShell>
    </>
  );
}
