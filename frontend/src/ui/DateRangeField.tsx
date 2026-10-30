import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { dateFnsLocale } from '../i18n/dateLocale';
import { addDaysYmd, formatYmd, orderYmdRange, parseYmd, ymdInRange } from './dateRange';
import { CalendarMonth, DateFieldTrigger, startOfMonth } from './CalendarMonth';
import { PickerShell } from './PickerShell';
import { chipClass } from './DurationChips';
import type { ResponsiveSize } from './controlSize';

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
  size?: ResponsiveSize;
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

function weekEnd(ymd: string): string {
  const day = parseYmd(ymd)!.getDay();
  return addDaysYmd(ymd, (7 - day) % 7);
}

/** Inclusive day window. Quick choices first (any, today, tomorrow, this/next week), then the month. */
export function DateRangeField({ id, labelledBy, start, end, onChange, error, emptyLabel, clearLabel, size }: Props) {
  const { t } = useTranslation();
  const dateLocale = dateFnsLocale();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [cursor, setCursor] = useState(() => startOfMonth(parseYmd(start) ?? new Date()));
  const buttonRef = useRef<HTMLButtonElement>(null);
  const today = formatYmd(new Date());

  const preview = anchor ? orderYmdRange(anchor, hover ?? anchor) : start ? orderYmdRange(start, end || start) : null;

  useEffect(() => {
    if (open) {
      setAnchor(null);
      setHover(null);
      setCursor(startOfMonth(parseYmd(start) ?? new Date()));
    }
    // Only when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const nextWeekStart = addDaysYmd(weekEnd(today), 1);
  const quick: Array<{ id: string; label: string; start: string; end: string }> = [
    { id: 'any', label: t('common.anyDates'), start: '', end: '' },
    { id: 'today', label: t('common.today'), start: today, end: today },
    { id: 'tomorrow', label: t('common.tomorrow'), start: addDaysYmd(today, 1), end: addDaysYmd(today, 1) },
    { id: 'week', label: t('common.thisWeek'), start: today, end: weekEnd(today) },
    { id: 'next', label: t('common.nextWeek'), start: nextWeekStart, end: addDaysYmd(nextWeekStart, 6) },
  ];

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
        size={size}
        onToggle={() => setOpen((prev) => !prev)}
        onClear={() => {
          setAnchor(null);
          onChange('', '');
        }}
      />
      <PickerShell open={open} onClose={() => setOpen(false)} anchorRef={buttonRef} title={t('calendar.chooseDates')}>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {quick.map((q) => {
            const on = q.start === start && q.end === (end || start);
            return (
              <button
                key={q.id}
                type="button"
                className={chipClass(on)}
                onClick={() => {
                  onChange(q.start, q.end);
                  setOpen(false);
                }}
              >
                {q.label}
              </button>
            );
          })}
        </div>
        <p className="mb-2 text-caption text-ide-muted">{anchor ? t('common.pickEndDay') : t('common.pickStartDay')}</p>
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
      </PickerShell>
    </>
  );
}
