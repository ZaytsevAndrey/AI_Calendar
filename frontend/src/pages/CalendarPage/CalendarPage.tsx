import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { useDispatch, useStore } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { CalendarCheck, ChevronLeft, ChevronRight, PanelRight, Plus, Trash2, X } from 'lucide-react';
import {
    useEventsForDay,
    useEventsForWeek,
    useEventsForMonth,
    useEventsForThreeDays,
    useUpdateEvent,
    useDeleteEvent,
    visibleGoogleEvents,
} from 'modules/calendar/hooks/useCalendar';
import EventForm from 'modules/calendar/components/EventForm';
import { EventPreview } from 'modules/calendar/components/EventPreview';
import { GoogleCalendarEvent } from 'api/google-calendar.api';
import { useGetUserSettingsQuery } from 'api/userSettingsApi';
import CalendarGrid from 'modules/calendar/components/CalendarGrid';
import { CalendarDatePicker } from 'modules/calendar/components/CalendarDatePicker';
import { CalendarVisibilityMenu } from 'modules/calendar/components/CalendarVisibilityMenu';
import { EventType } from 'modules/calendar/types';
import { ScheduleApi } from 'api/schedule.api';
import { useScheduleActions } from 'modules/schedule/hooks/useScheduleActions';
import { ProblematicInboxSheet } from 'modules/schedule/components/ProblematicInboxSheet';
import { SeriesDragHost } from 'modules/schedule/components/SeriesDragHost';
import { MoveOccurrenceSheet } from 'modules/schedule/components/MoveOccurrenceSheet';
import type { TaskDTO } from 'api/tasks.api';
import {
    askSeriesDeleteScope,
    SeriesMoveCancelled,
    type SeriesDragScope,
} from 'modules/schedule/seriesDragChoice';
import { isActiveProblematicTask, todayYmdInZone } from 'modules/schedule/problematicDays';
import { autoSeatedFromPark } from 'modules/schedule/problematicSeatWatch';
import { useGetDayRemindersQuery } from 'api/dayReminders.api';
import { reminderGoogleEventIds } from 'modules/day-reminders/ReminderList';
import { resolveIanaTimeZone } from 'modules/user-settings/ianaTimeZones';
import { useEventEditor } from 'modules/events/hooks/useEventEditor';
import {
    isCompletedCalendarEvent,
    overlayCompletedTaskEvents,
    resolveTaskForCalendarEvent,
} from 'modules/calendar/completedTaskEvents';
import { isCalendarVisible } from 'modules/calendar/calendarVisibility';
import { planEventPreviewEditTarget } from 'modules/calendar/planEventPreviewActions';
import {
    eventTasksApi,
    useDeleteEventMutation as useDeleteTaskMutation,
    useEditOccurrenceMutation,
    useEndSeriesFromMutation,
    useGetEventsQuery as useGetTasksQuery,
    useSkipOccurrenceMutation,
    useUpdateEventMutation as useUpdateTaskMutation,
} from 'api/eventTasksApi';
import { eventsApi } from 'api/eventsApi';
import { VoiceTaskButton } from 'modules/voice/components/VoiceTaskButton';
import { VoiceTaskSheet } from 'modules/voice/components/VoiceTaskSheet';
import { useVoiceTask } from 'modules/voice/hooks/useVoiceTask';
import { useVoiceLauncher } from 'modules/voice/voiceLauncher';
import { setConflictVoiceOpener } from 'modules/schedule/conflictChoiceBus';
import { settleReplanJob } from 'modules/schedule/settleReplanJob';
import {
    startTaskMutationProgress,
    type TaskMutationProgressHandle,
} from 'modules/schedule/taskMutationProgress';
import { useCoarsePointer, usePhoneLayout } from 'modules/common/hooks/useMediaQuery';
import { useMatchMedia } from 'ui/useViewport';
import { IconButton } from 'ui/IconButton';
import { Segmented } from 'ui/Segmented';
import { cx } from 'ui/cx';
import { Coachmark } from 'ui/Coachmark';
import { PhaseLegend } from 'modules/calendar/components/PhaseLegend';
import { TodayPanel, todaySectionDomId, type TodaySectionId } from 'modules/today/TodayPanel';
import { TodayBar } from 'modules/today/TodayBar';
import { useToday } from 'modules/today/useToday';
import { PhoneWeekStrip } from 'modules/calendar/components/PhoneWeekStrip';
import { Modal } from '../../ui/Modal';
import { Button } from 'ui/Button';
import { dialogButtonSize } from 'ui/controlSize';
import { showErrorToast, showInfoToast, showSuccessToast } from '../../utils/toast';
import { extractApiErrorMessage } from '../../utils/extractApiErrorMessage';
import { formatCivilYmd, formatDateTimeRange, joinToastDetail } from '../../utils/formatDate';
import { civilDayStartEndIso, isoToHm, localYmd, ymdFromLocalDate } from '../../utils/ianaDateTime';
import {
    CalendarView,
    compactPeriodLabel,
    periodLabel,
    shiftPeriod,
    eventStartDate,
    eventEndDate,
    eventsQueryRange,
    THREE_DAYS,
    threeDayLabel,
    threeDays,
    threeDayQueryRange,
} from 'modules/calendar/calendarView';
import { todayNowContext } from 'modules/now/nowBlocks';
import { CalendarChipMeta } from 'modules/calendar/components/CalendarChipMeta';
import {
    listCalendarOverlays,
    listProviderCalendars,
    type CalendarEventOverlayDTO,
} from 'api/calendarOverlays.api';
import type { CalendarNameById } from 'modules/calendar/components/CalendarChipMeta';
import { overlayForEvent } from 'modules/calendar/schedulingKind';
import {
    configureMotion,
    getMotionEpoch,
    isCreatePending,
    subscribeMotion,
    trackMotion,
} from 'modules/calendar/motion/cardMotion';
import { motionDestination, motionKeysForEvent, overlayPendingCreates } from 'modules/calendar/motion/calendarMotionData';

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

const TODAY_PANEL_KEY = 'luefy.todayPanel';

/** Remembered choice; without one the panel starts open only where the week still has room (≥ 1536 px). */
function storedPanelOpen(): boolean {
    let stored: string | null = null;
    try {
        stored = localStorage.getItem(TODAY_PANEL_KEY);
    } catch {
        stored = null;
    }
    if (stored === 'open') return true;
    if (stored === 'closed') return false;
    return typeof window !== 'undefined' && window.innerWidth >= 1536;
}

/** Placeholder while a range loads: the grid's shape instead of a spinner. */
function CalendarSkeleton() {
    return (
        <div className="flex min-h-0 flex-1 flex-col gap-2 rounded-control border border-ide-border bg-ide-panel p-3" aria-busy="true">
            {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="h-10 animate-pulse rounded-chip bg-ide-surface" style={{ opacity: 1 - i * 0.09 }} />
            ))}
        </div>
    );
}

const SWIPE_MIN_PX = 60;

const CalendarPage: React.FC = () => {
    const { t, i18n } = useTranslation();
    const dispatch = useDispatch();
    const store = useStore();
    const phone = usePhoneLayout();
    const coarse = useCoarsePointer();
    const [currentView, setCurrentView] = useState<CalendarView>(defaultCalendarView);
    const [currentDate, setCurrentDate] = useState(new Date());
    const [deleteConfirmDialog, setDeleteConfirmDialog] = useState<{
        open: boolean;
        mode: 'google' | 'task';
        eventId: string | null;
        taskId: string | null;
        calendarId?: string;
        provider?: 'google' | 'microsoft' | 'apple';
        eventName: string;
    }>({
        open: false,
        mode: 'google',
        eventId: null,
        taskId: null,
        eventName: '',
    });
    const [problematicOpen, setProblematicOpen] = useState(false);
    const [todaySheet, setTodaySheet] = useState<TodaySectionId | null>(null);
    const [laterTarget, setLaterTarget] = useState<{ task: TaskDTO; occurrenceYmd: string } | null>(null);
    const wide = useMatchMedia('(min-width: 1280px)');
    const [panelOpen, setPanelOpenState] = useState(storedPanelOpen);
    const setPanelOpen = (next: boolean | ((prev: boolean) => boolean)) =>
        setPanelOpenState((prev) => {
            const value = typeof next === 'function' ? next(prev) : next;
            try {
                localStorage.setItem(TODAY_PANEL_KEY, value ? 'open' : 'closed');
            } catch {
                /* storage blocked */
            }
            return value;
        });
    const threeDayMode = phone && currentView === 'week';
    const swipeFrom = React.useRef<{ x: number; y: number } | null>(null);
    const onSwipeStart = (event: React.TouchEvent) => {
        const touch = event.touches[0];
        swipeFrom.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
    };
    const onSwipeEnd = (event: React.TouchEvent) => {
        const from = swipeFrom.current;
        swipeFrom.current = null;
        const touch = event.changedTouches[0];
        if (!from || !touch) return;
        const dx = touch.clientX - from.x;
        const dy = touch.clientY - from.y;
        if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        const step = threeDayMode ? THREE_DAYS : 1;
        setCurrentDate((prev) => new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + (dx < 0 ? step : -step)));
    };
    const [eventFormDialog, setEventFormDialog] = useState<{
        open: boolean;
        event: GoogleCalendarEvent | null;
    }>({
        open: false,
        event: null,
    });
    const [eventPreview, setEventPreview] = useState<{
        open: boolean;
        event: GoogleCalendarEvent | null;
    }>({
        open: false,
        event: null,
    });

    // Only fetch the active view range — day+week+month together hammered CalDAV.
    const dayEventsQuery = useEventsForDay(
        currentDate,
        undefined,
        currentView !== 'day',
    );
    const weekEventsQuery = useEventsForWeek(
        currentDate,
        undefined,
        currentView !== 'week' || phone,
    );
    const threeDayEventsQuery = useEventsForThreeDays(currentDate, !(currentView === 'week' && phone));
    const monthEventsQuery = useEventsForMonth(
        currentDate.getFullYear(),
        currentDate.getMonth() + 1,
        undefined,
        currentView !== 'month',
    );

    const queryMap = {
        day: dayEventsQuery,
        week: phone ? threeDayEventsQuery : weekEventsQuery,
        month: monthEventsQuery,
    };

    const getEventsQuery = queryMap[currentView];
    // RTK keeps `data` from the previous arg while the next week/day fetches —
    // use currentData + isFetching so the spinner shows on range changes.
    const eventsForRange = getEventsQuery.currentData?.events;
    const eventsLoading =
        getEventsQuery.isLoading ||
        (getEventsQuery.isFetching && !getEventsQuery.currentData);
    const [updateEventTrigger] = useUpdateEvent();
    const [deleteEventTrigger] = useDeleteEvent();
    const [deleteTaskTrigger] = useDeleteTaskMutation();
    const [skipOccurrenceTrigger] = useSkipOccurrenceMutation();
    const [endSeriesFromTrigger] = useEndSeriesFromMutation();
    const [editOccurrenceTrigger] = useEditOccurrenceMutation();
    const [updateTaskTrigger] = useUpdateTaskMutation();
    const [previewBusy, setPreviewBusy] = useState(false);
    const { parkDayHints } = useScheduleActions();
    const { data: userSettings } = useGetUserSettingsQuery();
    const timeZone = resolveIanaTimeZone(userSettings?.timeZone);
    const { openCreate, openCreateFromPrefill, openEdit, openEditReminder, openSchedule, createFromPayload, editorModal } =
        useEventEditor();
    const { data: dayReminders = [] } = useGetDayRemindersQuery();
    const reminderEventIds = reminderGoogleEventIds(dayReminders);
    const { data: tasks = [] } = useGetTasksQuery();
    const todayYmd = todayYmdInZone(timeZone);
    const problematicTasks = tasks.filter((task) =>
        isActiveProblematicTask(task, todayYmd, parkDayHints[task.id]),
    );
    // A freed hole seats parked tasks on the server; say so instead of the
    // banner count silently dropping.
    const parkedIdsRef = React.useRef<Set<string> | null>(null);
    useEffect(() => {
        const previous = parkedIdsRef.current;
        parkedIdsRef.current = new Set(
            tasks.filter((task) => task.scheduleState === 'problematic').map((task) => task.id),
        );
        if (!previous) return;
        for (const task of autoSeatedFromPark(previous, tasks)) {
            // Its card lands on the grid from the problem list.
            trackMotion({ keys: [task.id, task.googleEventId], kind: 'place', from: 'problems' }).settle('done');
            const start = task.scheduledStartTime!;
            const day = localYmd(start, timeZone);
            showInfoToast({
                title: t('schedule.problematicAutoSeated', { name: task.name }),
                detail: `${formatCivilYmd(day) ?? day}, ${isoToHm(start, timeZone)}`,
            });
        }
    }, [tasks, timeZone, t]);
    const [overlays, setOverlays] = useState<CalendarEventOverlayDTO[]>([]);
    const [calendarNameById, setCalendarNameById] = useState<CalendarNameById>({});
    const refreshOverlays = React.useCallback(() => {
        void listCalendarOverlays()
            .then(setOverlays)
            .catch(() => setOverlays([]));
    }, []);
    const refreshCalendarNames = React.useCallback(() => {
        void listProviderCalendars()
            .then((res) => {
                const map: CalendarNameById = {};
                for (const cal of res.calendars ?? []) {
                    if (!cal.id) continue;
                    const meta = { summary: cal.summary, provider: cal.provider };
                    map[cal.id] = meta;
                    map[`${cal.provider}:${cal.id}`] = meta;
                }
                setCalendarNameById(map);
            })
            .catch(() => setCalendarNameById({}));
    }, []);
    useEffect(() => {
        refreshOverlays();
        refreshCalendarNames();
    }, [refreshOverlays, refreshCalendarNames]);
    // Fill names only when events reference calendars we have not labeled yet.
    const calendarNamesHydrated = React.useRef(false);
    useEffect(() => {
        if (calendarNamesHydrated.current) return;
        const events = eventsForRange ?? [];
        if (!events.length) return;
        const missing = events.some((ev) => {
            if (!ev.calendarId) return false;
            const provider = ev.provider ?? 'google';
            return (
                !calendarNameById[ev.calendarId] &&
                !calendarNameById[`${provider}:${ev.calendarId}`]
            );
        });
        if (!missing) {
            calendarNamesHydrated.current = true;
            return;
        }
        calendarNamesHydrated.current = true;
        refreshCalendarNames();
    }, [eventsForRange, calendarNameById, refreshCalendarNames]);
    const voice = useVoiceTask({
        onComplete: createFromPayload,
        onSufficient: openCreateFromPrefill,
    });
    useVoiceLauncher(voice.open);
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
    const gridView: CalendarView = currentView;
    // Placeholders for tasks being created re-render with the motion store.
    useSyncExternalStore(subscribeMotion, getMotionEpoch, () => 0);
    const tasksRef = React.useRef(tasks);
    tasksRef.current = tasks;
    useEffect(() => {
        const locale = i18n.language === 'uk' ? 'uk-UA' : 'en-GB';
        const label = new Intl.DateTimeFormat(locale, {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
        });
        configureMotion({
            resolve: (keys) => motionDestination(tasksRef.current, keys),
            edgeLabel: (ms) => label.format(new Date(ms)),
        });
    }, [i18n.language]);
    const hiddenCalendarIds = userSettings?.hiddenGoogleCalendarIds ?? [];
    const displayEvents = overlayPendingCreates(overlayCompletedTaskEvents(
        visibleGoogleEvents(eventsForRange || []).filter(
            (event) => {
                if (reminderEventIds.has(event.id)) return false;
                if (
                    !isCalendarVisible(
                        event.provider,
                        event.calendarId,
                        hiddenCalendarIds,
                    )
                ) {
                    return false;
                }
                const linked = resolveTaskForCalendarEvent(tasks, event);
                if (linked?.isUnscheduled && linked.status === 'completed') return false;
                if (linked?.isUnscheduled && linked.status === 'canceled') return false;
                return true;
            },
        ),
        tasks,
    ), tasks, isCreatePending);
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
                provider: event.provider ?? 'google',
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
            provider: event.provider ?? 'google',
            eventName: name,
        });
    };

    const confirmDeleteEvent = () => {
        const { mode, eventId, taskId, calendarId, provider, eventName } =
            deleteConfirmDialog;
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
        void deleteEventTrigger({
            eventId,
            calendarId,
            provider: provider ?? 'google',
        })
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
        setEventPreview({ open: true, event });
    };

    const closeEventPreview = () => {
        setEventPreview({ open: false, event: null });
    };

    const openEditorFromPreview = (scope?: SeriesDragScope) => {
        const event = eventPreview.event;
        if (!event) return;
        const linkedTask = resolveTaskForCalendarEvent(tasks, event);
        if (linkedTask) {
            const start = eventStartDate(event);
            const target = planEventPreviewEditTarget({
                taskIsRecurring: linkedTask.isRecurring,
                scope,
                hasOccurrence: !!start,
            });
            if (target.kind === 'unsupported') {
                showErrorToast({ title: t('tasks.occurrence.noDay') });
                return;
            }
            closeEventPreview();
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
                {
                    actionsMode: 'editOnly',
                    scope:
                        target.kind === 'occurrence'
                            ? target.scope
                            : target.kind === 'series'
                              ? 'series'
                              : undefined,
                },
            );
            return;
        }
        closeEventPreview();
        setEventFormDialog({ open: true, event });
    };

    const doneFromPreview = () => {
        const event = eventPreview.event;
        if (!event) return;
        const linked = resolveTaskForCalendarEvent(tasks, event);
        if (!linked) return;
        setPreviewBusy(true);
        const start = eventStartDate(event);
        // A series day gets its own completion; the series and its other days stay to do.
        const request =
            linked.isRecurring && start
                ? editOccurrenceTrigger({
                      id: linked.id,
                      body: { occurrenceStart: start.toISOString(), status: 'completed' },
                  })
                : updateTaskTrigger({ id: linked.id, body: { status: 'completed' } });
        void request
            .unwrap()
            .then(() => closeEventPreview())
            .catch((err) => {
                showErrorToast({
                    title: t('tasks.completeFailed'),
                    detail: extractApiErrorMessage(err),
                });
            })
            .finally(() => setPreviewBusy(false));
    };

    const undoDoneFromPreview = () => {
        const event = eventPreview.event;
        if (!event) return;
        const linked = resolveTaskForCalendarEvent(tasks, event);
        if (!linked) return;
        setPreviewBusy(true);
        void updateTaskTrigger({ id: linked.id, body: { status: 'todo' } })
            .unwrap()
            .then(() => closeEventPreview())
            .catch((err) => {
                showErrorToast({
                    title: t('tasks.completeFailed'),
                    detail: extractApiErrorMessage(err),
                });
            })
            .finally(() => setPreviewBusy(false));
    };

    const deleteFromPreview = (scope?: SeriesDragScope) => {
        const event = eventPreview.event;
        if (!event) return;
        closeEventPreview();
        if (scope) {
            void (async () => {
                const linked = resolveTaskForCalendarEvent(tasks, event);
                if (!linked) {
                    void handleDeleteCalendarEvent(event);
                    return;
                }
                const occurrenceStart = occurrenceStartIso(event);
                if (!occurrenceStart && scope !== 'all') {
                    showErrorToast({ title: t('calendar.taskDeleteFailed') });
                    return;
                }
                try {
                    if (scope === 'occurrence') {
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
                    await deleteTaskTrigger(linked.id).unwrap();
                } catch (err) {
                    showErrorToast({
                        title: t('calendar.taskDeleteFailed'),
                        detail: extractApiErrorMessage(err),
                    });
                }
            })();
            return;
        }
        void handleDeleteCalendarEvent(event);
    };

    const handleEventFormSubmit = (data: any) => {
        const event = eventFormDialog.event;
        setEventFormDialog({ open: false, event: null });
        if (!event) return;
        void updateEventTrigger({
            eventId: event.id,
            eventData: data,
            calendarId: event.calendarId,
            provider: event.provider ?? 'google',
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
                    // Joins the drag's motion that the grid started on drop.
                    motion: { kind: 'move' },
                });
            }
            return mutationRef.current;
        };
        try {
            const moved = await ScheduleApi.moveDisplayedEvent(
                {
                    googleEventId: event.id,
                    calendarId: event.calendarId,
                    provider: event.provider ?? 'google',
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
            const { recurringMoved, conflicts, parked } = await settleReplanJob(
                moved.jobId,
                (stage) => {
                    active.setStage(stage);
                },
            );
            dispatch(eventTasksApi.util.invalidateTags([{ type: 'EventTask', id: 'LIST' }]));
            dispatch(eventsApi.util.invalidateTags([{ type: 'Event', id: 'LIST' }]));
            if (conflicts.length) {
                undoPatches.forEach((patch) => patch.undo());
                active.dismiss();
                return;
            }
            if (parked) {
                active.finish();
                return;
            }
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

    const handleCreateForRange = (_day: Date, start: Date, end: Date) => {
        const minutes = Math.max(15, Math.round((end.getTime() - start.getTime()) / 60_000));
        openCreateFromPrefill({
            name: '',
            eventType: 'fixed',
            allowSplit: false,
            isRecurring: false,
            estimatedTimeInMinutes: minutes,
            scheduledStartTime: start.toISOString(),
            scheduledEndTime: end.toISOString(),
        });
    };

    const nowStripReuseCalendarEvents = React.useMemo(() => {
        const sleep = {
            sleepTime: userSettings?.sleepTime,
            wakeTime: userSettings?.wakeTime,
        };
        const focus =
            currentView === 'month'
                ? new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)
                : currentDate;
        const active = eventsQueryRange(currentView, focus, sleep);
        const nowCtx = todayNowContext(new Date().toISOString(), timeZone);
        return (
            new Date(active.timeMin).getTime() <=
                new Date(nowCtx.fetchTimeMin).getTime() &&
            new Date(active.timeMax).getTime() >=
                new Date(nowCtx.fetchTimeMax).getTime()
        );
    }, [
        currentView,
        currentDate,
        userSettings?.sleepTime,
        userSettings?.wakeTime,
        timeZone,
    ]);

    useEffect(() => {
        const focus =
            currentView === 'month'
                ? new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)
                : currentDate;
        const sleep = { sleepTime: userSettings?.sleepTime, wakeTime: userSettings?.wakeTime };
        const range = threeDayMode
            ? threeDayQueryRange(currentDate, sleep)
            : eventsQueryRange(currentView, focus, sleep);
        configureMotion({
            range: { startMs: new Date(range.timeMin).getTime(), endMs: new Date(range.timeMax).getTime() },
        });
    }, [currentView, currentDate, threeDayMode, userSettings?.sleepTime, userSettings?.wakeTime]);

    const today = useToday({
        sharedEvents: eventsForRange,
        skipEventsFetch: nowStripReuseCalendarEvents,
        hiddenEventIds: reminderEventIds,
    });
    useEffect(() => {
        if (!todaySheet || todaySheet === 'now') return;
        const id = window.setTimeout(() => {
            document.getElementById(todaySectionDomId(todaySheet))?.scrollIntoView({ block: 'start', behavior: 'smooth' });
        }, 240);
        return () => window.clearTimeout(id);
    }, [todaySheet]);

    const todayPanel = (
        <TodayPanel
            today={today}
            problematicTasks={problematicTasks}
            onOpenProblematic={() => {
                setTodaySheet(null);
                setProblematicOpen(true);
            }}
            onOpenPreview={(event) => {
                setTodaySheet(null);
                setEventPreview({ open: true, event });
            }}
            onEditTask={(task) => {
                setTodaySheet(null);
                openEdit(task);
            }}
            onScheduleTask={(task) => {
                setTodaySheet(null);
                setLaterTarget({ task, occurrenceYmd: today.todayYmd });
            }}
            onEditReminder={(reminder) => {
                setTodaySheet(null);
                openEditReminder(reminder);
            }}
        />
    );
    const attention = problematicTasks.length + today.overdueReminders.length;
    const periodText = threeDayMode ? threeDayLabel(currentDate) : periodLabel(currentDate, currentView);
    const shift = (delta: number) =>
        setCurrentDate((prev) =>
            threeDayMode
                ? new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + delta * THREE_DAYS)
                : shiftPeriod(prev, currentView, delta),
        );
    const viewLabel = (view: CalendarView) =>
        phone && view === 'week' ? t('calendar.threeDays') : t(`calendar.${view}`);

    return (
        <div className="page-shell-fill relative md:min-h-0 md:overflow-hidden max-md:px-3 max-md:pb-2 max-md:pt-2">
            {phone ? (
                <header className="mb-2 shrink-0 space-y-2">
                    <h1 className="sr-only">{t('nav.calendar')}</h1>
                    <div className="flex min-w-0 items-center gap-1">
                        <IconButton
                            label={t('common.previous', { view: viewLabel(currentView) })}
                            onClick={() => shift(-1)}
                            data-motion-edge="prev"
                        >
                            <ChevronLeft className="h-5 w-5" aria-hidden />
                        </IconButton>
                        <div className="min-w-0 flex-1">
                            <CalendarDatePicker
                                compact
                                value={currentDate}
                                label={periodText}
                                caption={threeDayMode ? periodText : compactPeriodLabel(currentDate, currentView)}
                                onChange={setCurrentDate}
                            />
                        </div>
                        <IconButton
                            label={t('common.next', { view: viewLabel(currentView) })}
                            onClick={() => shift(1)}
                            data-motion-edge="next"
                        >
                            <ChevronRight className="h-5 w-5" aria-hidden />
                        </IconButton>
                        <Button
                            variant="ghost"
                            size="md"
                            onClick={() => setCurrentDate(new Date())}
                            className="shrink-0 px-2"
                            aria-label={t('common.today')}
                        >
                            <CalendarCheck className="hidden h-5 w-5 max-[359px]:block" aria-hidden />
                            <span className="max-[359px]:hidden">{t('common.today')}</span>
                        </Button>
                    </div>
                    <div className="flex items-center gap-2">
                        <Segmented
                            label={t('calendar.view')}
                            value={currentView}
                            onChange={setCurrentView}
                            options={(['day', 'week', 'month'] as const).map((v) => ({ value: v, label: viewLabel(v) }))}
                            className="flex-1"
                        />
                        <PhaseLegend date={currentDate} compact />
                        <CalendarVisibilityMenu compact />
                    </div>
                </header>
            ) : (
                <header className="mb-4 shrink-0 space-y-4">
                    <div className="flex flex-wrap items-end justify-between gap-3">
                        <div className="min-w-0">
                            <h1 className="page-title">{t('nav.calendar')}</h1>
                            <p className="page-lead">{periodText}</p>
                        </div>
                        <div className="flex shrink-0 gap-2">
                            <VoiceTaskButton onClick={voice.open} />
                            <Button icon={Plus} onClick={() => openCreate()}>
                                {t('calendar.createTask')}
                            </Button>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <Segmented
                            label={t('calendar.view')}
                            value={currentView}
                            onChange={setCurrentView}
                            options={(['day', 'week', 'month'] as const).map((v) => ({ value: v, label: t(`calendar.${v}`) }))}
                        />
                        <div className="flex items-center gap-1">
                            <IconButton
                                size="md"
                                label={t('common.previous', { view: t(`calendar.${currentView}`) })}
                                onClick={() => shift(-1)}
                                data-motion-edge="prev"
                            >
                                <ChevronLeft className="h-5 w-5" aria-hidden />
                            </IconButton>
                            <IconButton
                                size="md"
                                label={t('common.next', { view: t(`calendar.${currentView}`) })}
                                onClick={() => shift(1)}
                                data-motion-edge="next"
                            >
                                <ChevronRight className="h-5 w-5" aria-hidden />
                            </IconButton>
                            <Button variant="secondary" size="md" onClick={() => setCurrentDate(new Date())}>
                                {t('common.today')}
                            </Button>
                            <CalendarDatePicker value={currentDate} label={periodText} onChange={setCurrentDate} />
                        </div>
                        <div className="ml-auto flex items-center gap-2">
                            <PhaseLegend date={currentDate} />
                            <CalendarVisibilityMenu />
                            <button
                                type="button"
                                onClick={() => (wide ? setPanelOpen((v) => !v) : setTodaySheet('now'))}
                                aria-pressed={wide ? panelOpen : undefined}
                                aria-label={t('today.toggle')}
                                data-motion-target="today"
                                className={cx(
                                    'relative inline-flex h-9 items-center gap-2 rounded-control border px-3 text-body-sm transition',
                                    wide && panelOpen
                                        ? 'border-ide-link/50 bg-ide-link/10 text-ide-text'
                                        : 'border-ide-border bg-ide-panel text-ide-text hover:bg-ide-surface',
                                )}
                            >
                                <PanelRight className="h-4 w-4" aria-hidden />
                                {t('today.title')}
                                {attention > 0 && !(wide && panelOpen) ? (
                                    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-ide-warnTint px-1 text-caption font-semibold tabular-nums text-ide-warn">
                                        {attention}
                                    </span>
                                ) : null}
                            </button>
                        </div>
                    </div>
                </header>
            )}

            {phone ? (
                <div className="mb-2 shrink-0">
                    <TodayBar
                        today={today}
                        problematicCount={problematicTasks.length}
                        onOpen={(section) => setTodaySheet(section ?? 'now')}
                    />
                </div>
            ) : null}
            {phone && currentView === 'day' ? (
                <PhoneWeekStrip date={currentDate} onSelect={setCurrentDate} />
            ) : null}

            <div className="flex min-h-0 flex-1 gap-4">
                <div
                    className="relative flex min-h-0 min-w-0 flex-1 flex-col"
                    onTouchStart={phone && currentView !== 'month' ? onSwipeStart : undefined}
                    onTouchEnd={phone && currentView !== 'month' ? onSwipeEnd : undefined}
                >
                    {eventsLoading ? (
                        <CalendarSkeleton />
                    ) : getEventsQuery.isError ? (
                        <div
                            className="rounded-control border border-ide-error/40 bg-ide-errorTint px-4 py-3 text-body-sm text-ide-error"
                            role="alert"
                        >
                            {t('calendar.loadFailed')}
                        </div>
                    ) : (
                        <CalendarGrid
                            view={gridView}
                            date={currentDate}
                            days={threeDayMode ? threeDays(currentDate) : undefined}
                            events={displayEvents}
                            motionKeys={(event) => motionKeysForEvent(tasks, event)}
                            onEditEvent={handleEditEvent}
                            onCreateForDate={handleCreateForDate}
                            onCreateForRange={handleCreateForRange}
                            onEventTimeChange={handleEventTimeChange}
                            onDeleteEvent={coarse ? undefined : (event) => void handleDeleteCalendarEvent(event)}
                            isEventCompleted={(event) => isCompletedCalendarEvent(event, tasks)}
                            phoneMonth={phone && currentView === 'month'}
                            onPickDay={(day) => {
                                setCurrentDate(day);
                                if (!phone) setCurrentView('day');
                            }}
                            renderEventMeta={(event, completed) => (
                                <CalendarChipMeta
                                    event={event}
                                    task={resolveTaskForCalendarEvent(tasks, event)}
                                    overlay={overlayForEvent(overlays, event, event.provider ?? 'google')}
                                    completed={completed}
                                    calendarNameById={calendarNameById}
                                    provider={event.provider ?? 'google'}
                                    dismissWarnFlexibleMove={userSettings?.dismissWarnFlexibleMove}
                                    dismissWarnUnscheduleExternal={userSettings?.dismissWarnUnscheduleExternal}
                                    onOverlaysChanged={refreshOverlays}
                                    onUnscheduled={() => {
                                        refreshOverlays();
                                        void getEventsQuery.refetch?.();
                                        dispatch(eventTasksApi.util.invalidateTags([{ type: 'EventTask', id: 'LIST' }]));
                                    }}
                                />
                            )}
                        />
                    )}
                    {!eventsLoading && currentView !== 'month' ? (
                        <Coachmark
                            id={coarse ? 'calendar-touch' : 'calendar-drag'}
                            className="absolute left-1/2 z-10 w-[min(28rem,calc(100%-1.5rem))] -translate-x-1/2 max-md:top-3 md:bottom-3"
                        >
                            {coarse ? t('calendar.touchHint') : t('calendar.dragHint')}
                        </Coachmark>
                    ) : null}
                </div>
                {wide && panelOpen ? (
                    <aside
                        aria-label={t('today.title')}
                        className="flex w-80 shrink-0 flex-col overflow-hidden rounded-control border border-ide-border bg-ide-panel"
                    >
                        <div className="flex shrink-0 items-center justify-between border-b border-ide-border px-4 py-2.5">
                            <h2 className="text-heading font-semibold text-ide-text">{t('today.title')}</h2>
                            <IconButton label={t('today.hide')} size="sm" onClick={() => setPanelOpen(false)}>
                                <X className="h-4 w-4" aria-hidden />
                            </IconButton>
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-auto p-4" data-motion-scroll>
                            {todayPanel}
                        </div>
                    </aside>
                ) : null}
            </div>

            {phone ? (
                <button
                    type="button"
                    data-testid="create-task"
                    aria-label={t('calendar.createTask')}
                    onClick={() => openCreate()}
                    className="absolute bottom-4 right-4 z-20 inline-flex h-14 w-14 items-center justify-center rounded-full bg-ide-accentBlue text-white shadow-ide-md transition active:scale-95"
                >
                    <Plus className="h-6 w-6" aria-hidden />
                </button>
            ) : null}

            <Modal
                open={todaySheet != null}
                onClose={() => setTodaySheet(null)}
                title={t('today.title')}
                maxWidthClass="max-w-md"
            >
                {todayPanel}
            </Modal>

            <EventPreview
                open={eventPreview.open}
                event={eventPreview.event}
                calendarName={
                    eventPreview.event
                        ? calendarNameById[
                              `${eventPreview.event.provider ?? 'google'}:${eventPreview.event.calendarId}`
                          ]?.summary ||
                          (eventPreview.event.calendarId
                              ? calendarNameById[eventPreview.event.calendarId]?.summary
                              : undefined)
                        : undefined
                }
                task={
                    eventPreview.event
                        ? resolveTaskForCalendarEvent(tasks, eventPreview.event) ?? null
                        : null
                }
                onClose={closeEventPreview}
                onEdit={openEditorFromPreview}
                onDelete={deleteFromPreview}
                onDone={doneFromPreview}
                onUndoDone={undoDoneFromPreview}
                busy={previewBusy}
            />

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
                        <Button
                            type="button"
                            variant="secondary"
                            size={dialogButtonSize}
                            onClick={cancelDeleteEvent}
                            className="w-full sm:w-auto"
                            icon={X}
                        >
                            {t('common.cancel')}
                        </Button>
                        <Button
                            type="button"
                            variant="dangerSolid"
                            size={dialogButtonSize}
                            onClick={confirmDeleteEvent}
                            className="w-full sm:w-auto"
                            icon={Trash2}
                        >
                            {t('common.delete')}
                        </Button>
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

            {editorModal}
            <ProblematicInboxSheet
                open={problematicOpen}
                tasks={problematicTasks}
                timeZone={timeZone}
                dayHints={parkDayHints}
                onClose={() => setProblematicOpen(false)}
                onEdit={(task) => openEdit(task)}
            />
            <MoveOccurrenceSheet
                mode="later"
                target={laterTarget}
                timeZone={timeZone}
                onClose={() => setLaterTarget(null)}
                onDone={() => setLaterTarget(null)}
            />
            <VoiceTaskSheet voice={voice} />
            <SeriesDragHost />

        </div>
    );
};

export default CalendarPage;
