import React, { useState } from 'react';
import { format } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
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
import { CalendarDatePicker } from 'modules/calendar/components/CalendarDatePicker';
import { EventType } from 'modules/calendar/types';
import { useScheduleActions } from 'modules/schedule/hooks/useScheduleActions';
import { GenerateAlertsBanner } from 'modules/schedule/components/GenerateAlertsBanner';
import { ScheduleMenu } from 'modules/schedule/components/ScheduleMenu';
import { useEventEditor } from 'modules/events/hooks/useEventEditor';
import { formValuesFromCreatePayload } from 'modules/tasks/task-wizard/buildPayload';
import { VoiceTaskButton } from 'modules/voice/components/VoiceTaskButton';
import { VoiceTaskSheet } from 'modules/voice/components/VoiceTaskSheet';
import { useVoiceTask } from 'modules/voice/hooks/useVoiceTask';
import { Modal } from '../../ui/Modal';
import { Spinner } from '../../ui/Spinner';
import { showErrorToast, showSuccessToast } from '../../utils/toast';
import { extractApiErrorMessage } from '../../utils/extractApiErrorMessage';
import {
    endOfLocalDayIso,
    startOfLocalDayIso,
    formatLongDate,
    formatMonthYear,
    formatWeekRange,
} from '../../utils/formatDate';

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

function periodLabel(date: Date, view: CalendarView): string {
    if (view === 'day') return formatLongDate(date);
    if (view === 'month') return formatMonthYear(date);
    const start = startOfWeekMonday(date);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return formatWeekRange(start, end);
}

const CalendarPage: React.FC = () => {
    const [currentView, setCurrentView] = useState<CalendarView>('week');
    const [currentDate, setCurrentDate] = useState(new Date());
    const [deleteConfirmDialog, setDeleteConfirmDialog] = useState<{
        open: boolean;
        eventId: string | null;
        calendarId?: string;
        eventName: string;
    }>({
        open: false,
        eventId: null,
        eventName: '',
    });
    const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
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
    const { openCreate, openCreateFromPrefill, createFromPayload, editorModal } = useEventEditor();
    const voice = useVoiceTask({
        onComplete: createFromPayload,
        onSufficient: (task) => openCreateFromPrefill(formValuesFromCreatePayload(task)),
    });
    const busy = isGenerating || isClearing;
    const displayEvents = visibleGoogleEvents(getEventsQuery.data?.events || []);

    const handleDeleteEvent = (eventId: string, eventName: string) => {
        const event = displayEvents.find((item) => item.id === eventId);
        setDeleteConfirmDialog({
            open: true,
            eventId,
            calendarId: event?.calendarId,
            eventName,
        });
    };

    const confirmDeleteEvent = async () => {
        if (deleteConfirmDialog.eventId) {
            try {
                await deleteEventTrigger({
                    eventId: deleteConfirmDialog.eventId,
                    calendarId: deleteConfirmDialog.calendarId,
                }).unwrap();
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
                    calendarId: eventFormDialog.event.calendarId,
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

    const handleCreateForDate = (day: Date) => {
        openCreate({
            earliestStartTime: startOfLocalDayIso(day),
            deadline: endOfLocalDayIso(day),
        });
    };

    const runGenerate = () => {
        const { startDate, endDate } = visibleRangeYmd(currentView, currentDate);
        void generate(startDate, endDate);
    };

    const confirmClear = async () => {
        setClearConfirmOpen(false);
        await clear();
    };

    return (
        <div className="page-shell-fill">
            <header className="mb-4 shrink-0 space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <h1 className="page-title">Calendar</h1>
                        <p className="page-lead">{periodLabel(currentDate, currentView)}</p>
                    </div>
                    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:justify-end">
                        <button
                            type="button"
                            onClick={() => openCreate()}
                            className="ui-btn-primary w-full sm:w-auto"
                        >
                            Create task
                        </button>
                        <VoiceTaskButton onClick={voice.open} />
                        <ScheduleMenu
                            busy={busy}
                            isGenerating={isGenerating}
                            isClearing={isClearing}
                            onGenerate={runGenerate}
                            onClear={() => setClearConfirmOpen(true)}
                        />
                    </div>
                </div>
                {generateAlerts ? (
                    <GenerateAlertsBanner
                        alerts={generateAlerts}
                        onDismiss={dismissGenerateAlerts}
                    />
                ) : null}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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

                    <div className="flex flex-wrap items-center justify-center gap-1 sm:justify-end">
                        <button
                            type="button"
                            className="ui-btn-ghost min-h-[44px] min-w-[44px] px-0"
                            onClick={() => setCurrentDate((prev) => shiftPeriod(prev, currentView, -1))}
                            aria-label={`Previous ${currentView}`}
                        >
                            <ChevronLeft className="mx-auto h-5 w-5" aria-hidden />
                        </button>
                        <CalendarDatePicker
                            value={currentDate}
                            label={periodLabel(currentDate, currentView)}
                            onChange={setCurrentDate}
                        />
                        <button
                            type="button"
                            className="ui-btn-ghost min-h-[44px] min-w-[44px] px-0"
                            onClick={() => setCurrentDate((prev) => shiftPeriod(prev, currentView, 1))}
                            aria-label={`Next ${currentView}`}
                        >
                            <ChevronRight className="mx-auto h-5 w-5" aria-hidden />
                        </button>
                        <button type="button" className="ui-btn-secondary px-4" onClick={() => setCurrentDate(new Date())}>
                            Today
                        </button>
                    </div>
                </div>
            </header>

            {getEventsQuery.isLoading ? (
                <div className="flex min-h-0 flex-1 items-center justify-center">
                    <Spinner className="h-10 w-10" />
                </div>
            ) : getEventsQuery.isError ? (
                <div
                    className="rounded-lg border border-ide-error bg-ide-error/10 px-4 py-3 text-sm text-ide-error"
                    role="alert"
                >
                    Failed to load calendar events. Please check your Google Calendar connection.
                </div>
            ) : (
                <div className="flex min-h-0 flex-1 flex-col gap-4 xl:flex-row">
                    <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
                        <CalendarGrid
                            view={currentView}
                            date={currentDate}
                            events={displayEvents}
                            onEditEvent={handleEditEvent}
                            onCreateForDate={handleCreateForDate}
                        />
                    </div>
                    <div className="flex h-[min(18rem,38vh)] min-h-0 w-full shrink-0 flex-col overflow-hidden xl:h-auto xl:w-[24rem]">
                        <CalendarEvents
                            events={displayEvents}
                            isLoading={getEventsQuery.isLoading}
                            error={getEventsQuery.error}
                            title={`${currentView.charAt(0).toUpperCase() + currentView.slice(1)} events`}
                            onEditEvent={handleEditEvent}
                            onDeleteEvent={handleDeleteEvent}
                        />
                    </div>
                </div>
            )}

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

            <Modal
                open={clearConfirmOpen}
                onClose={() => setClearConfirmOpen(false)}
                title="Clear schedule"
                footer={
                    <>
                        <button
                            type="button"
                            onClick={() => setClearConfirmOpen(false)}
                            disabled={isClearing}
                            className="ui-btn-secondary w-full sm:w-auto"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={() => void confirmClear()}
                            disabled={isClearing}
                            className="ui-btn-danger w-full sm:w-auto"
                        >
                            {isClearing ? 'Clearing…' : 'Clear schedule'}
                        </button>
                    </>
                }
            >
                <p className="text-ide-text">
                    Clear all app-generated schedule blocks in the planning horizon? This cannot be undone.
                </p>
            </Modal>

            {editorModal}
            <VoiceTaskSheet voice={voice} />
        </div>
    );
};

export default CalendarPage;
