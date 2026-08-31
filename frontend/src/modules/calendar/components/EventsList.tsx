import React, { useState } from 'react';
import { GoogleCalendarEvent } from '../../../api/google-calendar.api';
import { formatEventTime, getEventColor, isEventToday, isEventThisWeek, isGoogleEventCurrent } from '../hooks/useCalendar';

interface EventsListProps {
    events: GoogleCalendarEvent[];
    isLoading: boolean;
    error: any;
}

type FilterType = 'today' | 'this-week' | 'upcoming';

const field = 'w-full rounded border border-ide-border bg-ide-input px-3 py-2 text-sm text-ide-text';
const lbl = 'mb-1 block text-sm text-ide-muted';

const EventsList: React.FC<EventsListProps> = ({ events, isLoading, error }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [filterType, setFilterType] = useState<FilterType>('upcoming');

    const filteredEvents = events.filter((event) => {
        const matchesSearch =
            !searchTerm ||
            (event.summary && event.summary.toLowerCase().includes(searchTerm.toLowerCase())) ||
            (event.description &&
                event.description.toLowerCase().includes(searchTerm.toLowerCase())) ||
            (event.location && event.location.toLowerCase().includes(searchTerm.toLowerCase()));

        if (!matchesSearch) return false;

        switch (filterType) {
            case 'today':
                return isEventToday(event) && isGoogleEventCurrent(event);
            case 'this-week':
                return isEventThisWeek(event) && isGoogleEventCurrent(event);
            case 'upcoming':
                return isGoogleEventCurrent(event);
            default:
                return isGoogleEventCurrent(event);
        }
    });

    const sortedEvents = [...filteredEvents].sort((a, b) => {
        const dateA = a.start.dateTime ? new Date(a.start.dateTime) : new Date(a.start.date!);
        const dateB = b.start.dateTime ? new Date(b.start.dateTime) : new Date(b.start.date!);
        return dateA.getTime() - dateB.getTime();
    });

    if (isLoading) {
        return (
            <div className="flex justify-center py-8">
                <p className="text-ide-muted">Loading events...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="py-8 text-center text-ide-error">Failed to load events: {error.message}</div>
        );
    }

    return (
        <div>
            <div className="mb-6 grid gap-4 md:grid-cols-2">
                <div>
                    <label htmlFor="list-search" className={lbl}>
                        Search
                    </label>
                    <div className="relative">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2">
                            🔍
                        </span>
                        <input
                            id="list-search"
                            className={`${field} pl-9`}
                            placeholder="Search events..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>
                <div>
                    <label htmlFor="list-filter" className={lbl}>
                        Filter
                    </label>
                    <select
                        id="list-filter"
                        className={field}
                        value={filterType}
                        onChange={(e) => setFilterType(e.target.value as FilterType)}
                    >
                        <option value="upcoming">Upcoming</option>
                        <option value="today">Today</option>
                        <option value="this-week">This Week</option>
                    </select>
                </div>
            </div>

            <p className="mb-4 text-sm text-ide-muted">
                Showing {sortedEvents.length} of {events.length} events
            </p>

            {sortedEvents.length > 0 ? (
                <div className="flex flex-col gap-4">
                    {sortedEvents.map((event) => (
                        <div
                            key={event.id}
                            className="rounded-lg border border-ide-border bg-ide-panel p-4 shadow-ide transition hover:-translate-y-px hover:shadow-ide-md"
                            style={{ borderLeftWidth: 4, borderLeftColor: getEventColor(event) }}
                        >
                            <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                                <h3 className="text-lg font-semibold text-ide-text">
                                    {event.summary || 'Untitled Event'}
                                </h3>
                                <div className="flex gap-2">
                                    {isEventToday(event) ? (
                                        <span className="rounded border border-ide-link px-2 py-0.5 text-xs text-ide-link">
                                            Today
                                        </span>
                                    ) : null}
                                    {event.status && event.status !== 'confirmed' ? (
                                        <span
                                            className={`rounded px-2 py-0.5 text-xs text-white ${
                                                event.status === 'cancelled'
                                                    ? 'bg-ide-error'
                                                    : 'bg-ide-warn text-ide-bg'
                                            }`}
                                        >
                                            {event.status}
                                        </span>
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
                        </div>
                    ))}
                </div>
            ) : (
                <div className="py-8 text-center text-ide-muted">
                    {searchTerm || filterType !== 'upcoming'
                        ? 'No events match your search criteria'
                        : 'No upcoming events'}
                </div>
            )}
        </div>
    );
};

export default EventsList;
