import React, { useState } from 'react';
import { GoogleCalendarEvent } from '../../../api/google-calendar.api';
import { getEventColor } from '../hooks/useCalendar';
import { useTimePhasesForDate, getPhaseByTime } from '../../phases/hooks/usePhases';
import { useGetUserSettingsQuery } from '../../../api/userSettingsApi';
import { useGetHabitsQuery } from '../../../api/habitsApi';
import CalendarTimeGrid from './CalendarTimeGrid';
import {
    CalendarView,
    chipLabel,
    clockToMinutes,
    getDaysInView,
    gridEventsForDay,
    isAllDayEvent,
    isEventInSleepHours,
    tooltipText,
    wakingHourSlots,
} from '../calendarView';
import { HabitBlockButton, HabitDayDialog, HabitDayDots, HabitDaySection } from '../../habits/components/CalendarHabits';
import { habitBlockChips, isHabitGoogleEvent } from '../../habits/habitBlocks';
import { ymdFromLocalDate } from '../../../utils/ianaDateTime';

function eventStartMinutes(event: GoogleCalendarEvent): number {
    if (!event.start.dateTime) return -1;
    const start = new Date(event.start.dateTime);
    if (Number.isNaN(start.getTime())) return 0;
    return start.getHours() * 60 + start.getMinutes();
}

interface CalendarGridProps {
    view: CalendarView;
    date: Date;
    events: GoogleCalendarEvent[];
    onEditEvent?: (eventId: string) => void;
    onCreateForDate?: (day: Date) => void;
    onEventTimeChange?: (
        event: GoogleCalendarEvent,
        start: Date,
        end: Date,
    ) => Promise<void>;
}

const CalendarGrid: React.FC<CalendarGridProps> = ({
    view,
    date,
    events,
    onEditEvent,
    onCreateForDate,
    onEventTimeChange,
}) => {
    const { data: timePhases = [] } = useTimePhasesForDate(date);
    const { data: userSettings } = useGetUserSettingsQuery();
    const { data: habitsData } = useGetHabitsQuery();

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
    const habitEventIds = new Set(
        (habitsData?.habits ?? [])
            .map((habit) => habit.googleEventId)
            .filter((id): id is string => !!id),
    );
    const visibleEvents = events.filter((event) => !isHabitGoogleEvent(habitEventIds, event));
    const habitBlocks = habitBlockChips(
        habitsData?.habits ?? [],
        days,
        habitsData?.timeZone ?? 'UTC',
    );
    const [habitDate, setHabitDate] = useState<string | null>(null);
    const habitDialog = (
        <HabitDayDialog date={habitDate} onClose={() => setHabitDate(null)} />
    );

    const renderGridEvent = (event: GoogleCalendarEvent) => {
        let eventPhase = null;
        if (event.start?.dateTime) {
            const eventTime = new Date(event.start.dateTime).toLocaleTimeString('en-US', {
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
    };

    if (view !== 'month') {
        const slots = wakingHourSlots(sleepWindow);
        const dayStartMin = slots.length ? clockToMinutes(slots[0]) : 7 * 60;
        const dayEndMin =
            (slots.length ? clockToMinutes(slots[slots.length - 1]) : 22 * 60) + 60;
        const hourBands = slots.map((time) => ({
            minutes: clockToMinutes(time),
            label: time,
            color: getPhaseForTime(time)?.color,
        }));
        const timed = visibleEvents.filter(
            (event) => !!event.start?.dateTime && !isEventInSleepHours(event, sleepWindow),
        );
        const allDay = visibleEvents.filter((event) => isAllDayEvent(event));
        const habits = habitBlocks.map((block) => {
            const habit = (habitsData?.habits ?? []).find((item) => item.id === block.habitId);
            return { ...block, durationMinutes: habit?.blockMinutes ?? 30 };
        });

        return (
            <>
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

                {view === 'day' ? <HabitDaySection date={ymdFromLocalDate(days[0])} /> : null}
                <p className="mb-2 shrink-0 text-xs text-ide-muted">
                    Drag a block or its top/bottom edge. Step: 15 min. Click the center to edit.
                </p>
                <CalendarTimeGrid
                    days={days}
                    events={timed}
                    allDayEvents={allDay}
                    habits={habits}
                    dayStartMin={dayStartMin}
                    dayEndMin={dayEndMin}
                    hourBands={hourBands}
                    onEditEvent={onEditEvent}
                    onCreateForDate={onCreateForDate}
                    onEventTimeChange={onEventTimeChange}
                    onOpenHabit={setHabitDate}
                    renderDayExtra={
                        view === 'week'
                            ? (day) => <HabitDayDots day={day} onOpen={setHabitDate} />
                            : undefined
                    }
                />
            </div>
            {habitDialog}
            </>
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
        <>
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
                            const dayEvents = gridEventsForDay(visibleEvents, day, sleepWindow);
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
                                    <HabitDayDots day={day} onOpen={setHabitDate} />

                                    <div className="mt-1 min-h-0 flex-1 overflow-y-auto">
                                        {dayEvents
                                            .filter((event) => !event.start?.dateTime)
                                            .map((event) => renderGridEvent(event))}
                                        {[
                                            ...habitBlocks
                                                .filter((block) => block.ymd === ymdFromLocalDate(day))
                                                .map((block) => ({
                                                    kind: 'habit' as const,
                                                    block,
                                                    sort: block.startMinutes,
                                                })),
                                            ...dayEvents
                                                .filter((event) => event.start?.dateTime)
                                                .map((event) => ({
                                                    kind: 'event' as const,
                                                    event,
                                                    sort: eventStartMinutes(event),
                                                })),
                                        ]
                                            .sort((a, b) => a.sort - b.sort)
                                            .map((item) =>
                                                item.kind === 'habit' ? (
                                                    <HabitBlockButton
                                                        key={item.block.id}
                                                        block={item.block}
                                                        showTime
                                                        onOpen={setHabitDate}
                                                    />
                                                ) : (
                                                    renderGridEvent(item.event)
                                                ),
                                            )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ))}
            </div>
        </div>
        {habitDialog}
        </>
    );
};

export default CalendarGrid;
