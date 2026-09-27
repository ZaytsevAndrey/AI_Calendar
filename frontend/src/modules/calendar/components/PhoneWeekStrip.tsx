import React, { useState } from 'react';
import { format } from 'date-fns';
import { dateFnsOptions } from '../../../i18n/dateLocale';
import { getDaysInView, sameLocalDay } from '../calendarView';
import { HabitDayDialog, HabitDayDots } from '../../habits/components/CalendarHabits';

type Props = {
    date: Date;
    onSelect: (day: Date) => void;
};

export function PhoneWeekStrip({ date, onSelect }: Props) {
    const days = getDaysInView('week', date);
    const [habitDate, setHabitDate] = useState<string | null>(null);
    const today = new Date();
    const loc = dateFnsOptions();

    return (
        <div className="mb-2 shrink-0">
            <div className="grid grid-cols-7 gap-1">
                {days.map((day) => {
                    const selected = sameLocalDay(day, date);
                    const isToday = sameLocalDay(day, today);
                    return (
                        <div key={day.toDateString()} className="flex min-w-0 flex-col items-center">
                            <button
                                type="button"
                                aria-pressed={selected}
                                aria-label={format(day, 'EEEE d', loc)}
                                className={`flex min-h-[44px] w-full flex-col items-center justify-center rounded-md px-0.5 text-xs ${
                                    selected
                                        ? 'bg-ide-selection text-ide-text'
                                        : isToday
                                          ? 'text-ide-link'
                                          : 'text-ide-muted'
                                }`}
                                onClick={() => onSelect(day)}
                            >
                                <span className="uppercase">{format(day, 'EEE', loc)}</span>
                                <span className="text-sm font-medium">{format(day, 'd', loc)}</span>
                            </button>
                            <HabitDayDots day={day} onOpen={setHabitDate} />
                        </div>
                    );
                })}
            </div>
            <HabitDayDialog date={habitDate} onClose={() => setHabitDate(null)} />
        </div>
    );
}
