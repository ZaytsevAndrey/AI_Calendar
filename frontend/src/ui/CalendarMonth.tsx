import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, X, type LucideIcon } from 'lucide-react';
import { dateFnsLocale } from '../i18n/dateLocale';
import { IconButton } from './IconButton';
import { fieldClassName } from './fieldChrome';
import type { ResponsiveSize } from './controlSize';
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
  disabled?: boolean;
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
  const [picking, setPicking] = useState(false);
  const cells = useMemo(() => monthCells(cursor), [cursor]);
  const today = formatYmd(new Date());
  const swipeFrom = React.useRef<number | null>(null);

  const shiftMonth = (delta: number) => {
    onCursorChange(new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1));
  };
  const title = `${t(MONTH_KEYS[cursor.getMonth()])} ${cursor.getFullYear()}`;

  return (
    <div
      onTouchStart={(e) => {
        swipeFrom.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        const from = swipeFrom.current;
        swipeFrom.current = null;
        const to = e.changedTouches[0]?.clientX;
        if (from == null || to == null || picking) return;
        if (Math.abs(to - from) > 56) shiftMonth(to < from ? 1 : -1);
      }}
    >
      <div className="mb-2 flex items-center gap-1">
        <IconButton label={t('calendar.previousMonth')} size="sm" variant="ghost" onClick={() => shiftMonth(picking ? -12 : -1)}>
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </IconButton>
        <button
          type="button"
          aria-expanded={picking}
          onClick={() => setPicking((v) => !v)}
          className="flex h-11 min-w-0 flex-1 items-center justify-center gap-1 rounded-control text-heading font-semibold hover:bg-ide-surface md:h-8"
        >
          {picking ? cursor.getFullYear() : title}
          <ChevronDown className={cx('h-4 w-4 text-ide-muted transition', picking && 'rotate-180')} aria-hidden />
        </button>
        <IconButton label={t('calendar.nextMonth')} size="sm" variant="ghost" onClick={() => shiftMonth(picking ? 12 : 1)}>
          <ChevronRight className="h-4 w-4" aria-hidden />
        </IconButton>
      </div>
      {picking ? (
        <div className="grid grid-cols-3 gap-1.5" role="listbox" aria-label={t('common.month')}>
          {MONTH_KEYS.map((key, index) => {
            const on = index === cursor.getMonth();
            return (
              <button
                key={key}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => {
                  onCursorChange(new Date(cursor.getFullYear(), index, 1));
                  setPicking(false);
                }}
                className={cx(
                  'h-11 rounded-control text-body transition',
                  on ? 'bg-ide-accentBlue font-medium text-white' : 'hover:bg-ide-surface',
                )}
              >
                {t(key)}
              </button>
            );
          })}
        </div>
      ) : (
        <>
          <div className="mb-1 grid grid-cols-7 text-center text-caption text-ide-muted">
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
                  data-ymd={ymd}
                  disabled={mark.disabled}
                  aria-pressed={mark.selected || undefined}
                  aria-label={format(day, 'EEEE, d MMMM yyyy', { locale: dateLocale })}
                  className={cx(
                    'relative h-11 rounded-control text-body tabular-nums transition md:h-9',
                    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ide-link',
                    mark.disabled
                      ? 'cursor-not-allowed text-ide-subtle/50'
                      : mark.selected
                        ? 'bg-ide-accentBlue font-semibold text-white'
                        : mark.inRange
                          ? 'rounded-none bg-ide-selection text-ide-text'
                          : outside
                            ? 'text-ide-subtle hover:bg-ide-surface'
                            : 'text-ide-text hover:bg-ide-surface',
                    isToday && !mark.selected && 'font-semibold text-ide-link',
                  )}
                  onMouseEnter={() => onDayEnter?.(ymd)}
                  onClick={() => onDayClick(ymd)}
                >
                  {format(day, 'd', { locale: dateLocale })}
                  {isToday && !mark.selected ? (
                    <span aria-hidden className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-ide-link" />
                  ) : null}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
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
  size?: ResponsiveSize;
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
  size = 'md',
}: DateFieldTriggerProps) {
  return (
    <div className="relative">
      <button
        ref={buttonRef}
        id={id}
        type="button"
        className={fieldClassName({
          size,
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
