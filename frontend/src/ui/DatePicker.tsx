import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { dateFnsLocale } from '../i18n/dateLocale';
import { parseYmd } from './dateRange';
import {
  CalendarMonth,
  DateFieldTrigger,
  calendarPopoverClassName,
  startOfMonth,
  useCalendarPopover,
} from './CalendarMonth';

type Props = {
  id?: string;
  labelledBy?: string;
  /** Civil day, `YYYY-MM-DD`. Empty means no day. */
  value: string;
  onChange: (ymd: string) => void;
  error?: boolean;
  emptyLabel: string;
  clearLabel?: string;
};

export function DatePicker({
  id,
  labelledBy,
  value,
  onChange,
  error,
  emptyLabel,
  clearLabel,
}: Props) {
  const { t } = useTranslation();
  const dateLocale = dateFnsLocale();
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(() => startOfMonth(parseYmd(value) ?? new Date()));
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  const pos = useCalendarPopover(open, buttonRef, panelRef);
  const selected = parseYmd(value) ? value : '';

  useEffect(() => {
    if (open && !wasOpen.current) {
      setCursor(startOfMonth(parseYmd(value) ?? new Date()));
    }
    wasOpen.current = open;
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const day = parseYmd(selected);
  const text = day ? format(day, 'd MMM yyyy', { locale: dateLocale }) : emptyLabel;

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
        onToggle={() => setOpen((prev) => !prev)}
        onClear={() => onChange('')}
      />
      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={panelRef}
              role="dialog"
              aria-label={t('calendar.chooseDate')}
              className={calendarPopoverClassName}
              style={{ top: pos.top, left: pos.left }}
            >
              <CalendarMonth
                cursor={cursor}
                onCursorChange={setCursor}
                markDay={(ymd) => ({ selected: ymd === selected })}
                onDayClick={(ymd) => {
                  onChange(ymd);
                  setOpen(false);
                }}
              />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
