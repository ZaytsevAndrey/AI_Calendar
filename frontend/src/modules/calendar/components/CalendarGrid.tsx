import React from 'react';
import { useTranslation } from 'react-i18next';
import { GoogleCalendarEvent } from '../../../api/google-calendar.api';
import { getEventColor } from '../hooks/useCalendar';
import { useTimePhases, useTimePhasesForDate, getPhaseByTime } from '../../phases/hooks/usePhases';
import { useGetUserSettingsQuery } from '../../../api/userSettingsApi';
import CalendarTimeGrid from './CalendarTimeGrid';
import {
    CalendarView,
    buildCalendarAxis,
    chipLabel,
    clockToMinutes,
    displayToPersonal,
    eventDisplayRange,
    getDaysInView,
    nowMarkerDisplay,
    gridEventsForDay,
    visibleHourBands,
    isAllDayEvent,
    isEventInSleepHours,
    personalDayWindow,
    phasesForDays,
    tooltipText,
} from '../calendarView';
import { dateOnDayAtMinutes } from '../eventDrag';
import { ymdFromLocalDate } from '../../../utils/ianaDateTime';
import { formatClock } from '../../../utils/formatDate';
import { cx } from 'ui/cx';
import { cardMotionState } from '../motion/cardMotion';
import { joinKeys } from '../motion/motionMath';
import { useMotionPresence } from '../motion/useMotionPresence';

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
    onCreateForRange?: (day: Date, start: Date, end: Date) => void;
    onEventTimeChange?: (
        event: GoogleCalendarEvent,
        start: Date,
        end: Date,
    ) => Promise<void>;
    onDeleteEvent?: (event: GoogleCalendarEvent) => void;
    isEventCompleted?: (event: GoogleCalendarEvent) => boolean;
    /** Phone month: day number and a dot, tap opens that day. */
    phoneMonth?: boolean;
    onPickDay?: (day: Date) => void;
    renderEventMeta?: (event: GoogleCalendarEvent, completed: boolean) => React.ReactNode;
    /** Explicit columns for a time view (phone «3 дні»). */
    days?: Date[];
    /** Ids an action on a card is known by (event id, its task id). */
    motionKeys?: (event: GoogleCalendarEvent) => string[];
}

const CalendarGrid: React.FC<CalendarGridProps> = ({
    view,
    date,
    events,
    onEditEvent,
    onCreateForDate,
    onCreateForRange,
    onEventTimeChange,
    onDeleteEvent,
    isEventCompleted,
    phoneMonth = false,
    onPickDay,
    renderEventMeta,
    days: daysOverride,
    motionKeys,
}) => {
    const { t, i18n } = useTranslation();
    const { data: timePhases = [] } = useTimePhasesForDate(date);
    const { data: allTimePhases = [] } = useTimePhases();
    const { data: userSettings } = useGetUserSettingsQuery();
    const [now, setNow] = React.useState(() => new Date());
    React.useEffect(() => {
        const id = window.setInterval(() => setNow(new Date()), 30_000);
        return () => window.clearInterval(id);
    }, []);

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

    const phaseOrder = personalDayWindow(sleepWindow);
    const personalStart = (time: string) => {
        const minutes = clockToMinutes(time);
        return minutes < phaseOrder.start ? minutes + 24 * 60 : minutes;
    };

    const getDisplayPhases = () => {
        return timePhases
            .filter((phase: any) => phase.type !== 'sleep_time')
            .sort(
                (a: any, b: any) => personalStart(a.startTime) - personalStart(b.startTime),
            );
    };

    const days = view !== 'month' && daysOverride?.length ? daysOverride : getDaysInView(view, date);
    const visibleEvents = events;
    // The time views animate inside CalendarTimeGrid; this watches the month chips.
    const monthRef = React.useRef<HTMLDivElement>(null);
    const keysFor = (event: GoogleCalendarEvent) => motionKeys?.(event) ?? [event.id];
    useMotionPresence(monthRef, {
        resetKey: `${view}|${phoneMonth ? ymdFromLocalDate(date) : ''}|${days.map((d) => d.toDateString()).join('|')}`,
    });

    const weekdayKeys = [
        'calendar.weekdayMon',
        'calendar.weekdayTue',
        'calendar.weekdayWed',
        'calendar.weekdayThu',
        'calendar.weekdayFri',
        'calendar.weekdaySat',
        'calendar.weekdaySun',
    ] as const;
    const dateLocale = i18n.language === 'uk' ? 'uk-UA' : 'en-GB';

    /** One-line chip: month cells, the phone agenda and all-day rows. */
    function renderLineChip(event: GoogleCalendarEvent, roomy = false) {
        const completed = isEventCompleted?.(event) ?? false;
        const time = event.start?.dateTime ? formatClock(new Date(event.start.dateTime)) : null;
        const end = event.end?.dateTime ? new Date(event.end.dateTime).getTime() : null;
        const past = end != null && end <= now.getTime();
        return (
            <div
                key={event.id}
                data-motion-id={event.id}
                data-motion-keys={joinKeys(keysFor(event))}
                data-motion={cardMotionState(keysFor(event)) ?? undefined}
                title={tooltipText(event)}
                role="button"
                tabIndex={0}
                className={cx(
                    'calendar-chip calendar-chip--line relative cursor-pointer font-medium',
                    roomy ? 'min-h-11 text-body' : 'mb-1',
                    completed && 'calendar-chip--done',
                    past && 'calendar-chip--past',
                    !event.isAppGenerated && 'calendar-chip--external',
                )}
                style={{ '--chip-color': getEventColor(event) } as React.CSSProperties}
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
                {completed ? (
                    <span className="calendar-chip__check" aria-hidden>
                        ✓
                    </span>
                ) : null}
                {time ? <span className="calendar-chip__time">{time}</span> : null}
                <span className="min-w-0 flex-1 truncate">{chipLabel(event)}</span>
                {renderEventMeta?.(event, completed)}
            </div>
        );
    }

    if (view === 'month' && phoneMonth) {
        const selectedYmd = ymdFromLocalDate(date);
        const agenda = gridEventsForDay(visibleEvents, date, sleepWindow).sort(
            (a, b) => eventStartMinutes(a) - eventStartMinutes(b),
        );
        return (
            <div
                ref={monthRef}
                className="flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-control border border-ide-border bg-ide-panel"
            >
                <div className="grid shrink-0 grid-cols-7 border-b border-ide-border">
                    {weekdayKeys.map((key) => (
                        <div key={key} className="py-1.5 text-center text-caption text-ide-muted">
                            {t(key)}
                        </div>
                    ))}
                </div>
                <div className="grid shrink-0 grid-cols-7" data-testid="calendar-month-grid">
                    {days.map((day) => {
                        const dayEvents = gridEventsForDay(visibleEvents, day, sleepWindow);
                        const ymd = ymdFromLocalDate(day);
                        const isCurrentDay = isToday(day);
                        const isInCurrentMonth = isCurrentMonth(day);
                        const selected = ymd === selectedYmd;
                        const dots = Array.from(new Set(dayEvents.map((event) => getEventColor(event)))).slice(0, 3);
                        const label = day.toLocaleDateString(dateLocale, {
                            weekday: 'long',
                            day: 'numeric',
                            month: 'long',
                        });
                        return (
                            <button
                                key={ymd}
                                type="button"
                                aria-label={t('calendar.showDay', { label })}
                                aria-pressed={selected}
                                className={cx(
                                    'flex min-h-[48px] flex-col items-center justify-center gap-1 text-body',
                                    !isInCurrentMonth && 'text-ide-subtle',
                                )}
                                onClick={() => onPickDay?.(day)}
                            >
                                <span
                                    className={cx(
                                        'inline-flex h-8 w-8 items-center justify-center rounded-full tabular-nums',
                                        selected
                                            ? 'bg-ide-accentBlue font-semibold text-white'
                                            : isCurrentDay
                                              ? 'font-semibold text-ide-link'
                                              : isInCurrentMonth
                                                ? 'text-ide-text'
                                                : undefined,
                                    )}
                                >
                                    {day.getDate()}
                                </span>
                                <span className="flex h-1.5 gap-0.5" aria-hidden>
                                    {dots.map((color) => (
                                        <span key={color} className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
                                    ))}
                                </span>
                            </button>
                        );
                    })}
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto border-t border-ide-border p-2" data-testid="calendar-month-agenda">
                    <p className="px-1 pb-2 text-body-sm font-medium capitalize text-ide-muted">
                        {date.toLocaleDateString(dateLocale, { weekday: 'long', day: 'numeric', month: 'long' })}
                    </p>
                    {agenda.length ? (
                        <ul className="flex flex-col gap-1.5">
                            {agenda.map((event) => (
                                <li key={event.id}>{renderLineChip(event, true)}</li>
                            ))}
                        </ul>
                    ) : (
                        <button
                            type="button"
                            className="w-full rounded-control border border-dashed border-ide-border px-3 py-4 text-center text-body-sm text-ide-muted"
                            onClick={() => onCreateForDate?.(date)}
                        >
                            {t('calendar.agendaEmpty')}
                        </button>
                    )}
                </div>
            </div>
        );
    }

    if (view !== 'month') {
        const axis = buildCalendarAxis(sleepWindow, phasesForDays(allTimePhases, days));
        const dayStartMin = 0;
        const dayEndMin = axis.spanMin;
        const hourBands = visibleHourBands(axis).map((band) => ({
            minutes: band.displayMin,
            label: band.label,
            durationMin: band.durationMin,
            color: getPhaseForTime(band.label)?.color,
        }));
        const timed = visibleEvents.filter(
            (event) => !!event.start?.dateTime && !isEventInSleepHours(event, sleepWindow),
        );
        const allDay = visibleEvents.filter((event) => isAllDayEvent(event));

        return (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-control border border-ide-border bg-ide-panel">
                <CalendarTimeGrid
                    days={days}
                    events={timed}
                    allDayEvents={allDay}
                    dayStartMin={dayStartMin}
                    dayEndMin={dayEndMin}
                    hourBands={hourBands}
                    onEditEvent={onEditEvent}
                    onCreateForDate={onCreateForDate}
                    onCreateForRange={onCreateForRange}
                    now={now}
                    nowDisplayMin={(day) => nowMarkerDisplay(now, day, axis)}
                    eventRange={(event, day) => eventDisplayRange(event, day, axis)}
                    minutesToDate={(day, minutes) =>
                        dateOnDayAtMinutes(day, displayToPersonal(axis, minutes))
                    }
                    onEventTimeChange={onEventTimeChange}
                    onDeleteEvent={onDeleteEvent}
                    isEventCompleted={isEventCompleted}
                    renderEventMeta={renderEventMeta}
                    motionKeys={motionKeys}
                />
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
        <div
            ref={monthRef}
            className="flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-control border border-ide-border bg-ide-panel"
        >
            <div className="grid shrink-0 grid-cols-7 border-b border-ide-border">
                {weekdayKeys.map((key) => (
                    <div key={key} className="border-r border-ide-border px-2 py-1.5 text-body-sm text-ide-muted last:border-r-0">
                        {t(key)}
                    </div>
                ))}
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-auto" data-testid="calendar-month-grid">
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
                                    className={cx(
                                        'relative flex h-full min-w-0 flex-col overflow-hidden border-r border-ide-border p-1 last:border-r-0',
                                        !isInCurrentMonth && 'bg-ide-bg/40',
                                    )}
                                    onClick={() => onCreateForDate?.(day)}
                                >
                                    <span
                                        className={cx(
                                            'mb-0.5 inline-flex h-6 min-w-6 shrink-0 items-center justify-center self-start rounded-full px-1 text-body-sm tabular-nums',
                                            isCurrentDay
                                                ? 'bg-ide-accentBlue font-semibold text-white'
                                                : isInCurrentMonth
                                                  ? 'text-ide-text'
                                                  : 'text-ide-subtle',
                                        )}
                                    >
                                        {day.getDate()}
                                    </span>

                                    <div className="min-h-0 flex-1 overflow-y-auto">
                                        {dayEvents
                                            .filter((event) => !event.start?.dateTime)
                                            .map((event) => renderLineChip(event))}
                                        {dayEvents
                                            .filter((event) => event.start?.dateTime)
                                            .sort(
                                                (a, b) =>
                                                    eventStartMinutes(a) - eventStartMinutes(b),
                                            )
                                            .map((event) => renderLineChip(event))}
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
