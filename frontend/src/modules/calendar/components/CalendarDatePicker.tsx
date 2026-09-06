import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { enGB } from 'date-fns/locale';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const MONTHS = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
] as const;

type Props = {
    value: Date;
    label: string;
    onChange: (date: Date) => void;
};

function startOfMonth(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), 1);
}

function isSameDay(a: Date, b: Date): boolean {
    return (
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate()
    );
}

function monthCells(cursor: Date): Date[] {
    const first = startOfMonth(cursor);
    const mondayOffset = (first.getDay() + 6) % 7;
    const start = new Date(first);
    start.setDate(first.getDate() - mondayOffset);
    return Array.from({ length: 42 }, (_, i) => {
        const day = new Date(start);
        day.setDate(start.getDate() + i);
        return day;
    });
}

export function CalendarDatePicker({ value, label, onChange }: Props) {
    const [open, setOpen] = useState(false);
    const [cursor, setCursor] = useState(() => startOfMonth(value));
    const [pos, setPos] = useState({ top: 0, left: 0 });
    const buttonRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);

    const years = useMemo(() => {
        const current = new Date().getFullYear();
        const from = current - 20;
        const to = current + 10;
        return Array.from({ length: to - from + 1 }, (_, i) => from + i);
    }, []);

    const cells = useMemo(() => monthCells(cursor), [cursor]);
    const today = useMemo(() => new Date(), [open]);

    useEffect(() => {
        if (open) {
            setCursor(startOfMonth(value));
        }
    }, [open, value]);

    useEffect(() => {
        if (!open || !buttonRef.current) return;

        const place = () => {
            const rect = buttonRef.current?.getBoundingClientRect();
            if (!rect) return;
            const width = 300;
            const height = panelRef.current?.offsetHeight ?? 340;
            let left = rect.right - width;
            if (left < 8) left = 8;
            if (left + width > window.innerWidth - 8) {
                left = Math.max(8, window.innerWidth - width - 8);
            }
            let top = rect.bottom + 6;
            if (top + height > window.innerHeight - 8) {
                top = Math.max(8, rect.top - height - 6);
            }
            setPos({ top, left });
        };

        place();
        window.addEventListener('resize', place);
        return () => window.removeEventListener('resize', place);
    }, [open]);

    useEffect(() => {
        if (!open) return;

        const onDoc = (event: MouseEvent) => {
            const target = event.target as Node;
            if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) {
                return;
            }
            setOpen(false);
        };
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpen(false);
        };

        document.addEventListener('mousedown', onDoc);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDoc);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const pick = (day: Date) => {
        const next = new Date(day);
        next.setHours(value.getHours(), value.getMinutes(), 0, 0);
        onChange(next);
        setOpen(false);
    };

    const shiftMonth = (delta: number) => {
        setCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
    };

    return (
        <>
            <button
                ref={buttonRef}
                type="button"
                className="ui-btn-secondary min-w-0 max-w-[16rem] px-3 sm:max-w-xs"
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-label={`Go to date, currently ${label}`}
                onClick={() => setOpen((prev) => !prev)}
            >
                <CalendarDays className="h-4 w-4 shrink-0" aria-hidden />
                <span className="truncate">{label}</span>
                <ChevronDown className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
            </button>
            {open && typeof document !== 'undefined'
                ? createPortal(
                      <div
                          ref={panelRef}
                          role="dialog"
                          aria-label="Choose date"
                          className="fixed z-[1400] w-[300px] rounded-xl border border-ide-border bg-ide-panel p-3 shadow-ide-md"
                          style={{ top: pos.top, left: pos.left }}
                      >
                          <div className="mb-3 flex items-center gap-2">
                              <button
                                  type="button"
                                  className="ui-btn-ghost min-h-[40px] min-w-[40px] px-0"
                                  aria-label="Previous month"
                                  onClick={() => shiftMonth(-1)}
                              >
                                  <ChevronLeft className="mx-auto h-4 w-4" aria-hidden />
                              </button>
                              <label className="sr-only" htmlFor="calendar-month">
                                  Month
                              </label>
                              <select
                                  id="calendar-month"
                                  className="ui-select min-h-[40px] flex-1 py-1 text-sm"
                                  value={cursor.getMonth()}
                                  onChange={(event) =>
                                      setCursor(new Date(cursor.getFullYear(), Number(event.target.value), 1))
                                  }
                              >
                                  {MONTHS.map((month, index) => (
                                      <option key={month} value={index}>
                                          {month}
                                      </option>
                                  ))}
                              </select>
                              <label className="sr-only" htmlFor="calendar-year">
                                  Year
                              </label>
                              <select
                                  id="calendar-year"
                                  className="ui-select !w-[5.75rem] min-h-[40px] shrink-0 py-1 text-sm"
                                  value={cursor.getFullYear()}
                                  onChange={(event) =>
                                      setCursor(new Date(Number(event.target.value), cursor.getMonth(), 1))
                                  }
                              >
                                  {years.map((year) => (
                                      <option key={year} value={year}>
                                          {year}
                                      </option>
                                  ))}
                              </select>
                              <button
                                  type="button"
                                  className="ui-btn-ghost min-h-[40px] min-w-[40px] px-0"
                                  aria-label="Next month"
                                  onClick={() => shiftMonth(1)}
                              >
                                  <ChevronRight className="mx-auto h-4 w-4" aria-hidden />
                              </button>
                          </div>
                          <div className="mb-1 grid grid-cols-7 gap-0.5 text-center text-[11px] font-medium text-ide-muted">
                              {WEEKDAYS.map((day) => (
                                  <div key={day} className="py-1">
                                      {day}
                                  </div>
                              ))}
                          </div>
                          <div className="grid grid-cols-7 gap-0.5">
                              {cells.map((day) => {
                                  const outside = day.getMonth() !== cursor.getMonth();
                                  const selected = isSameDay(day, value);
                                  const isToday = isSameDay(day, today);
                                  return (
                                      <button
                                          key={`${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`}
                                          type="button"
                                          className={`min-h-[36px] rounded-md text-sm transition ${
                                              selected
                                                  ? 'bg-ide-selection text-ide-text'
                                                  : isToday
                                                    ? 'text-ide-link hover:bg-ide-surface'
                                                    : outside
                                                      ? 'text-ide-muted/60 hover:bg-ide-surface'
                                                      : 'text-ide-text hover:bg-ide-surface'
                                          }`}
                                          onClick={() => pick(day)}
                                      >
                                          {format(day, 'd', { locale: enGB })}
                                      </button>
                                  );
                              })}
                          </div>
                      </div>,
                      document.body
                  )
                : null}
        </>
    );
}
