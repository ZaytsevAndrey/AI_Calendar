import React from 'react';
import { GoogleCalendarEvent } from '../../../api/google-calendar.api';
import { formatEventTime, getEventColor } from '../hooks/useCalendar';
import { useTimePhasesForDate, getPhaseByTime } from '../../phases/hooks/usePhases';
import { useGetUserSettingsQuery } from '../../../api/userSettingsApi';

interface CalendarGridProps {
    view: 'day' | 'week' | 'month';
    date: Date;
    events: GoogleCalendarEvent[];
    onEditEvent?: (eventId: string) => void;
    onDeleteEvent?: (eventId: string, eventName: string) => void;
}

function tooltipText(event: GoogleCalendarEvent): string {
    const parts = [event.summary || 'Event', formatEventTime(event)];
    if (event.description) parts.push(event.description);
    if (event.location) parts.push(`Location: ${event.location}`);
    return parts.join('\n');
}

const CalendarGrid: React.FC<CalendarGridProps> = ({
    view,
    date,
    events,
    onEditEvent,
    onDeleteEvent,
}) => {
    const { data: timePhases = [] } = useTimePhasesForDate(date);
    const { data: userSettings } = useGetUserSettingsQuery();

    const getDaysInView = () => {
        const days: Date[] = [];

        switch (view) {
            case 'day': {
                const day = new Date(date);
                days.push(day);
                break;
            }
            case 'week': {
                const startOfWeek = new Date(date);
                const dayOfWeek = date.getDay();
                const daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
                startOfWeek.setDate(date.getDate() - daysToSubtract);

                for (let i = 0; i < 7; i++) {
                    const day = new Date(startOfWeek);
                    day.setDate(startOfWeek.getDate() + i);
                    days.push(day);
                }
                break;
            }
            case 'month': {
                const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
                const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0);

                const startOfWeek = new Date(startOfMonth);
                const firstDayOfWeek = startOfMonth.getDay();
                const daysToSubtract = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1;
                startOfWeek.setDate(startOfMonth.getDate() - daysToSubtract);

                const endOfWeek = new Date(endOfMonth);
                const lastDayOfWeek = endOfMonth.getDay();
                const daysToAdd = lastDayOfWeek === 0 ? 0 : 7 - lastDayOfWeek;
                endOfWeek.setDate(endOfMonth.getDate() + daysToAdd);

                const current = new Date(startOfWeek);
                while (current <= endOfWeek) {
                    days.push(new Date(current));
                    current.setDate(current.getDate() + 1);
                }
                break;
            }
        }

        return days;
    };

    const getEventsForDay = (day: Date) => {
        return events.filter((event) => {
            const eventDate = event.start.dateTime
                ? new Date(event.start.dateTime)
                : new Date(event.start.date!);

            return eventDate.toDateString() === day.toDateString();
        });
    };

    const isToday = (day: Date) => day.toDateString() === new Date().toDateString();

    const isCurrentMonth = (day: Date) => day.getMonth() === date.getMonth();

    const getPhaseForTime = (time: string) => {
        const displayPhases = timePhases.filter((phase: any) => phase.type !== 'sleep_time');
        return getPhaseByTime(displayPhases, time);
    };

    const isSleepTime = (time: string) => {
        if (!userSettings?.sleepTime || !userSettings?.wakeTime) {
            const timeMinutes = timeToMinutes(time);
            const defaultSleepStart = 23 * 60;
            const defaultSleepEnd = 6 * 60;

            if (defaultSleepStart > defaultSleepEnd) {
                return timeMinutes >= defaultSleepStart || timeMinutes <= defaultSleepEnd;
            }
            return timeMinutes >= defaultSleepStart && timeMinutes <= defaultSleepEnd;
        }

        const timeMinutes = timeToMinutes(time);
        const sleepStart = timeToMinutes(userSettings.sleepTime);
        const sleepEnd = timeToMinutes(userSettings.wakeTime);

        if (sleepStart > sleepEnd) {
            return timeMinutes >= sleepStart || timeMinutes <= sleepEnd;
        }
        return timeMinutes >= sleepStart && timeMinutes <= sleepEnd;
    };

    const getDisplayPhases = () => {
        return timePhases
            .filter((phase: any) => phase.type !== 'sleep_time')
            .sort((a: any, b: any) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
    };

    const createTimeSlots = () => {
        const slots: { time: string; phase: any }[] = [];
        for (let hour = 0; hour < 24; hour++) {
            const time = `${hour.toString().padStart(2, '0')}:00`;
            if (isSleepTime(time)) continue;
            const phase = getPhaseForTime(time);
            slots.push({ time, phase });
        }
        return slots;
    };

    const timeToMinutes = (time: string): number => {
        const [hours, minutes] = time.split(':').map(Number);
        return hours * 60 + minutes;
    };

    const days = getDaysInView();

    if (view === 'day') {
        const dayEvents = getEventsForDay(days[0]);
        const timeSlots = createTimeSlots();

        return (
            <div className="min-h-[600px] rounded-lg border border-ide-border bg-ide-panel p-4">
                <h2 className="mb-4 text-lg font-semibold text-ide-text">
                    {days[0].toLocaleDateString('en-US', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                    })}
                </h2>

                {getDisplayPhases().length > 0 && (
                    <div className="mb-4 flex flex-wrap gap-2">
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

                <div className="flex flex-col">
                    {timeSlots.map((slot, index) => {
                        const eventsInSlot = dayEvents.filter((event) => {
                            if (!event.start.dateTime) return false;
                            const eventHour = new Date(event.start.dateTime).getHours();
                            const eventTime = new Date(event.start.dateTime).toLocaleTimeString('en-US', {
                                hour12: false,
                                hour: '2-digit',
                                minute: '2-digit',
                            });
                            if (isSleepTime(eventTime)) return false;
                            return eventHour === parseInt(slot.time.split(':')[0], 10);
                        });

                        return (
                            <div
                                key={index}
                                className="relative flex min-h-[40px] border-b border-ide-border transition-colors hover:bg-white/[0.03]"
                                style={{
                                    backgroundColor: slot.phase ? `${slot.phase.color}14` : undefined,
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
                                            className="group relative cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap rounded border border-white/30 px-1 py-0.5 text-[0.7rem] text-white"
                                            style={{ backgroundColor: getEventColor(event) }}
                                            onClick={() => onEditEvent?.(event.id)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' || e.key === ' ') onEditEvent?.(event.id);
                                            }}
                                        >
                                            {event.summary || 'Event'}
                                            <div className="event-actions absolute right-0.5 top-0.5 hidden gap-0.5 group-hover:flex">
                                                <button
                                                    type="button"
                                                    className="min-w-0 rounded p-0.5 text-xs text-white hover:bg-black/20"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onEditEvent?.(event.id);
                                                    }}
                                                >
                                                    ✏️
                                                </button>
                                                <button
                                                    type="button"
                                                    className="min-w-0 rounded p-0.5 text-xs text-white hover:bg-black/20"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onDeleteEvent?.(event.id, event.summary || 'Event');
                                                    }}
                                                >
                                                    🗑️
                                                </button>
                                            </div>
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
        <div className="w-full">
            {getDisplayPhases().length > 0 && (
                <div className="mb-4 flex flex-wrap gap-2">
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

            <div className="mb-1 grid grid-cols-7 border-b border-ide-border">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((dayName) => (
                    <div key={dayName} className="border-r border-ide-border bg-ide-surface last:border-r-0">
                        <div className="p-2 text-center text-xs font-bold text-ide-text">{dayName}</div>
                    </div>
                ))}
            </div>

            <div className="flex flex-col">
                {weeks.map((week, weekIndex) => (
                    <div
                        key={weekIndex}
                        className="grid grid-cols-7 border-b border-ide-border last:border-b-0"
                    >
                        {week.map((day, dayIndex) => {
                            const dayEvents = getEventsForDay(day);
                            const isCurrentDay = isToday(day);
                            const isInCurrentMonth = isCurrentMonth(day);

                            return (
                                <div
                                    key={dayIndex}
                                    className={`relative min-h-[100px] border-r border-ide-border p-2 last:border-r-0 ${
                                        view === 'month' && !isInCurrentMonth ? 'opacity-50' : ''
                                    } ${
                                        isCurrentDay
                                            ? 'bg-ide-selection/30 ring-1 ring-inset ring-ide-link'
                                            : 'bg-ide-panel'
                                    }`}
                                    style={{ minHeight: view === 'month' ? '120px' : '100px' }}
                                >
                                    <span
                                        className={`text-xs ${
                                            isCurrentDay ? 'font-bold text-ide-link' : 'text-ide-text'
                                        }`}
                                    >
                                        {day.getDate()}
                                    </span>

                                    <div className="mt-1">
                                        {dayEvents
                                            .filter((event) => {
                                                if (!event.start?.dateTime) return true;
                                                const eventTime = new Date(
                                                    event.start.dateTime
                                                ).toLocaleTimeString('en-US', {
                                                    hour12: false,
                                                    hour: '2-digit',
                                                    minute: '2-digit',
                                                });
                                                return !isSleepTime(eventTime);
                                            })
                                            .slice(0, view === 'month' ? 2 : 3)
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
                                                        className="relative mb-1 cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap rounded px-1 py-0.5 text-[0.7rem] text-white"
                                                        style={{
                                                            backgroundColor: getEventColor(event),
                                                            border: eventPhase
                                                                ? `2px solid ${eventPhase.color}`
                                                                : '1px solid rgba(255,255,255,0.3)',
                                                        }}
                                                        onClick={() => onEditEvent?.(event.id)}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter' || e.key === ' ')
                                                                onEditEvent?.(event.id);
                                                        }}
                                                    >
                                                        {event.summary || 'Event'}
                                                        {eventPhase && (
                                                            <span
                                                                className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-white"
                                                                style={{ backgroundColor: eventPhase.color }}
                                                            />
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        {(() => {
                                            const filtered = dayEvents.filter((event) => {
                                                if (!event.start?.dateTime) return true;
                                                const eventTime = new Date(
                                                    event.start.dateTime
                                                ).toLocaleTimeString('en-US', {
                                                    hour12: false,
                                                    hour: '2-digit',
                                                    minute: '2-digit',
                                                });
                                                return !isSleepTime(eventTime);
                                            });
                                            const maxEvents = view === 'month' ? 2 : 3;
                                            return filtered.length > maxEvents ? (
                                                <div className="text-[0.6rem] text-ide-muted">
                                                    +{filtered.length - maxEvents} more
                                                </div>
                                            ) : null;
                                        })()}
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
