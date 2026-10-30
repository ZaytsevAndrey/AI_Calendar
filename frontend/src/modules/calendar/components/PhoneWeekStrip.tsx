import React from 'react';
import { format } from 'date-fns';
import { dateFnsOptions } from '../../../i18n/dateLocale';
import { cx } from 'ui/cx';
import { getDaysInView, sameLocalDay } from '../calendarView';

type Props = {
    date: Date;
    onSelect: (day: Date) => void;
};

/** Phone day view: the week as a strip of days; tap moves the day. */
export function PhoneWeekStrip({ date, onSelect }: Props) {
    const days = getDaysInView('week', date);
    const today = new Date();
    const loc = dateFnsOptions();

    return (
        <div className="mb-2 grid shrink-0 grid-cols-7 gap-1" role="group" aria-label={format(date, 'LLLL yyyy', loc)}>
            {days.map((day) => {
                const selected = sameLocalDay(day, date);
                const isToday = sameLocalDay(day, today);
                return (
                    <button
                        key={day.toDateString()}
                        type="button"
                        aria-pressed={selected}
                        aria-label={format(day, 'EEEE d MMMM', loc)}
                        className={cx(
                            'flex min-h-[52px] min-w-0 flex-col items-center justify-center gap-0.5 rounded-control transition',
                            selected ? 'bg-ide-accentBlue text-white' : 'text-ide-text active:bg-ide-surface',
                        )}
                        onClick={() => onSelect(day)}
                    >
                        <span className={cx('text-caption capitalize', selected ? 'text-white/80' : 'text-ide-muted')}>
                            {format(day, 'EEEEEE', loc)}
                        </span>
                        <span
                            className={cx(
                                'text-heading font-semibold tabular-nums',
                                !selected && isToday && 'text-ide-link',
                            )}
                        >
                            {format(day, 'd', loc)}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}
