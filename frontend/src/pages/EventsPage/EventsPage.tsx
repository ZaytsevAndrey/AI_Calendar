import React, { useState } from 'react';
import {
    useEventsForDay,
    useEventsForWeek,
    useEventsForMonth,
    useCreateEvent,
    useUpdateEvent,
    useDeleteEvent,
} from 'modules/calendar/hooks/useCalendar';
import EventForm from 'modules/calendar/components/EventForm';
import { GoogleCalendarEvent } from 'api/google-calendar.api';
import { useTimePhases } from 'modules/phases/hooks/usePhases';
import { EventType } from 'modules/calendar/types';
import { Modal } from '../../ui/Modal';
import { Spinner } from '../../ui/Spinner';

type CalendarView = 'day' | 'week' | 'month';

const EventsPage: React.FC = () => {
    const [currentView, setCurrentView] = useState<CalendarView>('week');
    const [currentDate] = useState(new Date());
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedPhase, setSelectedPhase] = useState<string>('all');
    const { data: timePhases = [] } = useTimePhases();

    const [deleteConfirmDialog, setDeleteConfirmDialog] = useState<{
        open: boolean;
        eventId: string | null;
        eventName: string;
    }>({
        open: false,
        eventId: null,
        eventName: '',
    });
    const [eventFormDialog, setEventFormDialog] = useState<{
        open: boolean;
        event: GoogleCalendarEvent | null;
    }>({
        open: false,
        event: null,
    });

    const dayEventsQuery = useEventsForDay(currentDate);
    const weekEventsQuery = useEventsForWeek(currentDate);
    const monthEventsQuery = useEventsForMonth(
        currentDate.getFullYear(),
        currentDate.getMonth() + 1
    );

    const queryMap = {
        day: dayEventsQuery,
        week: weekEventsQuery,
        month: monthEventsQuery,
    };

    const [createEventTrigger, createEventState] = useCreateEvent();
    const [updateEventTrigger, updateEventState] = useUpdateEvent();
    const [deleteEventTrigger, deleteEventState] = useDeleteEvent();

    const events = queryMap[currentView].data?.events || [];

    const timeToMinutes = (time: string): number => {
        const [hours, minutes] = time.split(':').map(Number);
        return hours * 60 + minutes;
    };

    const filteredEvents = events.filter((event: EventType) => {
        const matchesSearch =
            event.summary?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            event.description?.toLowerCase().includes(searchTerm.toLowerCase());

        let matchesPhase = selectedPhase === 'all';
        if (selectedPhase !== 'all' && event.start?.dateTime) {
            const eventTime = new Date(event.start.dateTime).toLocaleTimeString('en-US', {
                hour12: false,
                hour: '2-digit',
                minute: '2-digit',
            });
            const selectedPhaseData = timePhases.find((phase) => phase.id === selectedPhase);
            if (selectedPhaseData) {
                const eventMinutes = timeToMinutes(eventTime);
                const startMinutes = timeToMinutes(selectedPhaseData.startTime);
                const endMinutes = timeToMinutes(selectedPhaseData.endTime);
                if (startMinutes > endMinutes) {
                    matchesPhase = eventMinutes >= startMinutes || eventMinutes <= endMinutes;
                } else {
                    matchesPhase = eventMinutes >= startMinutes && eventMinutes <= endMinutes;
                }
            }
        }
        return matchesSearch && matchesPhase;
    });

    const handleCreateEvent = () => {
        setEventFormDialog({ open: true, event: null });
    };

    const handleEditEvent = (eventId: string) => {
        const ev = events.find((e: EventType) => e.id === eventId);
        if (ev) {
            setEventFormDialog({ open: true, event: ev });
        }
    };

    const handleDeleteEvent = (eventId: string, eventName: string) => {
        setDeleteConfirmDialog({
            open: true,
            eventId,
            eventName,
        });
    };

    const confirmDeleteEvent = async () => {
        if (deleteConfirmDialog.eventId) {
            try {
                await deleteEventTrigger({ eventId: deleteConfirmDialog.eventId });
                setDeleteConfirmDialog({ open: false, eventId: null, eventName: '' });
            } catch (err) {
                console.error('Failed to delete event:', err);
            }
        }
    };

    const cancelDeleteEvent = () => {
        setDeleteConfirmDialog({ open: false, eventId: null, eventName: '' });
    };

    const handleEventFormSubmit = async (data: any) => {
        try {
            if (eventFormDialog.event) {
                await updateEventTrigger({
                    eventId: eventFormDialog.event.id,
                    eventData: data,
                });
            } else {
                await createEventTrigger({ eventData: data });
            }
            setEventFormDialog({ open: false, event: null });
        } catch (err) {
            console.error('Failed to save event:', err);
        }
    };

    const closeEventForm = () => {
        setEventFormDialog({ open: false, event: null });
    };

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    if (queryMap[currentView].isLoading) {
        return (
            <div className="page-shell">
                <div className="flex justify-center py-20">
                    <Spinner className="h-10 w-10" />
                </div>
            </div>
        );
    }

    if (queryMap[currentView].isError) {
        return (
            <div className="page-shell">
                <div
                    className="rounded-lg border border-ide-error bg-ide-error/10 px-4 py-3 text-sm text-ide-error"
                    role="alert"
                >
                    Failed to load events. Please check your Google Calendar connection.
                </div>
            </div>
        );
    }

    return (
        <div className="page-shell">
            <header className="page-head">
                <div>
                    <h1 className="page-title">Events</h1>
                    <p className="page-lead">Manage and organize your calendar events</p>
                </div>
                <button type="button" onClick={handleCreateEvent} className="ui-btn-primary w-full sm:w-auto">
                    Create event
                </button>
            </header>

            <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <div className="min-w-0 sm:col-span-2 xl:col-span-1">
                    <label htmlFor="ev-search" className="ui-label">
                        Search events
                    </label>
                    <div className="relative">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ide-muted">
                            🔍
                        </span>
                        <input
                            id="ev-search"
                            className="ui-input pl-9"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder="Search…"
                        />
                    </div>
                </div>
                <div className="min-w-0">
                    <label htmlFor="ev-phase-filter" className="ui-label">
                        Time phase
                    </label>
                    <select
                        id="ev-phase-filter"
                        className="ui-select"
                        value={selectedPhase}
                        onChange={(e) => setSelectedPhase(e.target.value)}
                    >
                        <option value="all">All phases</option>
                        {timePhases.map((phase) => (
                            <option key={phase.id} value={phase.id}>
                                {phase.name} ({phase.startTime} - {phase.endTime})
                            </option>
                        ))}
                    </select>
                </div>
                <div className="min-w-0">
                    <label htmlFor="ev-range" className="ui-label">
                        Time range
                    </label>
                    <select
                        id="ev-range"
                        className="ui-select"
                        value={currentView}
                        onChange={(e) => setCurrentView(e.target.value as CalendarView)}
                    >
                        <option value="day">Today</option>
                        <option value="week">This week</option>
                        <option value="month">This month</option>
                    </select>
                </div>
            </div>

            <div>
                <h2 className="mb-4 text-lg font-semibold text-ide-text">
                    Events ({filteredEvents.length})
                </h2>

                {filteredEvents.length === 0 ? (
                    <div className="py-16 text-center text-ide-muted">
                        No events found. Try adjusting your search criteria or create a new event.
                    </div>
                ) : (
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {filteredEvents.map((event: EventType) => (
                            <div
                                key={event.id}
                                className="flex flex-col rounded-lg border border-ide-border bg-ide-panel shadow-ide"
                            >
                                <div className="flex-1 border-b border-ide-border p-4">
                                    <h3 className="mb-2 text-lg font-semibold text-ide-text">
                                        {event.summary || 'Untitled Event'}
                                    </h3>
                                    <p className="mb-2 text-sm text-ide-muted">
                                        📅{' '}
                                        {formatDate(event.start?.dateTime || event.start?.date || '')}
                                    </p>
                                    {event.description ? (
                                        <p className="mb-2 text-sm text-ide-text">
                                            {event.description.length > 100
                                                ? `${event.description.substring(0, 100)}...`
                                                : event.description}
                                        </p>
                                    ) : null}
                                    {event.start?.dateTime &&
                                        (() => {
                                            const eventTime = new Date(
                                                event.start.dateTime
                                            ).toLocaleTimeString('en-US', {
                                                hour12: false,
                                                hour: '2-digit',
                                                minute: '2-digit',
                                            });
                                            const phase = timePhases.find((cat) => {
                                                const eventMinutes = timeToMinutes(eventTime);
                                                const startMinutes = timeToMinutes(cat.startTime);
                                                const endMinutes = timeToMinutes(cat.endTime);
                                                if (startMinutes > endMinutes) {
                                                    return (
                                                        eventMinutes >= startMinutes ||
                                                        eventMinutes <= endMinutes
                                                    );
                                                }
                                                return (
                                                    eventMinutes >= startMinutes &&
                                                    eventMinutes <= endMinutes
                                                );
                                            });
                                            return phase ? (
                                                <span
                                                    className="mb-2 inline-block rounded px-2 py-0.5 text-xs text-white"
                                                    style={{ backgroundColor: phase.color }}
                                                >
                                                    {phase.name}
                                                </span>
                                            ) : null;
                                        })()}
                                    {event.location ? (
                                        <p className="text-sm text-ide-muted">📍 {event.location}</p>
                                    ) : null}
                                </div>
                                <div className="flex flex-col gap-2 border-t border-ide-border p-3 sm:flex-row sm:flex-wrap">
                                    <button
                                        type="button"
                                        className="ui-btn-secondary flex-1 text-ide-link sm:flex-none"
                                        onClick={() => handleEditEvent(event.id)}
                                    >
                                        Edit
                                    </button>
                                    <button
                                        type="button"
                                        className="ui-btn-danger flex-1 sm:flex-none"
                                        onClick={() =>
                                            handleDeleteEvent(event.id, event.summary || 'Untitled Event')
                                        }
                                    >
                                        Delete
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <EventForm
                open={eventFormDialog.open}
                onClose={closeEventForm}
                onSubmit={handleEventFormSubmit}
                event={eventFormDialog.event}
                isSubmitting={createEventState.isLoading || updateEventState.isLoading}
                error={
                    (createEventState.error instanceof Error
                        ? createEventState.error.message
                        : undefined) ||
                    (updateEventState.error instanceof Error
                        ? updateEventState.error.message
                        : undefined)
                }
            />

            <Modal
                open={deleteConfirmDialog.open}
                onClose={cancelDeleteEvent}
                title="Delete Event"
                footer={
                    <>
                        <button
                            type="button"
                            onClick={cancelDeleteEvent}
                            disabled={deleteEventState.isLoading}
                            className="ui-btn-secondary w-full sm:w-auto"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={confirmDeleteEvent}
                            disabled={deleteEventState.isLoading}
                            className="ui-btn-danger w-full sm:w-auto"
                        >
                            {deleteEventState.isLoading ? 'Deleting...' : 'Delete'}
                        </button>
                    </>
                }
            >
                <p className="mb-3 text-ide-text">
                    Are you sure you want to delete the event &quot;{deleteConfirmDialog.eventName}&quot;?
                </p>
                <p className="text-sm text-ide-muted">
                    This action cannot be undone. The event will be permanently removed from your Google
                    Calendar.
                </p>
            </Modal>
        </div>
    );
};

export default EventsPage;
