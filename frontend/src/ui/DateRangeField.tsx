import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { dateFnsLocale } from '../i18n/dateLocale';
import { orderYmdRange, parseYmd, ymdInRange } from './dateRange';
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
  /** Inclusive civil days, `YYYY-MM-DD`. Empty means no window. */
  start: string;
  end: string;
  onChange: (start: string, end: string) => void;
  error?: boolean;
  emptyLabel: string;
  clearLabel: string;
};

function caption(start: string, end: string, locale: ReturnType<typeof dateFnsLocale>): string {
  const from = parseYmd(start);
  const to = parseYmd(end || start);
  if (!from || !to) return '';
  const pattern = 'd MMM yyyy';
  const left = format(from, pattern, { locale });
  if (start === (end || start)) return left;
  return `${left} – ${format(to, pattern, { locale })}`;
}

export function DateRangeField({
  id,
  labelledBy,
  start,
  end,
  onChange,
  error,
  emptyLabel,
  clearLabel,
}: Props) {
  const { t } = useTranslation();
  const dateLocale = dateFnsLocale();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [cursor, setCursor] = useState(() => startOfMonth(parseYmd(start) ?? new Date()));
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  const pos = useCalendarPopover(open, buttonRef, panelRef);

  const preview = anchor
    ? orderYmdRange(anchor, hover ?? anchor)
    : start
      ? orderYmdRange(start, end || start)
      : null;

  useEffect(() => {
    if (open && !wasOpen.current) {
      setAnchor(null);
      setHover(null);
      setCursor(startOfMonth(parseYmd(start) ?? new Date()));
    }
    wasOpen.current = open;
  }, [open, start]);

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

  const pick = (day: string) => {
    if (!anchor) {
      setAnchor(day);
      onChange(day, day);
      return;
    }
    const next = orderYmdRange(anchor, day);
    setAnchor(null);
    setHover(null);
    onChange(next.start, next.end);
    setOpen(false);
  };

  const hasRange = Boolean(start);
  const text = hasRange ? caption(start, end, dateLocale) : emptyLabel;

  return (
    <>
      <DateFieldTrigger
        id={id}
        labelledBy={labelledBy}
        buttonRef={buttonRef}
        open={open}
        error={error}
        hasValue={hasRange}
        text={text}
        clearLabel={clearLabel}
        onToggle={() => setOpen((prev) => !prev)}
        onClear={() => {
          setAnchor(null);
          onChange('', '');
        }}
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
                markDay={(ymd) => ({
                  selected: preview ? ymd === preview.start || ymd === preview.end : false,
                  inRange: preview ? ymdInRange(ymd, preview.start, preview.end) : false,
                })}
                onDayEnter={anchor ? setHover : undefined}
                onDayClick={pick}
              />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
