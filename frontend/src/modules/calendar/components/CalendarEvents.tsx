import React from 'react';
import { useTranslation } from 'react-i18next';
import {
    CalendarDays,
    Clock,
    ExternalLink,
    MapPin,
    Pencil,
    Repeat,
    Timer,
    Trash2,
    UserRound,
    Users,
} from 'lucide-react';
import { GoogleCalendarEvent } from '../../../api/google-calendar.api';
import { getEventColor, isEventToday, isPastAppEvent } from '../hooks/useCalendar';
import {
    eventEndDate,
    eventStartDate,
    formatEventListDate,
    formatEventListTime,
    isAllDayEvent,
} from '../calendarView';
import { Spinner } from '../../../ui/Spinner';
import i18n from 'i18n';

interface CalendarEventsProps {
    events: GoogleCalendarEvent[];
    isLoading: boolean;
    error: any;
    title?: string;
    onEditEvent?: (eventId: string) => void;
    onDeleteEvent?: (eventId: string, eventName: string) => void;
}

function formatDuration(event: GoogleCalendarEvent): string | null {
    if (isAllDayEvent(event)) return null;
    const start = eventStartDate(event);
    const end = eventEndDate(event);
    if (!start || !end) return null;
    const mins = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
    if (mins < 60) return i18n.t('common.minutesShort', { count: mins });
    const hours = Math.floor(mins / 60);
    const rest = mins % 60;
    return rest
        ? i18n.t('common.hoursMinutesShort', { hours, minutes: rest })
        : i18n.t('common.hoursShort', { count: hours });
}

function attendeeLabel(person: NonNullable<GoogleCalendarEvent['attendees']>[number]): string {
    const name = person.displayName || person.email;
    if (!person.responseStatus || person.responseStatus === 'needsAction') return name;
    const status =
        person.responseStatus === 'accepted'
            ? i18n.t('calendar.accepted')
            : person.responseStatus === 'declined'
              ? i18n.t('calendar.declined')
              : i18n.t('calendar.tentative');
    return `${name} (${status})`;
}

function formatStamp(iso?: string): string | null {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const locale = i18n.language === 'uk' ? 'uk-UA' : 'en-GB';
    return d.toLocaleString(locale, {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });
}

const CalendarEvents: React.FC<CalendarEventsProps> = ({
    events,
    isLoading,
    error,
    title,
    onEditEvent,
    onDeleteEvent,
}) => {
    const { t } = useTranslation();
    const heading = title ?? t('common.events');

    if (isLoading) {
        return (
            <div className="flex h-full items-center justify-center">
                <Spinner className="h-8 w-8" />
            </div>
        );
    }

    if (error) {
        return (
            <div
                className="rounded border border-ide-error bg-ide-error/10 px-4 py-3 text-sm text-ide-error"
                role="alert"
            >
                {t('calendar.loadEventsFailed', { message: error.message })}
            </div>
        );
    }

    if (!events || events.length === 0) {
        return (
            <div className="flex h-full items-center justify-center rounded-xl border border-ide-border bg-ide-panel px-4 text-center text-ide-muted">
                {t('calendar.noEvents')}
            </div>
        );
    }

    return (
        <section className="flex h-full min-h-0 flex-col">
            <h2 className="mb-3 shrink-0 text-lg font-semibold text-ide-text">
                {heading} ({events.length})
            </h2>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                {events.map((event) => {
                    const duration = formatDuration(event);
                    const organizer = event.organizer?.displayName || event.organizer?.email;
                    const created = formatStamp(event.created);
                    const updated = formatStamp(event.updated);
                    const attendees = event.attendees ?? [];
                    const untitled = t('calendar.untitledEvent');

                    return (
                        <article
                            key={event.id}
                            className="rounded-lg border border-ide-border bg-ide-panel p-4 shadow-ide"
                            style={{ borderLeftWidth: 4, borderLeftColor: getEventColor(event) }}
                        >
                            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <h3 className="text-base font-semibold text-ide-text">
                                        {event.summary || untitled}
                                    </h3>
                                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                                        {isPastAppEvent(event) ? (
                                            <span className="inline-flex items-center gap-1 rounded border border-ide-border px-2 py-0.5 text-xs text-ide-muted">
                                                {t('calendar.past')}
                                            </span>
                                        ) : null}
                                        {isEventToday(event) ? (
                                            <span className="inline-flex items-center gap-1 rounded border border-ide-link px-2 py-0.5 text-xs text-ide-link">
                                                <CalendarDays className="h-3 w-3" aria-hidden />
                                                {t('common.today')}
                                            </span>
                                        ) : null}
                                        {isAllDayEvent(event) ? (
                                            <span className="inline-flex items-center gap-1 rounded border border-ide-border px-2 py-0.5 text-xs text-ide-muted">
                                                {t('common.allDay')}
                                            </span>
                                        ) : null}
                                        {event.recurringEventId ? (
                                            <span className="inline-flex items-center gap-1 rounded border border-ide-border px-2 py-0.5 text-xs text-ide-muted">
                                                <Repeat className="h-3 w-3" aria-hidden />
                                                {t('calendar.recurring')}
                                            </span>
                                        ) : null}
                                        {event.status && event.status !== 'confirmed' ? (
                                            <span
                                                className={`inline-flex rounded px-2 py-0.5 text-xs ${
                                                    event.status === 'cancelled'
                                                        ? 'bg-ide-error text-white'
                                                        : 'bg-ide-warn text-ide-bg'
                                                }`}
                                            >
                                                {event.status}
                                            </span>
                                        ) : null}
                                    </div>
                                </div>
                                <div className="flex shrink-0 flex-wrap items-center gap-1">
                                    {event.htmlLink ? (
                                        <a
                                            href={event.htmlLink}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="inline-flex min-h-[36px] items-center gap-1 rounded px-2 py-1 text-sm text-ide-link hover:bg-ide-surface"
                                        >
                                            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                                            {t('calendar.google')}
                                        </a>
                                    ) : null}
                                    {onEditEvent ? (
                                        <button
                                            type="button"
                                            onClick={() => onEditEvent(event.id)}
                                            className="inline-flex min-h-[36px] items-center gap-1 rounded px-2 py-1 text-sm text-ide-link hover:bg-ide-surface"
                                        >
                                            <Pencil className="h-3.5 w-3.5" aria-hidden />
                                            {t('common.edit')}
                                        </button>
                                    ) : null}
                                    {onDeleteEvent ? (
                                        <button
                                            type="button"
                                            onClick={() =>
                                                onDeleteEvent(event.id, event.summary || untitled)
                                            }
                                            className="inline-flex min-h-[36px] items-center gap-1 rounded px-2 py-1 text-sm text-ide-error hover:bg-ide-error/10"
                                        >
                                            <Trash2 className="h-3.5 w-3.5" aria-hidden />
                                            {t('common.delete')}
                                        </button>
                                    ) : null}
                                </div>
                            </div>

                            <dl className="grid gap-1.5 text-sm text-ide-muted">
                                <div className="flex items-start gap-2">
                                    <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-ide-link" aria-hidden />
                                    <div>
                                        <dt className="sr-only">{t('calendar.date')}</dt>
                                        <dd className="text-ide-text">{formatEventListDate(event)}</dd>
                                    </div>
                                </div>
                                <div className="flex items-start gap-2">
                                    <Clock className="mt-0.5 h-4 w-4 shrink-0 text-ide-link" aria-hidden />
                                    <div>
                                        <dt className="sr-only">{t('calendar.time')}</dt>
                                        <dd className="text-ide-text">{formatEventListTime(event)}</dd>
                                    </div>
                                </div>
                                {duration ? (
                                    <div className="flex items-start gap-2">
                                        <Timer className="mt-0.5 h-4 w-4 shrink-0 text-ide-link" aria-hidden />
                                        <div>
                                            <dt className="sr-only">{t('calendar.duration')}</dt>
                                            <dd>{duration}</dd>
                                        </div>
                                    </div>
                                ) : null}
                                {event.location ? (
                                    <div className="flex items-start gap-2">
                                        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-ide-link" aria-hidden />
                                        <div>
                                            <dt className="sr-only">{t('calendar.location')}</dt>
                                            <dd className="text-ide-text">{event.location}</dd>
                                        </div>
                                    </div>
                                ) : null}
                                {organizer ? (
                                    <div className="flex items-start gap-2">
                                        <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-ide-link" aria-hidden />
                                        <div>
                                            <dt className="sr-only">{t('calendar.organizer')}</dt>
                                            <dd>
                                                {organizer}
                                                {event.organizer?.self ? ` ${t('calendar.you')}` : ''}
                                            </dd>
                                        </div>
                                    </div>
                                ) : null}
                                {attendees.length > 0 ? (
                                    <div className="flex items-start gap-2">
                                        <Users className="mt-0.5 h-4 w-4 shrink-0 text-ide-link" aria-hidden />
                                        <div>
                                            <dt className="sr-only">{t('calendar.attendees')}</dt>
                                            <dd>
                                                {t('calendar.attendeeCount', { count: attendees.length })}:{' '}
                                                {attendees.map(attendeeLabel).join(', ')}
                                            </dd>
                                        </div>
                                    </div>
                                ) : null}
                            </dl>

                            {event.description ? (
                                <p className="mt-3 whitespace-pre-wrap text-sm text-ide-text">{event.description}</p>
                            ) : null}

                            {created || updated ? (
                                <p className="mt-3 text-xs text-ide-muted">
                                    {created ? t('calendar.createdAt', { when: created }) : null}
                                    {created && updated ? ' · ' : null}
                                    {updated ? t('calendar.updatedAt', { when: updated }) : null}
                                </p>
                            ) : null}
                        </article>
                    );
                })}
            </div>
        </section>
    );
};

export default CalendarEvents;
