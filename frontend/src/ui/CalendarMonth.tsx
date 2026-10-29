import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { CalendarDays, ChevronLeft, ChevronRight, X, type LucideIcon } from 'lucide-react';
import { dateFnsLocale } from '../i18n/dateLocale';
import { IconButton } from './IconButton';
import { Select } from './Select';
import { fieldClassName } from './fieldChrome';
import { cx } from './cx';
import { formatYmd } from './dateRange';

const WEEKDAY_KEYS = [
  'calendar.weekdayMon',
  'calendar.weekdayTue',
  'calendar.weekdayWed',
  'calendar.weekdayThu',
  'calendar.weekdayFri',
  'calendar.weekdaySat',
  'calendar.weekdaySun',
] as const;

const MONTH_KEYS = [
  'calendar.monthJanuary',
  'calendar.monthFebruary',
  'calendar.monthMarch',
  'calendar.monthApril',
  'calendar.monthMay',
  'calendar.monthJune',
  'calendar.monthJuly',
  'calendar.monthAugust',
  'calendar.monthSeptember',
  'calendar.monthOctober',
  'calendar.monthNovember',
  'calendar.monthDecember',
] as const;

export const calendarPopoverClassName =
  'fixed z-[1500] w-[min(320px,calc(100vw-1rem))] rounded-xl border border-ide-border bg-ide-panel p-3 shadow-ide-md';

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function monthCells(cursor: Date): Date[] {
  const first = startOfMonth(cursor);
  const mondayOffset = (first.getDay() + 6) % 7;
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - mondayOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(gridStart);
    day.setDate(gridStart.getDate() + index);
    return day;
  });
}

export type CalendarDayMark = {
  selected?: boolean;
  inRange?: boolean;
};

type CalendarMonthProps = {
  cursor: Date;
  onCursorChange: (next: Date) => void;
  markDay: (ymd: string) => CalendarDayMark;
  onDayClick: (ymd: string) => void;
  onDayEnter?: (ymd: string) => void;
};

export function CalendarMonth({
  cursor,
  onCursorChange,
  markDay,
  onDayClick,
  onDayEnter,
}: CalendarMonthProps) {
  const { t } = useTranslation();
  const dateLocale = dateFnsLocale();
  const years = useMemo(() => {
    const current = new Date().getFullYear();
    const values = new Set(Array.from({ length: 31 }, (_, index) => current - 20 + index));
    values.add(cursor.getFullYear());
    return Array.from(values).sort((left, right) => left - right);
  }, [cursor]);
  const cells = useMemo(() => monthCells(cursor), [cursor]);
  const today = formatYmd(new Date());

  const shiftMonth = (delta: number) => {
    onCursorChange(new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1));
  };

  return (
    <>
      <div className="mb-3 flex items-center gap-1.5">
        <IconButton label={t('calendar.previousMonth')} size="sm" onClick={() => shiftMonth(-1)}>
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </IconButton>
        <Select
          size="sm"
          aria-label={t('common.month')}
          value={cursor.getMonth()}
          onChange={(event) =>
            onCursorChange(new Date(cursor.getFullYear(), Number(event.target.value), 1))
          }
        >
          {MONTH_KEYS.map((key, index) => (
            <option key={key} value={index}>
              {t(key)}
            </option>
          ))}
        </Select>
        <Select
          size="sm"
          aria-label={t('common.year')}
          className="!w-[5.5rem]"
          value={cursor.getFullYear()}
          onChange={(event) =>
            onCursorChange(new Date(Number(event.target.value), cursor.getMonth(), 1))
          }
        >
          {years.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </Select>
        <IconButton label={t('calendar.nextMonth')} size="sm" onClick={() => shiftMonth(1)}>
          <ChevronRight className="h-4 w-4" aria-hidden />
        </IconButton>
      </div>
      <div className="mb-1 grid grid-cols-7 gap-0.5 text-center text-[11px] font-medium text-ide-muted">
        {WEEKDAY_KEYS.map((key) => (
          <div key={key} className="py-1">
            {t(key)}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((day) => {
          const ymd = formatYmd(day);
          const outside = day.getMonth() !== cursor.getMonth();
          const mark = markDay(ymd);
          const isToday = ymd === today;
          return (
            <button
              key={ymd}
              type="button"
              className={cx(
                'min-h-[36px] rounded-md text-sm',
                mark.selected
                  ? 'bg-ide-selection text-ide-text'
                  : mark.inRange
                    ? 'bg-ide-selection/35 text-ide-text'
                    : isToday
                      ? 'text-ide-link hover:bg-ide-surface'
                      : outside
                        ? 'text-ide-muted/60 hover:bg-ide-surface'
                        : 'text-ide-text hover:bg-ide-surface',
              )}
              onMouseEnter={() => onDayEnter?.(ymd)}
              onClick={() => onDayClick(ymd)}
            >
              {format(day, 'd', { locale: dateLocale })}
            </button>
          );
        })}
      </div>
    </>
  );
}

type DateFieldTriggerProps = {
  id?: string;
  labelledBy?: string;
  open: boolean;
  error?: boolean;
  hasValue: boolean;
  text: string;
  clearLabel?: string;
  buttonRef: React.RefObject<HTMLButtonElement>;
  onToggle: () => void;
  onClear: () => void;
  icon?: LucideIcon;
};

export function DateFieldTrigger({
  id,
  labelledBy,
  open,
  error,
  hasValue,
  text,
  clearLabel,
  buttonRef,
  onToggle,
  onClear,
  icon: Icon = CalendarDays,
}: DateFieldTriggerProps) {
  return (
    <div className="relative">
      <button
        ref={buttonRef}
        id={id}
        type="button"
        className={fieldClassName({
          size: 'sm',
          error,
          extra: cx('flex w-full items-center gap-2 text-left', hasValue && clearLabel && 'pr-9'),
        })}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-labelledby={labelledBy}
        onClick={onToggle}
      >
        <Icon className="h-4 w-4 shrink-0 text-ide-muted" aria-hidden />
        <span className={cx('truncate', hasValue ? 'text-ide-text' : 'text-ide-muted')}>{text}</span>
      </button>
      {hasValue && clearLabel ? (
        <IconButton
          label={clearLabel}
          size="sm"
          variant="ghost"
          className="absolute right-0.5 top-1/2 -translate-y-1/2"
          onClick={onClear}
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </IconButton>
      ) : null}
    </div>
  );
}

export function useCalendarPopover(
  open: boolean,
  anchorRef: { current: HTMLElement | null },
  panelRef: { current: HTMLElement | null },
) {
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!open || !anchorRef.current) return;
    const place = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(320, window.innerWidth - 16);
      const height = panelRef.current?.offsetHeight ?? 360;
      let left = rect.left;
      if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8);
      let top = rect.bottom + 6;
      if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 6);
      setPos({ top, left });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, anchorRef, panelRef]);

  return pos;
}
