import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { CalendarClock, CalendarDays } from 'lucide-react';
import { dateFnsLocale } from '../i18n/dateLocale';
import { cx } from './cx';
import { addDaysYmd, formatYmd, orderYmdRange, parseYmd, ymdInRange } from './dateRange';
import { CalendarMonth, DateFieldTrigger, startOfMonth } from './CalendarMonth';
import { PickerShell } from './PickerShell';
import { TimeColumns } from './TimeColumns';
import { TimeWheel } from './TimeWheel';
import { DateStrip } from './DateStrip';
import { DurationChips } from './DurationChips';
import { formatDurationShort } from './durationLabel';
import { useIsPhone } from './useViewport';
import {
  rangeDurationMinutes,
  withDates,
  withDuration,
  withEnd,
  withStart,
  type DateTimeRangeEdit,
  type DateTimeRangeValue,
} from './dateTimeRange';

const DURATIONS = [15, 30, 45, 60, 90, 120];

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

/**
 * Day (or day range) plus start/end clocks.
 * Desktop: popover with the month on the left and clocks + durations on the right.
 * Phone: sheet with a day strip, «Інша дата» for the month, start/end tabs, a time wheel and duration chips.
 */
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
  const phone = useIsPhone();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [side, setSide] = useState<'start' | 'end'>('start');
  const [showMonth, setShowMonth] = useState(false);
  const [linkedMinutes, setLinkedMinutes] = useState<number | null>(null);
  const linkedRef = useRef<number | null>(null);
  const [cursor, setCursor] = useState(() => startOfMonth(parseYmd(startDate) ?? new Date()));
  const buttonRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const echo = useRef(rangeKey({ startDate, endDate, start, end }));
  const durationDefault =
    Number.isFinite(defaultDurationMinutes) && defaultDurationMinutes >= 5
      ? Math.trunc(defaultDurationMinutes)
      : 30;
  const today = formatYmd(new Date());

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
      const multiDay = Boolean(startDate && endDate && startDate !== endDate);
      const offStrip = Boolean(startDate && (startDate < today || startDate > addDaysYmd(today, 13)));
      setShowMonth(multiDay || offStrip);
    }
    wasOpen.current = open;
  }, [open, startDate, endDate, today]);

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
  const pattern = phone ? 'EEEEEE, d MMM' : 'd MMM yyyy';
  const caption = from
    ? !to || startDate === (endDate || startDate)
      ? format(from, pattern, { locale: dateLocale })
      : `${format(from, pattern, { locale: dateLocale })} – ${format(to, pattern, { locale: dateLocale })}`
    : '';
  const clocks = start && end ? `${start}–${end}` : start;
  const text = caption
    ? clocks
      ? `${caption} · ${clocks}`
      : caption
    : start || end
      ? `${start || '--:--'}–${end || '--:--'}`
      : emptyLabel;
  const hasValue = Boolean(caption || start || end);
  const duration = rangeDurationMinutes({ startDate, endDate, start, end });

  const setClock = (hm: string) =>
    apply(side === 'end' ? withEnd(current(), hm) : withStart(current(), hm, durationDefault));

  const month = (
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
  );

  const sides = (
    <div role="tablist" aria-label={t('common.time')} className="grid grid-cols-2 gap-1 rounded-control bg-ide-surface p-1">
      {(['start', 'end'] as const).map((key) => {
        const on = side === key;
        const value = key === 'start' ? start : end;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => setSide(key)}
            className={cx(
              'flex min-h-11 flex-col items-center justify-center rounded-[8px] px-2 py-1 transition md:min-h-9',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ide-link',
              on ? 'bg-ide-panel text-ide-text shadow-ide' : 'text-ide-muted hover:text-ide-text',
            )}
          >
            <span className="text-caption">{key === 'start' ? startLabel : endLabel}</span>
            <span className="text-heading font-semibold tabular-nums">{value || '--:--'}</span>
          </button>
        );
      })}
    </div>
  );

  const durations = (
    <div>
      <p className="mb-1.5 text-caption text-ide-muted">
        {t('common.duration')}
        {duration != null ? <span className="ml-1 tabular-nums text-ide-text">· {formatDurationShort(duration, t)}</span> : null}
      </p>
      <DurationChips
        value={linkedMinutes ?? null}
        options={DURATIONS}
        allowCustom={phone}
        disabled={!start}
        label={t('common.duration')}
        onChange={(minutes) => apply(withDuration(current(), minutes))}
      />
    </div>
  );

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
      <PickerShell
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={buttonRef}
        title={t('calendar.chooseDateTime')}
        width={560}
      >
        {phone ? (
          <div className="flex flex-col gap-4">
            <p className="text-center text-heading font-semibold tabular-nums">{hasValue ? text : emptyLabel}</p>
            {showMonth ? (
              <div>
                <p className="mb-2 text-caption text-ide-muted">
                  {anchor ? t('common.pickEndDay') : t('common.pickStartDay')}
                </p>
                {month}
              </div>
            ) : (
              <DateStrip
                startYmd={today}
                value={startDate}
                todayYmd={today}
                label={t('calendar.chooseDate')}
                onChange={(ymd) => apply(withDates(current(), ymd, ymd))}
                trailing={
                  <button
                    type="button"
                    onClick={() => setShowMonth(true)}
                    className="flex min-h-[56px] w-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded-control bg-ide-surface px-1 text-caption text-ide-link hover:bg-ide-elevated"
                  >
                    <CalendarDays aria-hidden className="h-4 w-4" />
                    {t('common.otherDate')}
                  </button>
                }
              />
            )}
            {sides}
            <TimeWheel
              value={side === 'end' ? end : start}
              minuteStep={minuteStep > 1 ? minuteStep : 5}
              label={side === 'end' ? endLabel : startLabel}
              onChange={setClock}
            />
            {durations}
          </div>
        ) : (
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4">
            <div>
              <p className="mb-2 text-caption text-ide-muted">
                {anchor ? t('common.pickEndDay') : t('common.chooseDayOrRange')}
              </p>
              {month}
            </div>
            <div className="flex min-w-0 flex-col gap-3 border-l border-ide-border pl-4">
              {sides}
              <div className="overflow-hidden rounded-control border border-ide-border">
                <TimeColumns
                  value={side === 'end' ? end : start}
                  minuteStep={minuteStep}
                  listClassName="max-h-40"
                  onChange={setClock}
                />
              </div>
              {durations}
            </div>
          </div>
        )}
      </PickerShell>
    </>
  );
}
