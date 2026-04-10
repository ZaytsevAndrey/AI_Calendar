import React from 'react';
import { GoogleCalendarEvent } from '../../../api/google-calendar.api';
import { formatEventTime, getEventColor, isEventToday } from '../hooks/useCalendar';
import { Spinner } from '../../../ui/Spinner';

interface CalendarEventsProps {
    events: GoogleCalendarEvent[];
    isLoading: boolean;
    error: any;
    title?: string;
    onEditEvent?: (eventId: string) => void;
    onDeleteEvent?: (eventId: string, eventName: string) => void;
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
            <div className="flex justify-center py-8">
                <Spinner className="h-8 w-8" />
            </div>
        );
    }

    if (error) {
        return (
            <div
                className="mb-4 rounded border border-ide-error bg-ide-error/10 px-4 py-3 text-sm text-ide-error"
                role="alert"
            >
                Failed to load events: {error.message}
            </div>
        );
    }

    if (!events || events.length === 0) {
        return (
            <div className="py-8 text-center text-ide-muted">No events found for this period</div>
        );
    }

    return (
        <div>
            <h2 className="mb-4 text-lg font-semibold text-ide-text">
                {title} ({events.length})
            </h2>

            <div className="flex flex-col gap-4">
                {events.map((event) => (
                    <div
                        key={event.id}
                        className="rounded-lg border border-ide-border bg-ide-panel p-4 shadow-ide transition hover:-translate-y-px hover:shadow-ide-md"
                        style={{ borderLeftWidth: 4, borderLeftColor: getEventColor(event) }}
                    >
                        <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                            <h3 className="text-lg font-semibold text-ide-text">
                                {event.summary || 'Untitled Event'}
                            </h3>
                            <div className="flex flex-wrap items-center gap-2">
                                {isEventToday(event) ? (
                                    <span className="rounded border border-ide-link px-2 py-0.5 text-xs text-ide-link">
                                        Today
                                    </span>
                                ) : null}
                                {onEditEvent ? (
                                    <button
                                        type="button"
                                        onClick={() => onEditEvent(event.id)}
                                        className="rounded px-2 py-1 text-sm text-ide-link hover:bg-ide-surface"
                                    >
                                        ✏️ Edit
                                    </button>
                                ) : null}
                                {onDeleteEvent ? (
                                    <button
                                        type="button"
                                        onClick={() =>
                                            onDeleteEvent(event.id, event.summary || 'Untitled Event')
                                        }
                                        className="rounded px-2 py-1 text-sm text-ide-error hover:bg-ide-error/10"
                                    >
                                        🗑️ Delete
                                    </button>
                                ) : null}
                            </div>
                        </div>

                        <p className="mb-2 text-sm text-ide-muted">{formatEventTime(event)}</p>

                        {event.description ? (
                            <p className="mb-2 text-sm text-ide-text">{event.description}</p>
                        ) : null}

                        {event.location ? (
                            <p className="flex items-center gap-1 text-sm text-ide-muted">
                                📍 {event.location}
                            </p>
                        ) : null}

                        {event.attendees && event.attendees.length > 0 ? (
                            <p className="mt-2 text-xs text-ide-muted">
                                Attendees: {event.attendees.length}
                            </p>
                        ) : null}

                        {event.status && event.status !== 'confirmed' ? (
                            <span
                                className={`mt-2 inline-block rounded px-2 py-0.5 text-xs text-white ${
                                    event.status === 'cancelled' ? 'bg-ide-error' : 'bg-ide-warn text-ide-bg'
                                }`}
                            >
                                {event.status}
                            </span>
                        ) : null}
                    </div>
                ))}
            </div>
        </div>
    );
};

export default CalendarEvents;
