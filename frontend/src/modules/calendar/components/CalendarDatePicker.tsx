import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays, ChevronDown } from 'lucide-react';
import { cx } from '../../../ui/cx';
import { CalendarMonth, startOfMonth } from '../../../ui/CalendarMonth';
import { PickerShell } from '../../../ui/PickerShell';
import { chipClass } from '../../../ui/DurationChips';
import { addDaysYmd, formatYmd, parseYmd } from '../../../ui/dateRange';

type Props = {
    value: Date;
    label: string;
    /** Visible text when it should be shorter than `label`. The accessible name still uses `label`. */
    caption?: string;
    onChange: (date: Date) => void;
    compact?: boolean;
};

/** «Go to date» in the calendar toolbar: popover on desktop, sheet with «Сьогодні / Завтра» on a phone. */
export function CalendarDatePicker({ value, label, caption, onChange, compact = false }: Props) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [cursor, setCursor] = useState(() => startOfMonth(value));
    const buttonRef = useRef<HTMLButtonElement>(null);
    const selected = formatYmd(value);
    const today = formatYmd(new Date());

    useEffect(() => {
        if (open) setCursor(startOfMonth(value));
        // Only when it opens.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const pick = (ymd: string) => {
        const day = parseYmd(ymd);
        if (!day) return;
        day.setHours(value.getHours(), value.getMinutes(), 0, 0);
        onChange(day);
        setOpen(false);
    };

    return (
        <>
            <button
                ref={buttonRef}
                type="button"
                className={cx(
                    compact
                        ? 'inline-flex h-9 w-full min-w-0 max-w-full items-center gap-1 overflow-hidden rounded-control border border-ide-border bg-ide-surface px-2 text-body-sm text-ide-text'
                        : 'ui-btn-secondary min-w-0 max-w-[16rem] px-3 sm:max-w-xs',
                )}
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-label={t('calendar.goToDate', { label })}
                onClick={() => setOpen((prev) => !prev)}
            >
                <CalendarDays className="h-4 w-4 shrink-0" aria-hidden />
                <span className="truncate">{caption ?? label}</span>
                <ChevronDown className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
            </button>
            <PickerShell open={open} onClose={() => setOpen(false)} anchorRef={buttonRef} title={t('calendar.chooseDate')} width={300}>
                <div className="mb-3 flex flex-wrap gap-1.5">
                    <button type="button" className={chipClass(selected === today)} onClick={() => pick(today)}>
                        {t('common.today')}
                    </button>
                    <button
                        type="button"
                        className={chipClass(selected === addDaysYmd(today, 1))}
                        onClick={() => pick(addDaysYmd(today, 1))}
                    >
                        {t('common.tomorrow')}
                    </button>
                </div>
                <CalendarMonth
                    cursor={cursor}
                    onCursorChange={setCursor}
                    markDay={(ymd) => ({ selected: ymd === selected })}
                    onDayClick={pick}
                />
            </PickerShell>
        </>
    );
}
