import React, { useState } from 'react';
import {
    useEventsForDay,
    useEventsForWeek,
    useEventsForMonth,
    useUpdateEvent,
    useDeleteEvent,
    visibleGoogleEvents,
} from 'modules/calendar/hooks/useCalendar';
import EventForm from 'modules/calendar/components/EventForm';
import { GoogleCalendarEvent } from 'api/google-calendar.api';
import CalendarEvents from 'modules/calendar/components/CalendarEvents';
import CalendarGrid from 'modules/calendar/components/CalendarGrid';
import { EventType } from 'modules/calendar/types';
import { Modal } from '../../ui/Modal';
import { Spinner } from '../../ui/Spinner';
import { showErrorToast, showSuccessToast } from '../../utils/toast';
import { extractApiErrorMessage } from '../../utils/extractApiErrorMessage';

type CalendarView = 'day' | 'week' | 'month';

const toggleBtn = (active: boolean) =>
    `min-h-[44px] rounded-md px-4 py-2 text-sm font-medium transition ${
        active ? 'bg-ide-selection text-ide-text' : 'text-ide-muted hover:bg-ide-surface'
    }`;

const CalendarPage: React.FC = () => {
    const [currentView, setCurrentView] = useState<CalendarView>('week');
    const [currentDate, setCurrentDate] = useState(new Date());
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

    const getEventsQuery = queryMap[currentView];
    const [updateEventTrigger, updateEventState] = useUpdateEvent();
    const [deleteEventTrigger, deleteEventState] = useDeleteEvent();
    const displayEvents = visibleGoogleEvents(
        getEventsQuery.data?.events || [],
        currentView,
        currentDate,
    );

    const formatDate = (date: Date, view: CalendarView): string => {
        switch (view) {
            case 'day':
                return date.toLocaleDateString('en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                });
            case 'week': {
                const startOfWeek = new Date(date);
                const dayOfWeek = date.getDay();
                const daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
                startOfWeek.setDate(date.getDate() - daysToSubtract);
                const endOfWeek = new Date(startOfWeek);
                endOfWeek.setDate(startOfWeek.getDate() + 6);
                return `${startOfWeek.toLocaleDateString()} - ${endOfWeek.toLocaleDateString()}`;
            }
            case 'month':
                return date.toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                });
            default:
                return date.toLocaleDateString();
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
                await deleteEventTrigger({ eventId: deleteConfirmDialog.eventId }).unwrap();
                showSuccessToast('Event deleted.');
                setDeleteConfirmDialog({ open: false, eventId: null, eventName: '' });
            } catch (err) {
                showErrorToast(extractApiErrorMessage(err));
            }
        }
    };

    const cancelDeleteEvent = () => {
        setDeleteConfirmDialog({ open: false, eventId: null, eventName: '' });
    };

    const handleEditEvent = (eventId: string) => {
        const event = displayEvents.find((e: EventType) => e.id === eventId);
        if (event) {
            setEventFormDialog({ open: true, event });
        }
    };

    const handleEventFormSubmit = async (data: any) => {
        try {
            if (eventFormDialog.event) {
                await updateEventTrigger({
                    eventId: eventFormDialog.event.id,
                    eventData: data,
                }).unwrap();
            }
            showSuccessToast('Event updated.');
            setEventFormDialog({ open: false, event: null });
        } catch (err) {
            showErrorToast(extractApiErrorMessage(err));
        }
    };

    const closeEventForm = () => {
        setEventFormDialog({ open: false, event: null });
    };

    if (getEventsQuery.isLoading) {
        return (
            <div className="page-shell">
                <div className="flex justify-center py-20">
                    <Spinner className="h-10 w-10" />
                </div>
            </div>
        );
    }

    if (getEventsQuery.isError) {
        return (
            <div className="page-shell">
                <div
                    className="rounded-lg border border-ide-error bg-ide-error/10 px-4 py-3 text-sm text-ide-error"
                    role="alert"
                >
                    Failed to load calendar events. Please check your Google Calendar connection.
                </div>
            </div>
        );
    }

    return (
        <div className="page-shell">
            <header className="mb-6 space-y-4 sm:mb-8">
                <h1 className="page-title">Calendar</h1>
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
                    <div className="inline-flex w-full max-w-md rounded-lg border border-ide-border bg-ide-surface p-1 sm:w-auto">
                        {(['day', 'week', 'month'] as const).map((v) => (
                            <button
                                key={v}
                                type="button"
                                onClick={() => setCurrentView(v)}
                                className={`flex-1 sm:flex-none ${toggleBtn(currentView === v)}`}
                                aria-pressed={currentView === v}
                            >
                                {v.charAt(0).toUpperCase() + v.slice(1)}
                            </button>
                        ))}
                    </div>

                    <h2 className="text-center text-lg font-medium text-ide-text lg:order-none lg:flex-1 lg:text-left">
                        {formatDate(currentDate, currentView)}
                    </h2>

                    {currentView === 'day' ? (
                        <div className="flex items-center justify-center gap-1 sm:justify-end lg:shrink-0">
                            <button
                                type="button"
                                className="ui-btn-ghost min-h-[44px] min-w-[44px] px-0"
                                onClick={() =>
                                    setCurrentDate((prev) => {
                                        const d = new Date(prev);
                                        d.setDate(d.getDate() - 1);
                                        return d;
                                    })
                                }
                                aria-label="Previous day"
                            >
                                ←
                            </button>
                            <button type="button" className="ui-btn-secondary px-4" onClick={() => setCurrentDate(new Date())}>
                                Today
                            </button>
                            <button
                                type="button"
                                className="ui-btn-ghost min-h-[44px] min-w-[44px] px-0"
                                onClick={() =>
                                    setCurrentDate((prev) => {
                                        const d = new Date(prev);
                                        d.setDate(d.getDate() + 1);
                                        return d;
                                    })
                                }
                                aria-label="Next day"
                            >
                                →
                            </button>
                        </div>
                    ) : null}
                </div>
            </header>

            <div className="mb-6 min-w-0 overflow-x-auto">
                <CalendarGrid
                    view={currentView}
                    date={currentDate}
                    events={displayEvents}
                    onEditEvent={handleEditEvent}
                    onDeleteEvent={handleDeleteEvent}
                />
            </div>

            <CalendarEvents
                events={displayEvents}
                isLoading={getEventsQuery.isLoading}
                error={getEventsQuery.error}
                title={`${currentView.charAt(0).toUpperCase() + currentView.slice(1)} Events`}
                onEditEvent={handleEditEvent}
                onDeleteEvent={handleDeleteEvent}
            />

            <EventForm
                open={eventFormDialog.open}
                onClose={closeEventForm}
                onSubmit={handleEventFormSubmit}
                event={eventFormDialog.event}
                isSubmitting={updateEventState.isLoading}
                error={
                    updateEventState.error instanceof Error
                        ? updateEventState.error.message
                        : undefined
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

export default CalendarPage;
