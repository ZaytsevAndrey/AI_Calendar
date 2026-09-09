import React from 'react';
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
    if (mins < 60) return `${mins} min`;
    const hours = Math.floor(mins / 60);
    const rest = mins % 60;
    return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function attendeeLabel(person: NonNullable<GoogleCalendarEvent['attendees']>[number]): string {
    const name = person.displayName || person.email;
    if (!person.responseStatus || person.responseStatus === 'needsAction') return name;
    const status =
        person.responseStatus === 'accepted'
            ? 'accepted'
            : person.responseStatus === 'declined'
              ? 'declined'
              : 'tentative';
    return `${name} (${status})`;
}

function formatStamp(iso?: string): string | null {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString('en-GB', {
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
    title = 'Events',
    onEditEvent,
    onDeleteEvent,
}) => {
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
                Failed to load events: {error.message}
            </div>
        );
    }

    if (!events || events.length === 0) {
        return (
            <div className="flex h-full items-center justify-center rounded-xl border border-ide-border bg-ide-panel px-4 text-center text-ide-muted">
                No events found for this period
            </div>
        );
    }

    return (
        <section className="flex h-full min-h-0 flex-col">
            <h2 className="mb-3 shrink-0 text-lg font-semibold text-ide-text">
                {title} ({events.length})
            </h2>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                {events.map((event) => {
                    const duration = formatDuration(event);
                    const organizer = event.organizer?.displayName || event.organizer?.email;
                    const created = formatStamp(event.created);
                    const updated = formatStamp(event.updated);
                    const attendees = event.attendees ?? [];

                    return (
                        <article
                            key={event.id}
                            className="rounded-lg border border-ide-border bg-ide-panel p-4 shadow-ide"
                            style={{ borderLeftWidth: 4, borderLeftColor: getEventColor(event) }}
                        >
                            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <h3 className="text-base font-semibold text-ide-text">
                                        {event.summary || 'Untitled Event'}
                                    </h3>
                                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                                        {isPastAppEvent(event) ? (
                                            <span className="inline-flex items-center gap-1 rounded border border-ide-border px-2 py-0.5 text-xs text-ide-muted">
                                                Past
                                            </span>
                                        ) : null}
                                        {isEventToday(event) ? (
                                            <span className="inline-flex items-center gap-1 rounded border border-ide-link px-2 py-0.5 text-xs text-ide-link">
                                                <CalendarDays className="h-3 w-3" aria-hidden />
                                                Today
                                            </span>
                                        ) : null}
                                        {isAllDayEvent(event) ? (
                                            <span className="inline-flex items-center gap-1 rounded border border-ide-border px-2 py-0.5 text-xs text-ide-muted">
                                                All day
                                            </span>
                                        ) : null}
                                        {event.recurringEventId ? (
                                            <span className="inline-flex items-center gap-1 rounded border border-ide-border px-2 py-0.5 text-xs text-ide-muted">
                                                <Repeat className="h-3 w-3" aria-hidden />
                                                Recurring
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
                                            Google
                                        </a>
                                    ) : null}
                                    {onEditEvent ? (
                                        <button
                                            type="button"
                                            onClick={() => onEditEvent(event.id)}
                                            className="inline-flex min-h-[36px] items-center gap-1 rounded px-2 py-1 text-sm text-ide-link hover:bg-ide-surface"
                                        >
                                            <Pencil className="h-3.5 w-3.5" aria-hidden />
                                            Edit
                                        </button>
                                    ) : null}
                                    {onDeleteEvent ? (
                                        <button
                                            type="button"
                                            onClick={() =>
                                                onDeleteEvent(event.id, event.summary || 'Untitled Event')
                                            }
                                            className="inline-flex min-h-[36px] items-center gap-1 rounded px-2 py-1 text-sm text-ide-error hover:bg-ide-error/10"
                                        >
                                            <Trash2 className="h-3.5 w-3.5" aria-hidden />
                                            Delete
                                        </button>
                                    ) : null}
                                </div>
                            </div>

                            <dl className="grid gap-1.5 text-sm text-ide-muted">
                                <div className="flex items-start gap-2">
                                    <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-ide-link" aria-hidden />
                                    <div>
                                        <dt className="sr-only">Date</dt>
                                        <dd className="text-ide-text">{formatEventListDate(event)}</dd>
                                    </div>
                                </div>
                                <div className="flex items-start gap-2">
                                    <Clock className="mt-0.5 h-4 w-4 shrink-0 text-ide-link" aria-hidden />
                                    <div>
                                        <dt className="sr-only">Time</dt>
                                        <dd className="text-ide-text">{formatEventListTime(event)}</dd>
                                    </div>
                                </div>
                                {duration ? (
                                    <div className="flex items-start gap-2">
                                        <Timer className="mt-0.5 h-4 w-4 shrink-0 text-ide-link" aria-hidden />
                                        <div>
                                            <dt className="sr-only">Duration</dt>
                                            <dd>{duration}</dd>
                                        </div>
                                    </div>
                                ) : null}
                                {event.location ? (
                                    <div className="flex items-start gap-2">
                                        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-ide-link" aria-hidden />
                                        <div>
                                            <dt className="sr-only">Location</dt>
                                            <dd className="text-ide-text">{event.location}</dd>
                                        </div>
                                    </div>
                                ) : null}
                                {organizer ? (
                                    <div className="flex items-start gap-2">
                                        <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-ide-link" aria-hidden />
                                        <div>
                                            <dt className="sr-only">Organizer</dt>
                                            <dd>
                                                {organizer}
                                                {event.organizer?.self ? ' (you)' : ''}
                                            </dd>
                                        </div>
                                    </div>
                                ) : null}
                                {attendees.length > 0 ? (
                                    <div className="flex items-start gap-2">
                                        <Users className="mt-0.5 h-4 w-4 shrink-0 text-ide-link" aria-hidden />
                                        <div>
                                            <dt className="sr-only">Attendees</dt>
                                            <dd>
                                                {attendees.length} attendee{attendees.length === 1 ? '' : 's'}:{' '}
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
                                    {created ? `Created ${created}` : null}
                                    {created && updated ? ' · ' : null}
                                    {updated ? `Updated ${updated}` : null}
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
