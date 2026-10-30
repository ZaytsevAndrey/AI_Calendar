import React, { useEffect, useRef } from 'react';
import { format } from 'date-fns';
import { cx } from './cx';
import { dateFnsLocale } from '../i18n/dateLocale';
import { addDaysYmd, parseYmd } from './dateRange';

type Props = {
    /** First day shown, `YYYY-MM-DD`. */
    startYmd: string;
    days?: number;
    value: string;
    onChange: (ymd: string) => void;
    /** Share of free time that day (0–1), drawn as a small bar under the date. */
    freeShare?: (ymd: string) => number | null | undefined;
    todayYmd?: string;
    /** Extra tile at the end, e.g. «інша дата». */
    trailing?: React.ReactNode;
    label?: string;
};

/** Days in a horizontal strip; the selected day scrolls into view. */
export function DateStrip({ startYmd, days = 14, value, onChange, freeShare, todayYmd, trailing, label }: Props) {
    const loc = { locale: dateFnsLocale() };
    const ref = useRef<HTMLDivElement>(null);
    const list = Array.from({ length: days }, (_, i) => addDaysYmd(startYmd, i));

    useEffect(() => {
        const el = ref.current?.querySelector<HTMLElement>('[aria-checked="true"]');
        el?.scrollIntoView({ block: 'nearest', inline: 'center' });
    }, [value]);

    return (
        <div
            ref={ref}
            role="radiogroup"
            aria-label={label}
            className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
            {list.map((ymd) => {
                const date = parseYmd(ymd);
                if (!date) return null;
                const on = ymd === value;
                const share = freeShare?.(ymd);
                return (
                    <button
                        key={ymd}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        aria-label={format(date, 'EEEE, d MMMM', loc)}
                        onClick={() => onChange(ymd)}
                        className={cx(
                            'flex min-h-[56px] w-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded-control transition',
                            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ide-link',
                            on ? 'bg-ide-accentBlue text-white' : 'bg-ide-surface text-ide-text hover:bg-ide-elevated',
                        )}
                    >
                        <span className={cx('text-caption uppercase', on ? 'text-white/80' : 'text-ide-muted')}>
                            {format(date, 'EEEEEE', loc)}
                        </span>
                        <span
                            className={cx(
                                'text-heading font-semibold tabular-nums',
                                !on && ymd === todayYmd && 'text-ide-link',
                            )}
                        >
                            {format(date, 'd', loc)}
                        </span>
                        {share != null ? (
                            <span
                                aria-hidden
                                className={cx('h-[3px] w-6 overflow-hidden rounded-full', on ? 'bg-white/30' : 'bg-ide-border')}
                            >
                                <span
                                    className={cx('block h-full rounded-full', on ? 'bg-white' : 'bg-ide-accent')}
                                    style={{ width: `${Math.round(Math.max(0, Math.min(1, share)) * 100)}%` }}
                                />
                            </span>
                        ) : null}
                    </button>
                );
            })}
            {trailing}
        </div>
    );
}
