import React, { useState } from 'react';
import { format } from 'date-fns';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import {
    useEventsForDay,
    useEventsForWeek,
    useEventsForMonth,
    useUpdateEvent,
    useDeleteEvent,
    visibleGoogleEvents,
    startOfWeekMonday,
} from 'modules/calendar/hooks/useCalendar';
import EventForm from 'modules/calendar/components/EventForm';
import { GoogleCalendarEvent } from 'api/google-calendar.api';
import CalendarEvents from 'modules/calendar/components/CalendarEvents';
import CalendarGrid from 'modules/calendar/components/CalendarGrid';
import { EventType } from 'modules/calendar/types';
import { useScheduleActions } from 'modules/schedule/hooks/useScheduleActions';
import { GenerateAlertsBanner } from 'modules/schedule/components/GenerateAlertsBanner';
import { useEventEditor } from 'modules/events/hooks/useEventEditor';
import { Modal } from '../../ui/Modal';
import { Spinner } from '../../ui/Spinner';
import { showErrorToast, showSuccessToast } from '../../utils/toast';
import { extractApiErrorMessage } from '../../utils/extractApiErrorMessage';

type CalendarView = 'day' | 'week' | 'month';

function visibleRangeYmd(view: CalendarView, date: Date): { startDate: string; endDate: string } {
    if (view === 'day') {
        const day = format(date, 'yyyy-MM-dd');
        return { startDate: day, endDate: day };
    }
    if (view === 'week') {
        const start = startOfWeekMonday(date);
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        return {
            startDate: format(start, 'yyyy-MM-dd'),
            endDate: format(end, 'yyyy-MM-dd'),
        };
    }
    const start = new Date(date.getFullYear(), date.getMonth(), 1);
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    return {
        startDate: format(start, 'yyyy-MM-dd'),
        endDate: format(end, 'yyyy-MM-dd'),
    };
}

const toggleBtn = (active: boolean) =>
    `min-h-[44px] rounded-md px-4 py-2 text-sm font-medium transition ${
        active ? 'bg-ide-selection text-ide-text' : 'text-ide-muted hover:bg-ide-surface'
    }`;

function shiftPeriod(date: Date, view: CalendarView, delta: number): Date {
    const next = new Date(date);
    if (view === 'day') next.setDate(next.getDate() + delta);
    else if (view === 'week') next.setDate(next.getDate() + delta * 7);
    else next.setMonth(next.getMonth() + delta);
    return next;
}

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
    const { isGenerating, isClearing, generate, clear, generateAlerts, dismissGenerateAlerts } =
        useScheduleActions();
    const { openCreate, editorModal } = useEventEditor();
    const busy = isGenerating || isClearing;
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

    const createEventFab = (
        <>
            <button
                type="button"
                onClick={openCreate}
                className="fixed bottom-6 right-6 z-[1100] flex h-14 w-14 items-center justify-center rounded-full bg-ide-accentBlue text-white shadow-ide-md hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ide-link"
                aria-label="Create event"
            >
                <Plus className="h-7 w-7" aria-hidden />
            </button>
            {editorModal}
        </>
    );

    if (getEventsQuery.isLoading) {
        return (
            <div className="page-shell">
                <div className="flex justify-center py-20">
                    <Spinner className="h-10 w-10" />
                </div>
                {createEventFab}
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
                {createEventFab}
            </div>
        );
    }

    return (
        <div className="page-shell">
            <header className="mb-6 space-y-4 sm:mb-8">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <h1 className="page-title">Calendar</h1>
                    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:justify-end">
                        <button
                            type="button"
                            onClick={() => {
                                const { startDate, endDate } = visibleRangeYmd(currentView, currentDate);
                                void generate(startDate, endDate);
                            }}
                            disabled={busy}
                            className="ui-btn-primary w-full sm:w-auto"
                        >
                            {isGenerating ? 'Generating…' : 'Generate schedule'}
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                void clear();
                            }}
                            disabled={busy}
                            className="ui-btn-danger w-full sm:w-auto"
                        >
                            {isClearing ? 'Clearing…' : 'Clear schedule'}
                        </button>
                    </div>
                </div>
                {generateAlerts ? (
                    <GenerateAlertsBanner
                        alerts={generateAlerts}
                        onDismiss={dismissGenerateAlerts}
                    />
                ) : null}
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

                    <div className="flex items-center justify-center gap-1 sm:justify-end lg:shrink-0">
                        <button
                            type="button"
                            className="ui-btn-ghost min-h-[44px] min-w-[44px] px-0"
                            onClick={() => setCurrentDate((prev) => shiftPeriod(prev, currentView, -1))}
                            aria-label={`Previous ${currentView}`}
                        >
                            <ChevronLeft className="mx-auto h-5 w-5" aria-hidden />
                        </button>
                        <button type="button" className="ui-btn-secondary px-4" onClick={() => setCurrentDate(new Date())}>
                            Today
                        </button>
                        <button
                            type="button"
                            className="ui-btn-ghost min-h-[44px] min-w-[44px] px-0"
                            onClick={() => setCurrentDate((prev) => shiftPeriod(prev, currentView, 1))}
                            aria-label={`Next ${currentView}`}
                        >
                            <ChevronRight className="mx-auto h-5 w-5" aria-hidden />
                        </button>
                    </div>
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

            {createEventFab}
        </div>
    );
};

export default CalendarPage;
