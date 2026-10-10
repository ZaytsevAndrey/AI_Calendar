import React, { useEffect, useState } from 'react';
import { useDispatch, useStore } from 'react-redux';
import { useTranslation } from 'react-i18next';
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
import { ScheduleApi } from 'api/schedule.api';
import { useScheduleActions } from 'modules/schedule/hooks/useScheduleActions';
import { ProblematicInboxBanner } from 'modules/schedule/components/ProblematicInboxBanner';
import { ProblematicInboxSheet } from 'modules/schedule/components/ProblematicInboxSheet';
import { ScheduleMenu } from 'modules/schedule/components/ScheduleMenu';
import { ScheduleSuggestionsDialog } from 'modules/schedule/components/ScheduleSuggestionsDialog';
import { SeriesDragHost } from 'modules/schedule/components/SeriesDragHost';
import { SeriesDeleteHost } from 'modules/schedule/components/SeriesDeleteHost';
import {
    askSeriesDeleteScope,
    SeriesMoveCancelled,
    type SeriesDragScope,
} from 'modules/schedule/seriesDragChoice';
import { isActiveProblematicTask, todayYmdInZone } from 'modules/schedule/problematicDays';
import { NowStrip } from 'modules/now/components/NowStrip';
import { resolveIanaTimeZone } from 'modules/user-settings/ianaTimeZones';
import { useEventEditor } from 'modules/events/hooks/useEventEditor';
import {
    isCompletedCalendarEvent,
    overlayCompletedTaskEvents,
    resolveTaskForCalendarEvent,
} from 'modules/calendar/completedTaskEvents';
import {
    eventTasksApi,
    useDeleteEventMutation as useDeleteTaskMutation,
    useEndSeriesFromMutation,
    useGetEventsQuery as useGetTasksQuery,
    useSkipOccurrenceMutation,
} from 'api/eventTasksApi';
import { eventsApi } from 'api/eventsApi';
import { useGetHabitsQuery } from 'api/habitsApi';
import { isHabitGoogleEvent } from 'modules/habits/habitBlocks';
import { VoiceTaskButton } from 'modules/voice/components/VoiceTaskButton';
import { VoiceTaskSheet } from 'modules/voice/components/VoiceTaskSheet';
import { useVoiceTask } from 'modules/voice/hooks/useVoiceTask';
import { setConflictVoiceOpener } from 'modules/schedule/conflictChoiceBus';
import { settleReplanJob } from 'modules/schedule/settleReplanJob';
import {
    startTaskMutationProgress,
    type TaskMutationProgressHandle,
} from 'modules/schedule/taskMutationProgress';
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
    eventStartDate,
    eventEndDate,
    eventsVisibleInView,
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
    { id: 'day' as const, labelKey: 'calendar.day', Icon: Calendar },
    { id: 'week' as const, labelKey: 'calendar.week', Icon: Columns3 },
    { id: 'month' as const, labelKey: 'calendar.month', Icon: CalendarDays },
];

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
    const { t } = useTranslation();
    const dispatch = useDispatch();
    const store = useStore();
    const phone = usePhoneLayout();
    const coarse = useCoarsePointer();
    const [currentView, setCurrentView] = useState<CalendarView>(defaultCalendarView);
    const [currentDate, setCurrentDate] = useState(new Date());
    const [actionsOpen, setActionsOpen] = useState(false);
    const [eventsOpen, setEventsOpen] = useState(false);
    const [deleteConfirmDialog, setDeleteConfirmDialog] = useState<{
        open: boolean;
        mode: 'google' | 'task';
        eventId: string | null;
        taskId: string | null;
        calendarId?: string;
        eventName: string;
    }>({
        open: false,
        mode: 'google',
        eventId: null,
        taskId: null,
        eventName: '',
    });
    const [suggestionsOpen, setSuggestionsOpen] = useState(false);
    const [problematicOpen, setProblematicOpen] = useState(false);
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
    const [deleteTaskTrigger] = useDeleteTaskMutation();
    const [skipOccurrenceTrigger] = useSkipOccurrenceMutation();
    const [endSeriesFromTrigger] = useEndSeriesFromMutation();
    const { parkDayHints } = useScheduleActions();
    const { data: userSettings } = useGetUserSettingsQuery();
    const timeZone = resolveIanaTimeZone(userSettings?.timeZone);
    const { openCreate, openCreateFromPrefill, openEdit, createFromPayload, editorModal } = useEventEditor();
    const { data: tasks = [] } = useGetTasksQuery();
    const todayYmd = todayYmdInZone(timeZone);
    const problematicTasks = tasks.filter((task) =>
        isActiveProblematicTask(task, todayYmd, parkDayHints[task.id]),
    );
    const { data: habitsData } = useGetHabitsQuery();
    const voice = useVoiceTask({
        onComplete: createFromPayload,
        onSufficient: openCreateFromPrefill,
    });
    useEffect(() => {
        setConflictVoiceOpener(() => voice.open());
        return () => setConflictVoiceOpener(null);
    }, [voice.open]);
    useEffect(() => {
        try {
            sessionStorage.setItem(CALENDAR_VIEW_KEY, currentView);
        } catch {
            /* private mode */
        }
    }, [currentView]);
    const gridView: CalendarView = phone && currentView === 'week' ? 'day' : currentView;
    const habitEventIds = new Set(
        (habitsData?.habits ?? [])
            .map((habit) => habit.googleEventId)
            .filter((id): id is string => !!id),
    );
    const sleepWindow = {
        sleepTime: userSettings?.sleepTime,
        wakeTime: userSettings?.wakeTime,
    };
    const displayEvents = overlayCompletedTaskEvents(
        visibleGoogleEvents(getEventsQuery.data?.events || []).filter(
            (event) => {
                if (isHabitGoogleEvent(habitEventIds, event)) return false;
                const linked = resolveTaskForCalendarEvent(tasks, event);
                if (linked?.isUnscheduled && linked.status === 'completed') return false;
                if (linked?.isUnscheduled && linked.status === 'canceled') return false;
                return true;
            },
        ),
        tasks,
    );
    // Overlay keeps every completed seat for the grid; the side list is period-scoped.
    const listEvents = eventsVisibleInView(
        currentView,
        currentDate,
        displayEvents,
        sleepWindow,
    );

    const occurrenceStartIso = (event: GoogleCalendarEvent): string | null => {
        if (event.start.dateTime) return event.start.dateTime;
        if (event.start.date) {
            return civilDayStartEndIso(event.start.date, timeZone).start;
        }
        return null;
    };

    const handleDeleteCalendarEvent = async (event: GoogleCalendarEvent) => {
        const linked = resolveTaskForCalendarEvent(tasks, event);
        const name = event.summary || t('calendar.event');
        if (!linked) {
            setDeleteConfirmDialog({
                open: true,
                mode: 'google',
                eventId: event.id,
                taskId: null,
                calendarId: event.calendarId,
                eventName: name,
            });
            return;
        }
        if (linked.isRecurring || event.recurringEventId) {
            const scope = await askSeriesDeleteScope(linked.name);
            if (!scope) return;
            const occurrenceStart = occurrenceStartIso(event);
            if (!occurrenceStart && scope !== 'all') {
                showErrorToast({ title: t('calendar.taskDeleteFailed') });
                return;
            }
            try {
                if (scope === 'occurrence') {
                    // Progress toast from eventTasksApi.skipOccurrence.
                    await skipOccurrenceTrigger({
                        id: linked.id,
                        body: {
                            occurrenceStart: occurrenceStart!,
                            googleEventId: event.id.startsWith('local-completed:')
                                ? undefined
                                : event.id,
                            googleEventCalendarId: event.calendarId,
                        },
                    }).unwrap();
                    return;
                }
                if (scope === 'series') {
                    // Progress toast from eventTasksApi.endSeriesFrom.
                    await endSeriesFromTrigger({
                        id: linked.id,
                        body: {
                            occurrenceStart: occurrenceStart!,
                            googleEventId: event.id.startsWith('local-completed:')
                                ? undefined
                                : event.id,
                            googleEventCalendarId: event.calendarId,
                        },
                    }).unwrap();
                    return;
                }
                // Progress toast from eventTasksApi.deleteEvent.
                await deleteTaskTrigger(linked.id).unwrap();
            } catch (err) {
                showErrorToast({
                    title: t('calendar.taskDeleteFailed'),
                    detail: extractApiErrorMessage(err),
                });
            }
            return;
        }
        setDeleteConfirmDialog({
            open: true,
            mode: 'task',
            eventId: event.id,
            taskId: linked.id,
            calendarId: event.calendarId,
            eventName: name,
        });
    };

    const handleDeleteEvent = (eventId: string, eventName: string) => {
        const event = displayEvents.find((item) => item.id === eventId);
        if (event) {
            void handleDeleteCalendarEvent(event);
            return;
        }
        setDeleteConfirmDialog({
            open: true,
            mode: 'google',
            eventId,
            taskId: null,
            eventName,
        });
    };

    const confirmDeleteEvent = () => {
        const { mode, eventId, taskId, calendarId, eventName } = deleteConfirmDialog;
        setDeleteConfirmDialog({
            open: false,
            mode: 'google',
            eventId: null,
            taskId: null,
            eventName: '',
        });
        if (mode === 'task' && taskId) {
            // Progress toast from eventTasksApi.deleteEvent.
            void deleteTaskTrigger(taskId)
                .unwrap()
                .catch((err) => {
                    showErrorToast({
                        title: t('calendar.taskDeleteFailed'),
                        detail: extractApiErrorMessage(err),
                    });
                });
            return;
        }
        if (!eventId) return;
        void deleteEventTrigger({ eventId, calendarId })
            .unwrap()
            .then(() => {
                showSuccessToast({
                    title: t('calendar.eventDeleted'),
                    detail: eventName || undefined,
                });
            })
            .catch((err) => {
                showErrorToast({
                    title: t('calendar.eventDeleteFailed'),
                    detail: extractApiErrorMessage(err),
                });
            });
    };

    const cancelDeleteEvent = () => {
        setDeleteConfirmDialog({
            open: false,
            mode: 'google',
            eventId: null,
            taskId: null,
            eventName: '',
        });
    };

    const handleEditEvent = (eventId: string) => {
        const event = displayEvents.find((e: EventType) => e.id === eventId);
        if (!event) return;
        const linkedTask = resolveTaskForCalendarEvent(tasks, event);
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
                    title: t('calendar.eventUpdated'),
                    detail: joinToastDetail(
                        data.summary,
                        formatDateTimeRange(data.start?.dateTime, data.end?.dateTime),
                    ),
                });
            })
            .catch((err) => {
                showErrorToast({
                    title: t('calendar.eventUpdateFailed'),
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
        const startIso = start.toISOString();
        const endIso = end.toISOString();
        const deltaMs = start.getTime() - originalStart.getTime();
        const durationMs = Math.max(60_000, end.getTime() - start.getTime());
        const seriesKey = event.recurringEventId || event.id;
        type UndoPatch = { undo: () => void };
        const undoPatches: UndoPatch[] = [];

        const applyOptimistic = (scope: SeriesDragScope | 'single') => {
            const cachedArgs = eventsApi.util.selectCachedArgsForQuery(
                store.getState() as never,
                'getEvents',
            );
            const patches = cachedArgs.map((args) =>
                dispatch(
                    eventsApi.util.updateQueryData('getEvents', args, (draft) => {
                        if (!Array.isArray(draft?.events)) return;
                        for (const row of draft.events) {
                            const rowStart = eventStartDate(row);
                            if (!rowStart) continue;
                            const sameSeries =
                                row.id === event.id ||
                                (!!seriesKey &&
                                    (row.id === seriesKey ||
                                        row.recurringEventId === seriesKey));
                            if (scope === 'single' || scope === 'occurrence') {
                                if (row.id !== event.id) continue;
                            } else if (!sameSeries) {
                                continue;
                            } else if (
                                scope === 'series' &&
                                rowStart.getTime() < originalStart.getTime()
                            ) {
                                continue;
                            }
                            const nextStart = new Date(
                                row.id === event.id
                                    ? start.getTime()
                                    : rowStart.getTime() + deltaMs,
                            );
                            const nextEnd = new Date(nextStart.getTime() + durationMs);
                            row.start = {
                                ...row.start,
                                dateTime: nextStart.toISOString(),
                                date: undefined,
                            };
                            row.end = {
                                ...row.end,
                                dateTime: nextEnd.toISOString(),
                                date: undefined,
                            };
                        }
                    }) as never,
                ) as unknown as UndoPatch,
            );
            undoPatches.push(...patches);
        };

        // Immediate feedback on the dragged block; expand after series scope is chosen.
        applyOptimistic('occurrence');
        const linkedTask = resolveTaskForCalendarEvent(tasks, event);
        const relatedKeys = [
            event.id,
            event.recurringEventId,
            linkedTask?.id,
        ].filter(Boolean) as string[];
        const mutationRef: { current: TaskMutationProgressHandle | null } = {
            current: null,
        };
        const ensureProgress = (): TaskMutationProgressHandle => {
            if (!mutationRef.current) {
                mutationRef.current = startTaskMutationProgress({
                    taskKey: event.id,
                    title: event.summary || linkedTask?.name || t('calendar.eventMoved'),
                    relatedKeys,
                });
            }
            return mutationRef.current;
        };
        try {
            const moved = await ScheduleApi.moveDisplayedEvent(
                {
                    googleEventId: event.id,
                    calendarId: event.calendarId,
                    recurringEventId: event.recurringEventId,
                    originalStart: originalStart.toISOString(),
                    originalEnd: originalEnd.toISOString(),
                    start: startIso,
                    end: endIso,
                },
                {
                    onSeriesScopeChosen: (scope) => {
                        if (scope === 'occurrence') return;
                        applyOptimistic(scope);
                    },
                    // Toast only when a real write starts — not during the series-choice probe/modal.
                    onMutationStart: () => {
                        ensureProgress();
                    },
                },
            );
            const active = ensureProgress();
            const { recurringMoved } = await settleReplanJob(moved.jobId, (stage) => {
                active.setStage(stage);
            });
            dispatch(eventTasksApi.util.invalidateTags([{ type: 'EventTask', id: 'LIST' }]));
            dispatch(eventsApi.util.invalidateTags([{ type: 'Event', id: 'LIST' }]));
            active.finish(formatDateTimeRange(startIso, endIso) ?? undefined);
            if (recurringMoved.length && !event.recurringEventId) {
                showSuccessToast({
                    title: t('calendar.recurringRescheduled'),
                    detail: recurringMoved.slice(0, 3).join(', '),
                });
            }
        } catch (err) {
            undoPatches.forEach((patch) => patch.undo());
            if (err instanceof SeriesMoveCancelled) {
                mutationRef.current?.dismiss();
                throw err;
            }
            if (mutationRef.current) {
                mutationRef.current.fail(
                    extractApiErrorMessage(err) || t('calendar.eventMoveFailed'),
                );
            } else {
                showErrorToast({
                    title: t('calendar.eventMoveFailed'),
                    detail: extractApiErrorMessage(err),
                });
            }
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

    return (
        <div className="page-shell-fill max-md:px-3 max-md:py-2">
            <header className="mb-4 shrink-0 space-y-4 max-md:mb-1 max-md:space-y-1">
                {phone ? (
                    <>
                        <h1 className="sr-only">{t('nav.calendar')}</h1>
                        <div className="flex min-w-0 items-center gap-0.5">
                            <button
                                type="button"
                                className={phoneIcon}
                                onClick={() => setCurrentDate((prev) => shiftPeriod(prev, currentView, -1))}
                                aria-label={t('common.previous', { view: t(`calendar.${currentView}`) })}
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
                                aria-label={t('common.next', { view: t(`calendar.${currentView}`) })}
                            >
                                <ChevronRight className="h-4 w-4" aria-hidden />
                            </button>
                            <button
                                type="button"
                                className="h-7 shrink-0 rounded-md px-1.5 text-xs font-medium text-ide-muted hover:bg-white/5"
                                onClick={() => setCurrentDate(new Date())}
                            >
                                {t('common.today')}
                            </button>
                        </div>
                        <div className="flex items-center gap-0.5">
                            <div className="inline-flex rounded-md border border-ide-border bg-ide-surface p-0.5">
                                {PHONE_VIEWS.map(({ id, labelKey, Icon }) => (
                                    <button
                                        key={id}
                                        type="button"
                                        onClick={() => setCurrentView(id)}
                                        className={phoneToggle(currentView === id)}
                                        aria-pressed={currentView === id}
                                        aria-label={t(labelKey)}
                                    >
                                        <Icon className="h-3.5 w-3.5" aria-hidden />
                                    </button>
                                ))}
                            </div>
                            <button type="button" className={`${phoneIcon} ml-auto`} onClick={() => setEventsOpen(true)}>
                                <List className="h-4 w-4" aria-hidden />
                                <span className="sr-only">{t('common.events')}</span>
                            </button>
                            <CalendarVisibilityMenu compact />
                        </div>
                    </>
                ) : (
                    <>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <h1 className="page-title">{t('nav.calendar')}</h1>
                        <p className="page-lead">{periodLabel(currentDate, currentView)}</p>
                    </div>
                    <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:flex-nowrap sm:justify-end">
                        <button
                            type="button"
                            onClick={() => openCreate()}
                            className="ui-btn-primary min-w-[9rem] flex-1 sm:w-auto sm:flex-none"
                        >
                            {t('calendar.createTask')}
                        </button>
                        <VoiceTaskButton onClick={voice.open} />
                        <ScheduleMenu
                            busy={false}
                            onSuggest={() => setSuggestionsOpen(true)}
                        />
                    </div>
                </div>
                    </>
                )}
                <NowStrip />
                {problematicTasks.length > 0 ? (
                    <ProblematicInboxBanner
                        count={problematicTasks.length}
                        onOpen={() => setProblematicOpen(true)}
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
                                {t(`calendar.${v}`)}
                            </button>
                        ))}
                    </div>

                    <div className="flex flex-wrap items-center justify-center gap-1 sm:justify-end">
                        <button
                            type="button"
                            className="ui-btn-ghost min-h-[44px] min-w-[44px] px-0"
                            onClick={() => setCurrentDate((prev) => shiftPeriod(prev, currentView, -1))}
                            aria-label={t('common.previous', { view: t(`calendar.${currentView}`) })}
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
                            aria-label={t('common.next', { view: t(`calendar.${currentView}`) })}
                        >
                            <ChevronRight className="mx-auto h-5 w-5" aria-hidden />
                        </button>
                        <button type="button" className="ui-btn-secondary px-4" onClick={() => setCurrentDate(new Date())}>
                            {t('common.today')}
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
                    {t('calendar.loadFailed')}
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
                            onDeleteEvent={(event) => void handleDeleteCalendarEvent(event)}
                            isEventCompleted={(event) => isCompletedCalendarEvent(event, tasks)}
                            phoneMonth={phone && currentView === 'month'}
                            onPickDay={(day) => {
                                setCurrentDate(day);
                                setCurrentView('day');
                            }}
                        />
                    </div>
                    <div className="hidden h-80 w-full shrink-0 flex-col overflow-hidden md:flex lg:h-[min(18rem,38vh)] xl:h-auto xl:min-h-0 xl:w-[24rem]">
                        <CalendarEvents
                            events={listEvents}
                            isLoading={getEventsQuery.isLoading}
                            error={getEventsQuery.error}
                            title={t('calendar.viewEvents', { view: t(`calendar.${currentView}`) })}
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
                        aria-label={t('calendar.createTask')}
                        onClick={() => openCreate()}
                    >
                        <Plus className="h-4 w-4 shrink-0" aria-hidden />
                        {t('common.create')}
                    </button>
                    <button
                        type="button"
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-ide-border bg-ide-surface text-ide-text"
                        aria-label={t('calendar.addByVoice')}
                        onClick={() => voice.open()}
                    >
                        <Mic className="h-4 w-4" aria-hidden />
                    </button>
                    <button
                        type="button"
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ide-muted hover:bg-white/5"
                        aria-label={t('calendar.moreSchedule')}
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
                title={t('calendar.deleteEventTitle')}
                footer={
                    <>
                        <button
                            type="button"
                            onClick={cancelDeleteEvent}
                            className="ui-btn-secondary w-full sm:w-auto"
                        >
                            {t('common.cancel')}
                        </button>
                        <button
                            type="button"
                            onClick={confirmDeleteEvent}
                            className="ui-btn-danger w-full sm:w-auto"
                        >
                            {t('common.delete')}
                        </button>
                    </>
                }
            >
                <p className="mb-3 text-ide-text">
                    {t(
                        deleteConfirmDialog.mode === 'task'
                            ? 'calendar.deleteTaskConfirm'
                            : 'calendar.deleteEventConfirm',
                        { name: deleteConfirmDialog.eventName },
                    )}
                </p>
                <p className="text-sm text-ide-muted">
                    {t(
                        deleteConfirmDialog.mode === 'task'
                            ? 'calendar.deleteTaskHint'
                            : 'calendar.deleteEventHint',
                    )}
                </p>
            </Modal>

            <ScheduleSuggestionsDialog
                open={suggestionsOpen}
                onClose={() => setSuggestionsOpen(false)}
            />

            {editorModal}
            <ProblematicInboxSheet
                open={problematicOpen}
                tasks={problematicTasks}
                timeZone={timeZone}
                dayHints={parkDayHints}
                onClose={() => setProblematicOpen(false)}
                onEdit={(task) => openEdit(task)}
            />
            <VoiceTaskSheet voice={voice} />
            <SeriesDragHost />
            <SeriesDeleteHost />

            <Modal
                open={phone && actionsOpen}
                onClose={() => setActionsOpen(false)}
                title={t('schedule.menu')}
            >
                <div className="flex flex-col">
                    <button
                        type="button"
                        className="ui-menu-row"
                        onClick={() => {
                            setActionsOpen(false);
                            setSuggestionsOpen(true);
                        }}
                    >
                        {t('schedule.suggestions')}
                    </button>
                </div>
            </Modal>

            <Modal
                open={phone && eventsOpen}
                onClose={() => setEventsOpen(false)}
                title={t('common.events')}
                maxWidthClass="max-w-lg"
            >
                <div className="max-h-[60dvh]">
                    <CalendarEvents
                        events={listEvents}
                        isLoading={getEventsQuery.isLoading}
                        error={getEventsQuery.error}
                        title={t('calendar.viewEvents', { view: t(`calendar.${currentView}`) })}
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
