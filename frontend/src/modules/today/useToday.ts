import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useGetEventsQuery } from 'api/eventsApi';
import type { GoogleCalendarEvent } from 'api/google-calendar.api';
import {
  useEditOccurrenceMutation,
  useGetEventsQuery as useGetTasksQuery,
  useSkipOccurrenceMutation,
  useUpdateEventMutation,
} from 'api/eventTasksApi';
import { useGetUserSettingsQuery } from 'api/userSettingsApi';
import { useGetDayRemindersQuery } from 'api/dayReminders.api';
import type { TaskDTO } from 'api/tasks.api';
import { resolveIanaTimeZone } from 'modules/user-settings/ianaTimeZones';
import { buildDoNowPatch } from 'modules/events/unscheduledActions';
import { overdueDayCount } from 'modules/day-reminders/overdue';
import { localHm } from 'utils/ianaDateTime';
import { showErrorToast } from 'utils/toast';
import { extractApiErrorMessage } from 'utils/extractApiErrorMessage';
import i18n from 'i18n';
import {
  buildNowBlocks,
  pickNowAndNext,
  todayNowContext,
  unscheduledTasksForToday,
  type NowBlock,
} from 'modules/now/nowBlocks';

export type TodayOptions = {
  /** The calendar page already loaded a range that covers today: reuse it. */
  sharedEvents?: GoogleCalendarEvent[];
  skipEventsFetch?: boolean;
  /** Google event ids that belong to day reminders and stay off the clock. */
  hiddenEventIds?: Set<string>;
};

export function useNowMs(intervalMs = 30_000): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return nowMs;
}

export function blockRange(block: NowBlock, timeZone: string): string {
  if (block.allDay) return i18n.t('common.allDay');
  const start = localHm(new Date(block.startMs).toISOString(), timeZone);
  const end = localHm(new Date(block.endMs).toISOString(), timeZone);
  return `${start}–${end}`;
}

export function blockStart(block: NowBlock, timeZone: string): string {
  return localHm(new Date(block.startMs).toISOString(), timeZone);
}

export function blockEnd(block: NowBlock, timeZone: string): string {
  return localHm(new Date(block.endMs).toISOString(), timeZone);
}

export function canActOnLater(task: TaskDTO): boolean {
  return (
    !task.isRecurring &&
    !task.isFixedExternal &&
    task.status !== 'completed' &&
    task.status !== 'canceled'
  );
}

/** Now / Next / Later and due reminders for today, with their actions. One source for the panel and the bar. */
export function useToday({ sharedEvents, skipEventsFetch = false, hiddenEventIds }: TodayOptions = {}) {
  const { t } = useTranslation();
  const nowMs = useNowMs();
  const { data: settings } = useGetUserSettingsQuery();
  const timeZone = resolveIanaTimeZone(settings?.timeZone);
  const ctx = useMemo(() => todayNowContext(new Date(nowMs).toISOString(), timeZone), [nowMs, timeZone]);
  const { data: todayEvents } = useGetEventsQuery(
    { timeMin: ctx.fetchTimeMin, timeMax: ctx.fetchTimeMax },
    { skip: skipEventsFetch },
  );
  const events = useMemo(
    () =>
      (skipEventsFetch ? (sharedEvents ?? []) : (todayEvents?.events ?? sharedEvents ?? [])).filter(
        (event) => !hiddenEventIds?.has(event.id),
      ),
    [skipEventsFetch, sharedEvents, todayEvents, hiddenEventIds],
  );
  const { data: tasks = [] } = useGetTasksQuery();
  const { data: reminders = [] } = useGetDayRemindersQuery();
  const [updateTask] = useUpdateEventMutation();
  const [skipOccurrence] = useSkipOccurrenceMutation();
  const [editOccurrence] = useEditOccurrenceMutation();
  const [busyId, setBusyId] = useState<string | null>(null);

  const blocks = useMemo(
    () => buildNowBlocks(events, tasks, ctx.todayYmd, ctx.timeZone),
    [events, tasks, ctx.todayYmd, ctx.timeZone],
  );
  const { now, next } = useMemo(
    () => pickNowAndNext(blocks, nowMs, ctx.todayEndMs, new Date(ctx.fetchTimeMin).getTime()),
    [blocks, nowMs, ctx.todayEndMs, ctx.fetchTimeMin],
  );
  const later = useMemo(() => {
    const occupied = new Set<string>();
    if (now?.task) occupied.add(now.task.id);
    if (next?.task) occupied.add(next.task.id);
    return unscheduledTasksForToday(tasks, occupied, ctx.todayYmd, ctx.timeZone);
  }, [tasks, now, next, ctx.todayYmd, ctx.timeZone]);

  const dueReminders = reminders.filter((reminder) => reminder.dueYmd <= ctx.todayYmd);
  const overdueReminders = dueReminders.filter((reminder) => overdueDayCount(reminder.dueYmd, ctx.todayYmd) > 0);

  const run = async (taskId: string, failTitle: string, action: () => Promise<unknown>) => {
    setBusyId(taskId);
    try {
      // Progress toasts come from eventTasksApi.
      await action();
    } catch (err) {
      showErrorToast({ title: failTitle, detail: extractApiErrorMessage(err) });
    } finally {
      setBusyId(null);
    }
  };

  const complete = (task: TaskDTO) =>
    run(task.id, t('tasks.completeFailed'), () => updateTask({ id: task.id, body: { status: 'completed' } }).unwrap());

  /** Done on a block: a series block completes that day only; a one-off completes the task. */
  const completeBlock = (block: NowBlock) => {
    const task = block.task;
    if (!task) return Promise.resolve();
    if (!task.isRecurring) return complete(task);
    return run(task.id, t('tasks.completeFailed'), () =>
      editOccurrence({
        id: task.id,
        body: { occurrenceStart: new Date(block.startMs).toISOString(), status: 'completed' },
      }).unwrap(),
    );
  };

  const skipBlock = (block: NowBlock) => {
    const task = block.task;
    if (!task) return Promise.resolve();
    return run(task.id, t('now.skipFailed'), () =>
      skipOccurrence({
        id: task.id,
        body: {
          occurrenceStart: new Date(block.startMs).toISOString(),
          googleEventId: block.event?.id,
          googleEventCalendarId: block.event?.calendarId,
        },
      }).unwrap(),
    );
  };

  const skipLater = (task: TaskDTO) =>
    canActOnLater(task)
      ? run(task.id, t('tasks.skipFailed'), () => updateTask({ id: task.id, body: { status: 'canceled' } }).unwrap())
      : Promise.resolve();

  const doNow = (task: TaskDTO) =>
    canActOnLater(task)
      ? run(task.id, t('tasks.doNowFailed'), () => updateTask({ id: task.id, body: buildDoNowPatch(timeZone) }).unwrap())
      : Promise.resolve();

  return {
    nowMs,
    timeZone: ctx.timeZone,
    todayYmd: ctx.todayYmd,
    now,
    next,
    later,
    dueReminders,
    overdueReminders,
    busyId,
    complete,
    completeBlock,
    skipBlock,
    skipLater,
    doNow,
  };
}

export type TodayState = ReturnType<typeof useToday>;
