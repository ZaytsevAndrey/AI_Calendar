import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { CalendarClock } from 'lucide-react';
import { dateFnsLocale } from '../i18n/dateLocale';
import { Button } from './Button';
import { orderYmdRange, parseYmd, ymdInRange } from './dateRange';
import {
  CalendarMonth,
  DateFieldTrigger,
  calendarPopoverClassName,
  startOfMonth,
  useCalendarPopover,
} from './CalendarMonth';
import { TimeColumns } from './TimeColumns';
import {
  rangeDurationMinutes,
  withDates,
  withDuration,
  withEnd,
  withStart,
  type DateTimeRangeEdit,
  type DateTimeRangeValue,
} from './dateTimeRange';

const DURATION_CHIPS = [30, 60, 120] as const;

type Props = {
  id?: string;
  labelledBy?: string;
  startDate: string;
  endDate: string;
  start: string;
  end: string;
  onChange: (value: DateTimeRangeValue) => void;
  /** Used when the end is still empty. */
  defaultDurationMinutes?: number;
  minuteStep?: number;
  emptyLabel: string;
  clearLabel?: string;
  startLabel: string;
  endLabel: string;
  error?: boolean;
};

function rangeKey(value: DateTimeRangeValue): string {
  return `${value.startDate}|${value.endDate}|${value.start}|${value.end}`;
}

function durationLabel(
  minutes: number,
  t: (key: string, options?: Record<string, number>) => string,
): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours && rest) return t('common.hoursMinutesShort', { hours, minutes: rest });
  if (hours) return t('common.hoursShort', { count: hours });
  return t('common.minutesShort', { count: rest });
}

export function DateTimeRangeField({
  id,
  labelledBy,
  startDate,
  endDate,
  start,
  end,
  onChange,
  defaultDurationMinutes = 30,
  minuteStep = 15,
  emptyLabel,
  clearLabel,
  startLabel,
  endLabel,
  error,
}: Props) {
  const { t } = useTranslation();
  const dateLocale = dateFnsLocale();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [side, setSide] = useState<'start' | 'end'>('start');
  const [linkedMinutes, setLinkedMinutes] = useState<number | null>(null);
  const linkedRef = useRef<number | null>(null);
  const [cursor, setCursor] = useState(() => startOfMonth(parseYmd(startDate) ?? new Date()));
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  const echo = useRef(rangeKey({ startDate, endDate, start, end }));
  const pos = useCalendarPopover(open, buttonRef, panelRef);
  const durationDefault =
    Number.isFinite(defaultDurationMinutes) && defaultDurationMinutes >= 5
      ? Math.trunc(defaultDurationMinutes)
      : 30;

  useEffect(() => {
    const next = rangeKey({ startDate, endDate, start, end });
    if (next === echo.current) return;
    echo.current = next;
    linkedRef.current = null;
    setLinkedMinutes(null);
  }, [startDate, endDate, start, end]);

  useEffect(() => {
    if (open && !wasOpen.current) {
      setAnchor(null);
      setHover(null);
      setCursor(startOfMonth(parseYmd(startDate || endDate) ?? new Date()));
      setSide('start');
    }
    wasOpen.current = open;
  }, [open, startDate, endDate]);

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

  const apply = (edit: DateTimeRangeEdit) => {
    linkedRef.current = edit.linkedMinutes;
    setLinkedMinutes(edit.linkedMinutes);
    echo.current = rangeKey(edit.range);
    onChange(edit.range);
  };

  const current = (): DateTimeRangeEdit => ({
    range: { startDate, endDate, start, end },
    linkedMinutes: linkedRef.current,
  });

  const preview = anchor
    ? orderYmdRange(anchor, hover ?? anchor)
    : startDate || endDate
      ? orderYmdRange(startDate || endDate, endDate || startDate)
      : null;

  const pickDay = (day: string) => {
    if (!anchor) {
      setAnchor(day);
      apply(withDates(current(), day, day));
      return;
    }
    const next = orderYmdRange(anchor, day);
    setAnchor(null);
    setHover(null);
    apply(withDates(current(), next.start, next.end));
  };

  const from = parseYmd(startDate);
  const to = parseYmd(endDate || startDate);
  const pattern = 'd MMM yyyy';
  const caption = from
    ? !to || startDate === (endDate || startDate)
      ? format(from, pattern, { locale: dateLocale })
      : `${format(from, pattern, { locale: dateLocale })} – ${format(to, pattern, { locale: dateLocale })}`
    : '';
  const text = caption
    ? start && end
      ? `${caption} · ${start}–${end}`
      : start
        ? `${caption} · ${start}`
        : caption
    : start || end
      ? `${start || '--:--'}–${end || '--:--'}`
      : emptyLabel;
  const hasValue = Boolean(caption || start || end);
  const duration = rangeDurationMinutes({ startDate, endDate, start, end });

  return (
    <>
      <DateFieldTrigger
        id={id}
        labelledBy={labelledBy}
        buttonRef={buttonRef}
        open={open}
        error={error}
        hasValue={hasValue}
        text={text}
        clearLabel={clearLabel}
        icon={CalendarClock}
        onToggle={() => setOpen((prev) => !prev)}
        onClear={() => {
          setAnchor(null);
          setHover(null);
          apply({
            range: { startDate: '', endDate: '', start: '', end: '' },
            linkedMinutes: null,
          });
        }}
      />
      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={panelRef}
              role="dialog"
              aria-label={t('common.openDateTime')}
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
                onDayClick={pickDay}
              />
              <div className="mt-3 grid grid-cols-2 gap-2 border-t border-ide-border pt-3">
                <div>
                  <span className="mb-0.5 block text-[11px] font-medium text-ide-muted">{startLabel}</span>
                  <Button
                    variant="secondary"
                    size="sm"
                    pressed={side === 'start'}
                    className="w-full"
                    onClick={() => setSide('start')}
                  >
                    {start || '--:--'}
                  </Button>
                </div>
                <div>
                  <span className="mb-0.5 block text-[11px] font-medium text-ide-muted">{endLabel}</span>
                  <Button
                    variant="secondary"
                    size="sm"
                    pressed={side === 'end'}
                    className="w-full"
                    onClick={() => setSide('end')}
                  >
                    {end || '--:--'}
                  </Button>
                </div>
              </div>
              <p className="mt-2 text-center text-xs text-ide-muted">
                {duration != null ? durationLabel(duration, t) : t('common.duration')}
              </p>
              <div className="mt-2 flex gap-1">
                {DURATION_CHIPS.map((minutes) => (
                  <Button
                    key={minutes}
                    variant="secondary"
                    size="sm"
                    pressed={linkedMinutes === minutes}
                    disabled={!start}
                    className="flex-1"
                    onClick={() => apply(withDuration(current(), minutes))}
                  >
                    {durationLabel(minutes, t)}
                  </Button>
                ))}
              </div>
              <div className="mt-2 overflow-hidden rounded-lg border border-ide-border">
                <TimeColumns
                  value={side === 'end' ? end : start}
                  minuteStep={minuteStep}
                  listClassName="max-h-36"
                  onChange={(hm) =>
                    apply(
                      side === 'end'
                        ? withEnd(current(), hm)
                        : withStart(current(), hm, durationDefault),
                    )
                  }
                />
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
