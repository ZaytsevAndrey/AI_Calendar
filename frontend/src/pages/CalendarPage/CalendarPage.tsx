import React, { useEffect, useRef, useState } from 'react';
import { useDispatch } from 'react-redux';
import { Calendar, CalendarDays, ChevronLeft, ChevronRight, Columns3, List, Mic, MoreHorizontal, Plus } from 'lucide-react';
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
import { useGetUserSettingsQuery } from 'api/userSettingsApi';
import CalendarEvents from 'modules/calendar/components/CalendarEvents';
import CalendarGrid from 'modules/calendar/components/CalendarGrid';
import { CalendarDatePicker } from 'modules/calendar/components/CalendarDatePicker';
import { CalendarVisibilityMenu } from 'modules/calendar/components/CalendarVisibilityMenu';
import { EventType } from 'modules/calendar/types';
import { ScheduleApi, ScheduleJobResultPayload } from 'api/schedule.api';
import { useScheduleActions } from 'modules/schedule/hooks/useScheduleActions';
import { GeneratePreviewDialog } from 'modules/schedule/components/GeneratePreviewDialog';
import { GenerateAlertsBanner } from 'modules/schedule/components/GenerateAlertsBanner';
import { GenerateProgressPanel } from 'modules/schedule/components/GenerateProgressPanel';
import { ScheduleMenu } from 'modules/schedule/components/ScheduleMenu';
import { ScheduleSuggestionsDialog } from 'modules/schedule/components/ScheduleSuggestionsDialog';
import { NowStrip } from 'modules/now/components/NowStrip';
import { resolveIanaTimeZone } from 'modules/user-settings/ianaTimeZones';
import { useEventEditor } from 'modules/events/hooks/useEventEditor';
import { findTaskForGoogleEvent } from 'modules/calendar/findTaskForGoogleEvent';
import { eventTasksApi, useGetEventsQuery as useGetTasksQuery } from 'api/eventTasksApi';
import { eventsApi } from 'api/eventsApi';
import { useGetHabitsQuery } from 'api/habitsApi';
import { isHabitGoogleEvent } from 'modules/habits/habitBlocks';
import { VoiceTaskButton } from 'modules/voice/components/VoiceTaskButton';
import { VoiceTaskSheet } from 'modules/voice/components/VoiceTaskSheet';
import { useVoiceTask } from 'modules/voice/hooks/useVoiceTask';
import { useCoarsePointer, usePhoneLayout } from 'modules/common/hooks/useMediaQuery';
import { PhoneWeekStrip } from 'modules/calendar/components/PhoneWeekStrip';
import { Modal } from '../../ui/Modal';
import { Spinner } from '../../ui/Spinner';
import { showErrorToast, showSuccessToast } from '../../utils/toast';
import { extractApiErrorMessage } from '../../utils/extractApiErrorMessage';
import { formatDateTimeRange, joinToastDetail } from '../../utils/formatDate';
import { civilDayStartEndIso, ymdFromLocalDate } from '../../utils/ianaDateTime';
import {
    CalendarView,
    compactPeriodLabel,
    periodLabel,
    shiftPeriod,
    visibleRangeYmd,
    eventStartDate,
    eventEndDate,
} from 'modules/calendar/calendarView';

const toggleBtn = (active: boolean) =>
    `min-h-[44px] rounded-md px-4 py-2 text-sm font-medium transition ${
        active ? 'bg-ide-selection text-ide-text' : 'text-ide-muted hover:bg-ide-surface'
    }`;

const phoneIcon =
    'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ide-text hover:bg-white/5';

const phoneToggle = (active: boolean) =>
    `inline-flex h-7 w-7 items-center justify-center rounded ${
        active ? 'bg-ide-selection text-ide-text' : 'text-ide-muted'
    }`;

const PHONE_VIEWS = [
    { id: 'day', label: 'Day', Icon: Calendar },
    { id: 'week', label: 'Week', Icon: Columns3 },
    { id: 'month', label: 'Month', Icon: CalendarDays },
] as const;

const CALENDAR_VIEW_KEY = 'calendar-view';

function storedCalendarView(): CalendarView | null {
    try {
        const value = sessionStorage.getItem(CALENDAR_VIEW_KEY);
        if (value === 'day' || value === 'week' || value === 'month') return value;
    } catch {
        return null;
    }
    return null;
}

function defaultCalendarView(): CalendarView {
    const stored = storedCalendarView();
    if (stored) return stored;
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches) {
        return 'day';
    }
    return 'week';
}

const CalendarPage: React.FC = () => {
    const dispatch = useDispatch();
    const phone = usePhoneLayout();
    const coarse = useCoarsePointer();
    const [currentView, setCurrentView] = useState<CalendarView>(defaultCalendarView);
    const [currentDate, setCurrentDate] = useState(new Date());
    const [actionsOpen, setActionsOpen] = useState(false);
    const [eventsOpen, setEventsOpen] = useState(false);
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
    const [undoConfirmOpen, setUndoConfirmOpen] = useState(false);
    const [suggestionsOpen, setSuggestionsOpen] = useState(false);
    const [previewOpen, setPreviewOpen] = useState(false);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [previewError, setPreviewError] = useState<string | null>(null);
    const [previewResult, setPreviewResult] = useState<ScheduleJobResultPayload | null>(null);
    const previewRequest = useRef(0);
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
    const [updateEventTrigger] = useUpdateEvent();
    const [deleteEventTrigger] = useDeleteEvent();
    const {
        isGenerating,
        isClearing,
        isUndoing,
        canUndo,
        generate,
        undo,
        clear,
        generateAlerts,
        dismissGenerateAlerts,
        generateProgress,
    } =
        useScheduleActions();
    const { data: userSettings } = useGetUserSettingsQuery();
    const timeZone = resolveIanaTimeZone(userSettings?.timeZone);
    const { openCreate, openCreateFromPrefill, openEdit, createFromPayload, editorModal } = useEventEditor();
    const { data: tasks = [] } = useGetTasksQuery();
    const { data: habitsData } = useGetHabitsQuery();
    const voice = useVoiceTask({
        onComplete: createFromPayload,
        onSufficient: openCreateFromPrefill,
    });
    useEffect(() => {
        try {
            sessionStorage.setItem(CALENDAR_VIEW_KEY, currentView);
        } catch {
            /* private mode */
        }
    }, [currentView]);
    const gridView: CalendarView = phone && currentView === 'week' ? 'day' : currentView;
    const busy = isGenerating || isClearing || isUndoing || previewLoading || previewOpen;
    const habitEventIds = new Set(
        (habitsData?.habits ?? [])
            .map((habit) => habit.googleEventId)
            .filter((id): id is string => !!id),
    );
    const displayEvents = visibleGoogleEvents(getEventsQuery.data?.events || []).filter(
        (event) => !isHabitGoogleEvent(habitEventIds, event),
    );

    const handleDeleteEvent = (eventId: string, eventName: string) => {
        const event = displayEvents.find((item) => item.id === eventId);
        setDeleteConfirmDialog({
            open: true,
            eventId,
            calendarId: event?.calendarId,
            eventName,
        });
    };

    const confirmDeleteEvent = () => {
        if (!deleteConfirmDialog.eventId) return;
        const eventId = deleteConfirmDialog.eventId;
        const calendarId = deleteConfirmDialog.calendarId;
        const eventName = deleteConfirmDialog.eventName;
        setDeleteConfirmDialog({ open: false, eventId: null, eventName: '' });
        void deleteEventTrigger({ eventId, calendarId })
            .unwrap()
            .then(() => {
                showSuccessToast({
                    title: 'Event deleted',
                    detail: eventName || undefined,
                });
            })
            .catch((err) => {
                showErrorToast({
                    title: 'Could not delete event',
                    detail: extractApiErrorMessage(err),
                });
            });
    };

    const cancelDeleteEvent = () => {
        setDeleteConfirmDialog({ open: false, eventId: null, eventName: '' });
    };

    const handleEditEvent = (eventId: string) => {
        const event = displayEvents.find((e: EventType) => e.id === eventId);
        if (!event) return;
        const linkedTask = findTaskForGoogleEvent(tasks, event);
        if (linkedTask) {
            const start = eventStartDate(event);
            openEdit(
                linkedTask,
                start
                    ? {
                          startIso: start.toISOString(),
                          endIso: eventEndDate(event)?.toISOString(),
                          googleEventId: event.id,
                          calendarId: event.calendarId,
                      }
                    : undefined,
            );
            return;
        }
        setEventFormDialog({ open: true, event });
    };

    const handleEventFormSubmit = (data: any) => {
        const event = eventFormDialog.event;
        setEventFormDialog({ open: false, event: null });
        if (!event) return;
        void updateEventTrigger({
            eventId: event.id,
            eventData: data,
            calendarId: event.calendarId,
        })
            .unwrap()
            .then(() => {
                showSuccessToast({
                    title: 'Event updated',
                    detail: joinToastDetail(
                        data.summary,
                        formatDateTimeRange(data.start?.dateTime, data.end?.dateTime),
                    ),
                });
            })
            .catch((err) => {
                showErrorToast({
                    title: 'Could not update event',
                    detail: extractApiErrorMessage(err),
                });
            });
    };

    const closeEventForm = () => {
        setEventFormDialog({ open: false, event: null });
    };

    const handleEventTimeChange = async (
        event: GoogleCalendarEvent,
        start: Date,
        end: Date,
    ) => {
        const originalStart = eventStartDate(event);
        const originalEnd = eventEndDate(event);
        if (!originalStart || !originalEnd) {
            throw new Error('Event has no time range');
        }
        try {
            await ScheduleApi.moveDisplayedEvent({
                googleEventId: event.id,
                calendarId: event.calendarId,
                recurringEventId: event.recurringEventId,
                originalStart: originalStart.toISOString(),
                originalEnd: originalEnd.toISOString(),
                start: start.toISOString(),
                end: end.toISOString(),
            });
            dispatch(eventsApi.util.invalidateTags([{ type: 'Event', id: 'LIST' }]));
            dispatch(eventTasksApi.util.invalidateTags([{ type: 'EventTask', id: 'LIST' }]));
            showSuccessToast({
                title: 'Event moved',
                detail: formatDateTimeRange(start.toISOString(), end.toISOString()),
            });
        } catch (err) {
            showErrorToast({
                title: 'Could not move event',
                detail: extractApiErrorMessage(err),
            });
            throw err;
        }
    };

    const handleCreateForDate = (day: Date) => {
        const { start, end } = civilDayStartEndIso(ymdFromLocalDate(day), timeZone);
        openCreate({
            earliestStartTime: start,
            deadline: end,
        });
    };

    const closePreview = () => {
        if (isGenerating) return;
        previewRequest.current += 1;
        setPreviewOpen(false);
        setPreviewLoading(false);
        setPreviewError(null);
        setPreviewResult(null);
    };

    const runGenerate = () => {
        const requestId = ++previewRequest.current;
        setPreviewOpen(true);
        setPreviewLoading(true);
        setPreviewError(null);
        setPreviewResult(null);
        void ScheduleApi.previewSchedule()
            .then((result) => {
                if (previewRequest.current !== requestId) return;
                setPreviewResult(result);
            })
            .catch((err) => {
                if (previewRequest.current !== requestId) return;
                setPreviewError(extractApiErrorMessage(err));
            })
            .finally(() => {
                if (previewRequest.current !== requestId) return;
                setPreviewLoading(false);
            });
    };

    const applyGenerate = () => {
        const { startDate, endDate } = visibleRangeYmd(currentView, currentDate);
        setPreviewOpen(false);
        setPreviewResult(null);
        void generate(startDate, endDate);
    };

    const confirmClear = async () => {
        setClearConfirmOpen(false);
        await clear();
    };

    const confirmUndo = async () => {
        setUndoConfirmOpen(false);
        await undo();
    };

    return (
        <div className="page-shell-fill max-md:px-3 max-md:py-2">
            <header className="mb-4 shrink-0 space-y-4 max-md:mb-1 max-md:space-y-1">
                {phone ? (
                    <>
                        <h1 className="sr-only">Calendar</h1>
                        <div className="flex min-w-0 items-center gap-0.5">
                            <button
                                type="button"
                                className={phoneIcon}
                                onClick={() => setCurrentDate((prev) => shiftPeriod(prev, currentView, -1))}
                                aria-label={`Previous ${currentView}`}
                            >
                                <ChevronLeft className="h-4 w-4" aria-hidden />
                            </button>
                            <div className="min-w-0 flex-1">
                                <CalendarDatePicker
                                    compact
                                    value={currentDate}
                                    label={periodLabel(currentDate, currentView)}
                                    caption={compactPeriodLabel(currentDate, currentView)}
                                    onChange={setCurrentDate}
                                />
                            </div>
                            <button
                                type="button"
                                className={phoneIcon}
                                onClick={() => setCurrentDate((prev) => shiftPeriod(prev, currentView, 1))}
                                aria-label={`Next ${currentView}`}
                            >
                                <ChevronRight className="h-4 w-4" aria-hidden />
                            </button>
                            <button
                                type="button"
                                className="h-7 shrink-0 rounded-md px-1.5 text-xs font-medium text-ide-muted hover:bg-white/5"
                                onClick={() => setCurrentDate(new Date())}
                            >
                                Today
                            </button>
                        </div>
                        <div className="flex items-center gap-0.5">
                            <div className="inline-flex rounded-md border border-ide-border bg-ide-surface p-0.5">
                                {PHONE_VIEWS.map(({ id, label, Icon }) => (
                                    <button
                                        key={id}
                                        type="button"
                                        onClick={() => setCurrentView(id)}
                                        className={phoneToggle(currentView === id)}
                                        aria-pressed={currentView === id}
                                        aria-label={label}
                                    >
                                        <Icon className="h-3.5 w-3.5" aria-hidden />
                                    </button>
                                ))}
                            </div>
                            <button type="button" className={`${phoneIcon} ml-auto`} onClick={() => setEventsOpen(true)}>
                                <List className="h-4 w-4" aria-hidden />
                                <span className="sr-only">Events</span>
                            </button>
                            <CalendarVisibilityMenu compact />
                        </div>
                    </>
                ) : (
                    <>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <h1 className="page-title">Calendar</h1>
                        <p className="page-lead">{periodLabel(currentDate, currentView)}</p>
                    </div>
                    <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:flex-nowrap sm:justify-end">
                        <button
                            type="button"
                            onClick={() => openCreate()}
                            className="ui-btn-primary min-w-[9rem] flex-1 sm:w-auto sm:flex-none"
                        >
                            Create task
                        </button>
                        <VoiceTaskButton onClick={voice.open} />
                        <ScheduleMenu
                            busy={busy}
                            isGenerating={isGenerating}
                            isClearing={isClearing}
                            isUndoing={isUndoing}
                            canUndo={canUndo}
                            onGenerate={runGenerate}
                            onSuggest={() => setSuggestionsOpen(true)}
                            onUndo={() => setUndoConfirmOpen(true)}
                            onClear={() => setClearConfirmOpen(true)}
                        />
                    </div>
                </div>
                    </>
                )}
                <NowStrip />
                {generateProgress ? <GenerateProgressPanel progress={generateProgress} /> : null}
                {generateAlerts ? (
                    <GenerateAlertsBanner
                        alerts={generateAlerts}
                        onDismiss={dismissGenerateAlerts}
                    />
                ) : null}
                {phone ? null : (
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
                        <CalendarVisibilityMenu />
                    </div>
                </div>
                )}
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
                <div className="flex flex-col gap-4 max-md:min-h-0 max-md:flex-1 max-md:overflow-hidden lg:min-h-0 lg:flex-1 lg:overflow-y-auto xl:flex-row xl:overflow-hidden">
                    <div className="flex w-full min-w-0 flex-col max-md:min-h-0 max-md:flex-1 xl:min-h-0 xl:flex-1 xl:overflow-hidden">
                        {phone && currentView === 'week' ? (
                            <PhoneWeekStrip date={currentDate} onSelect={setCurrentDate} />
                        ) : null}
                        <CalendarGrid
                            view={gridView}
                            date={currentDate}
                            events={displayEvents}
                            onEditEvent={handleEditEvent}
                            onCreateForDate={handleCreateForDate}
                            onEventTimeChange={coarse ? undefined : handleEventTimeChange}
                            phoneMonth={phone && currentView === 'month'}
                            onPickDay={(day) => {
                                setCurrentDate(day);
                                setCurrentView('day');
                            }}
                        />
                    </div>
                    <div className="hidden h-80 w-full shrink-0 flex-col overflow-hidden md:flex lg:h-[min(18rem,38vh)] xl:h-auto xl:min-h-0 xl:w-[24rem]">
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

            {phone ? (
                <div className="mt-1 flex shrink-0 items-center gap-2 border-t border-ide-border pt-2 md:hidden">
                    <button
                        type="button"
                        className="inline-flex h-9 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg bg-ide-accentBlue px-3 text-sm font-medium text-white"
                        aria-label="Create task"
                        onClick={() => openCreate()}
                    >
                        <Plus className="h-4 w-4 shrink-0" aria-hidden />
                        Create
                    </button>
                    <button
                        type="button"
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-ide-border bg-ide-surface text-ide-text"
                        aria-label="Add task by voice"
                        onClick={() => voice.open()}
                    >
                        <Mic className="h-4 w-4" aria-hidden />
                    </button>
                    <button
                        type="button"
                        className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-ide-border bg-ide-surface px-3 text-sm font-medium text-ide-text disabled:opacity-50"
                        aria-label="Generate schedule"
                        disabled={busy}
                        onClick={runGenerate}
                    >
                        {isGenerating ? '…' : 'Generate'}
                    </button>
                    <button
                        type="button"
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ide-muted hover:bg-white/5"
                        aria-label="More schedule actions"
                        onClick={() => setActionsOpen(true)}
                    >
                        <MoreHorizontal className="h-4 w-4" aria-hidden />
                    </button>
                </div>
            ) : null}

            <EventForm
                open={eventFormDialog.open}
                onClose={closeEventForm}
                onSubmit={handleEventFormSubmit}
                event={eventFormDialog.event}
                isSubmitting={false}
                error={undefined}
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
                            className="ui-btn-secondary w-full sm:w-auto"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={confirmDeleteEvent}
                            className="ui-btn-danger w-full sm:w-auto"
                        >
                            Delete
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

            <ScheduleSuggestionsDialog
                open={suggestionsOpen}
                onClose={() => setSuggestionsOpen(false)}
            />

            <GeneratePreviewDialog
                open={previewOpen}
                loading={previewLoading}
                error={previewError}
                result={previewResult}
                onCancel={closePreview}
                onApply={applyGenerate}
            />

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
                    Clear upcoming app-generated schedule blocks in the planning horizon?
                    Already finished blocks stay in the calendar. This cannot be undone.
                </p>
            </Modal>

            <Modal
                open={undoConfirmOpen}
                onClose={() => setUndoConfirmOpen(false)}
                title="Undo last generate"
                footer={
                    <>
                        <button
                            type="button"
                            onClick={() => setUndoConfirmOpen(false)}
                            disabled={isUndoing}
                            className="ui-btn-secondary w-full sm:w-auto"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={() => void confirmUndo()}
                            disabled={isUndoing}
                            className="ui-btn-primary w-full sm:w-auto"
                        >
                            {isUndoing ? 'Undoing…' : 'Undo generate'}
                        </button>
                    </>
                }
            >
                <p className="text-ide-text">
                    Restore upcoming app-generated blocks from before the last Generate?
                    Already finished blocks stay. This only undoes Generate, not Clear.
                </p>
            </Modal>

            {editorModal}
            <VoiceTaskSheet voice={voice} />

            <Modal
                open={phone && actionsOpen}
                onClose={() => setActionsOpen(false)}
                title="Schedule"
            >
                <div className="flex flex-col">
                    <button
                        type="button"
                        className="ui-menu-row"
                        disabled={busy}
                        onClick={() => {
                            setActionsOpen(false);
                            setSuggestionsOpen(true);
                        }}
                    >
                        Suggestions
                    </button>
                    <button
                        type="button"
                        className="ui-menu-row"
                        disabled={busy || !canUndo}
                        onClick={() => {
                            setActionsOpen(false);
                            setUndoConfirmOpen(true);
                        }}
                    >
                        {isUndoing ? 'Undoing…' : 'Undo last generate'}
                    </button>
                    <button
                        type="button"
                        className="ui-menu-row text-ide-error"
                        disabled={busy}
                        onClick={() => {
                            setActionsOpen(false);
                            setClearConfirmOpen(true);
                        }}
                    >
                        {isClearing ? 'Clearing…' : 'Clear schedule'}
                    </button>
                </div>
            </Modal>

            <Modal
                open={phone && eventsOpen}
                onClose={() => setEventsOpen(false)}
                title="Events"
                maxWidthClass="max-w-lg"
            >
                <div className="max-h-[60dvh]">
                    <CalendarEvents
                        events={displayEvents}
                        isLoading={getEventsQuery.isLoading}
                        error={getEventsQuery.error}
                        title={`${currentView.charAt(0).toUpperCase() + currentView.slice(1)} events`}
                        onEditEvent={(eventId) => {
                            setEventsOpen(false);
                            handleEditEvent(eventId);
                        }}
                        onDeleteEvent={(eventId, eventName) => {
                            setEventsOpen(false);
                            handleDeleteEvent(eventId, eventName);
                        }}
                    />
                </div>
            </Modal>
        </div>
    );
};

export default CalendarPage;
