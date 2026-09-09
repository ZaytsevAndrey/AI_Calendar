import React from 'react';
import { GoogleCalendarEvent } from '../../../api/google-calendar.api';
import { getEventColor } from '../hooks/useCalendar';
import { useTimePhasesForDate, getPhaseByTime } from '../../phases/hooks/usePhases';
import { useGetUserSettingsQuery } from '../../../api/userSettingsApi';
import {
    CalendarView,
    chipLabel,
    clockToMinutes,
    eventsForDay,
    eventsForHourSlot,
    getDaysInView,
    gridEventsForDay,
    tooltipText,
    wakingHourSlots,
} from '../calendarView';

interface CalendarGridProps {
    view: CalendarView;
    date: Date;
    events: GoogleCalendarEvent[];
    onEditEvent?: (eventId: string) => void;
    onCreateForDate?: (day: Date) => void;
}

const CalendarGrid: React.FC<CalendarGridProps> = ({
    view,
    date,
    events,
    onEditEvent,
    onCreateForDate,
}) => {
    const { data: timePhases = [] } = useTimePhasesForDate(date);
    const { data: userSettings } = useGetUserSettingsQuery();

    const sleepWindow = {
        sleepTime: userSettings?.sleepTime,
        wakeTime: userSettings?.wakeTime,
    };

    const isToday = (day: Date) => day.toDateString() === new Date().toDateString();

    const isCurrentMonth = (day: Date) => day.getMonth() === date.getMonth();

    const getPhaseForTime = (time: string) => {
        const displayPhases = timePhases.filter((phase: any) => phase.type !== 'sleep_time');
        return getPhaseByTime(displayPhases, time);
    };

    const getDisplayPhases = () => {
        return timePhases
            .filter((phase: any) => phase.type !== 'sleep_time')
            .sort(
                (a: any, b: any) => clockToMinutes(a.startTime) - clockToMinutes(b.startTime),
            );
    };

    const days = getDaysInView(view, date);

    if (view === 'day') {
        const dayEvents = eventsForDay(events, days[0]);
        const timeSlots = wakingHourSlots(sleepWindow).map((time) => ({
            time,
            phase: getPhaseForTime(time),
        }));

        return (
            <div className="flex h-full min-h-0 flex-col rounded-lg border border-ide-border bg-ide-panel p-4">
                {getDisplayPhases().length > 0 && (
                    <div className="mb-4 flex shrink-0 flex-wrap gap-2">
                        {getDisplayPhases().map((phase: any) => (
                            <div
                                key={phase.id}
                                className="flex items-center gap-1 rounded p-1"
                                style={{
                                    backgroundColor: `${phase.color}18`,
                                    border: `1px solid ${phase.color}55`,
                                }}
                            >
                                <span
                                    className="h-3 w-3 shrink-0 rounded-full border border-ide-border"
                                    style={{ backgroundColor: phase.color }}
                                />
                                <span className="text-xs text-ide-muted">
                                    {phase.name} ({phase.startTime}-{phase.endTime})
                                </span>
                            </div>
                        ))}
                    </div>
                )}

                <div className="min-h-0 flex-1 overflow-y-auto">
                    {timeSlots.map((slot, index) => {
                        const hour = parseInt(slot.time.split(':')[0], 10);
                        const eventsInSlot = eventsForHourSlot(dayEvents, hour, sleepWindow);

                        return (
                            <div
                                key={index}
                                role={eventsInSlot.length === 0 ? 'button' : undefined}
                                tabIndex={eventsInSlot.length === 0 ? 0 : undefined}
                                className="relative flex min-h-[44px] border-b border-ide-border transition-colors hover:bg-white/[0.03]"
                                style={{
                                    backgroundColor: slot.phase ? `${slot.phase.color}14` : undefined,
                                }}
                                onClick={() => {
                                    if (eventsInSlot.length === 0) onCreateForDate?.(days[0]);
                                }}
                                onKeyDown={(e) => {
                                    if (eventsInSlot.length === 0 && (e.key === 'Enter' || e.key === ' ')) {
                                        e.preventDefault();
                                        onCreateForDate?.(days[0]);
                                    }
                                }}
                            >
                                <div className="flex w-[60px] shrink-0 items-center justify-center border-r border-ide-border bg-ide-surface p-2">
                                    <span className="text-xs text-ide-muted">{slot.time}</span>
                                </div>
                                <div className="flex w-[120px] shrink-0 items-center border-r border-ide-border bg-ide-surface p-2">
                                    {slot.phase && (
                                        <div className="flex items-center gap-1">
                                            <span
                                                className="h-2 w-2 shrink-0 rounded-full border border-ide-border"
                                                style={{ backgroundColor: slot.phase.color }}
                                            />
                                            <span className="text-xs text-ide-muted">{slot.phase.name}</span>
                                        </div>
                                    )}
                                </div>
                                <div className="flex flex-1 flex-col gap-1 p-2">
                                    {eventsInSlot.map((event) => (
                                        <div
                                            key={event.id}
                                            title={tooltipText(event)}
                                            role="button"
                                            tabIndex={0}
                                            className="cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap rounded border border-white/30 px-1.5 py-1 text-xs text-white"
                                            style={{ backgroundColor: getEventColor(event) }}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onEditEvent?.(event.id);
                                            }}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' || e.key === ' ') {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    onEditEvent?.(event.id);
                                                }
                                            }}
                                        >
                                            {chipLabel(event)}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    }

    const createWeeks = (d: Date[]) => {
        const weeks: Date[][] = [];
        for (let i = 0; i < d.length; i += 7) {
            weeks.push(d.slice(i, i + 7));
        }
        return weeks;
    };

    const weeks = createWeeks(days);

    return (
        <div className="flex h-full min-h-0 w-full flex-col">
            {getDisplayPhases().length > 0 && (
                <div className="mb-4 flex shrink-0 flex-wrap gap-2">
                    {getDisplayPhases().map((phase: any) => (
                        <div
                            key={phase.id}
                            className="flex items-center gap-1 rounded p-1"
                            style={{
                                backgroundColor: `${phase.color}18`,
                                border: `1px solid ${phase.color}55`,
                            }}
                        >
                            <span
                                className="h-3 w-3 shrink-0 rounded-full border border-ide-border"
                                style={{ backgroundColor: phase.color }}
                            />
                            <span className="text-xs text-ide-muted">
                                {phase.name} ({phase.startTime}-{phase.endTime})
                            </span>
                        </div>
                    ))}
                </div>
            )}

            <div className="mb-1 grid shrink-0 grid-cols-7 border-b border-ide-border">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((dayName) => (
                    <div key={dayName} className="border-r border-ide-border bg-ide-surface last:border-r-0">
                        <div className="p-2 text-center text-xs font-bold text-ide-text">{dayName}</div>
                    </div>
                ))}
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-auto">
                {weeks.map((week, weekIndex) => (
                    <div
                        key={weekIndex}
                        className="grid min-h-[5.5rem] flex-1 grid-cols-7 border-b border-ide-border last:border-b-0"
                    >
                        {week.map((day, dayIndex) => {
                            const dayEvents = gridEventsForDay(events, day, sleepWindow);
                            const isCurrentDay = isToday(day);
                            const isInCurrentMonth = isCurrentMonth(day);

                            return (
                                <div
                                    key={dayIndex}
                                    className={`relative flex h-full min-w-0 flex-col overflow-hidden border-r border-ide-border p-2 last:border-r-0 ${
                                        view === 'month' && !isInCurrentMonth ? 'opacity-50' : ''
                                    } ${
                                        isCurrentDay
                                            ? 'bg-ide-selection/30 ring-1 ring-inset ring-ide-link'
                                            : 'bg-ide-panel'
                                    }`}
                                >
                                    <span
                                        className={`shrink-0 text-xs ${
                                            isCurrentDay ? 'font-bold text-ide-link' : 'text-ide-text'
                                        }`}
                                    >
                                        {day.getDate()}
                                    </span>

                                    <div className="mt-1 min-h-0 flex-1 overflow-y-auto">
                                        {dayEvents
                                            .map((event) => {
                                                let eventPhase = null;
                                                if (event.start?.dateTime) {
                                                    const eventTime = new Date(
                                                        event.start.dateTime
                                                    ).toLocaleTimeString('en-US', {
                                                        hour12: false,
                                                        hour: '2-digit',
                                                        minute: '2-digit',
                                                    });
                                                    eventPhase = getPhaseForTime(eventTime);
                                                }

                                                return (
                                                    <div
                                                        key={event.id}
                                                        title={tooltipText(event)}
                                                        role="button"
                                                        tabIndex={0}
                                                        className="relative mb-1 cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap rounded px-1.5 py-1 text-xs text-white"
                                                        style={{
                                                            backgroundColor: getEventColor(event),
                                                            border: eventPhase
                                                                ? `2px solid ${eventPhase.color}`
                                                                : '1px solid rgba(255,255,255,0.3)',
                                                        }}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            onEditEvent?.(event.id);
                                                        }}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter' || e.key === ' ') {
                                                                e.preventDefault();
                                                                e.stopPropagation();
                                                                onEditEvent?.(event.id);
                                                            }
                                                        }}
                                                    >
                                                        {chipLabel(event)}
                                                        {eventPhase && (
                                                            <span
                                                                className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-white"
                                                                style={{ backgroundColor: eventPhase.color }}
                                                            />
                                                        )}
                                                    </div>
                                                );
                                            })}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ))}
            </div>
        </div>
    );
};

export default CalendarGrid;
