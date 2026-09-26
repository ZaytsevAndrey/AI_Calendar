import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useGetEventsQuery } from 'api/eventsApi';
import { useGetEventsQuery as useGetTasksQuery, useSkipOccurrenceMutation, useUpdateEventMutation } from 'api/eventTasksApi';
import { useGetUserSettingsQuery } from 'api/userSettingsApi';
import type { TaskDTO } from 'api/tasks.api';
import { resolveIanaTimeZone } from 'modules/user-settings/ianaTimeZones';
import { localHm } from 'utils/ianaDateTime';
import { showErrorToast, showSuccessToast } from 'utils/toast';
import { extractApiErrorMessage } from 'utils/extractApiErrorMessage';
import i18n from 'i18n';
import {
  buildNowBlocks,
  canCompleteNowBlock,
  canSkipNowBlock,
  pickNowAndNext,
  todayNowContext,
  unscheduledTasksForToday,
  type NowBlock,
} from '../nowBlocks';
import { usePhoneLayout } from 'modules/common/hooks/useMediaQuery';
import { HabitNowStrip } from './HabitNowStrip';

function useNowMs(intervalMs = 30_000): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return nowMs;
}

function formatRange(block: NowBlock, timeZone: string): string {
  if (block.allDay) return i18n.t('common.allDay');
  const start = localHm(new Date(block.startMs).toISOString(), timeZone);
  const end = localHm(new Date(block.endMs).toISOString(), timeZone);
  return `${start}–${end}`;
}

function BlockRow({
  label,
  block,
  timeZone,
  empty,
  onDone,
  onSkip,
  busyId,
}: {
  label: string;
  block: NowBlock | null;
  timeZone: string;
  empty: string;
  onDone: (task: TaskDTO) => void;
  onSkip: (block: NowBlock) => void;
  busyId: string | null;
}) {
  const { t } = useTranslation();
  const showDone = !!(block && canCompleteNowBlock(block) && block.task);
  const showSkip = !!(block && canSkipNowBlock(block) && block.task);
  return (
    <div className="min-w-0 rounded-md border border-ide-border bg-ide-surface px-3 py-2.5">
      <p className="text-xs font-medium uppercase tracking-wide text-ide-muted">{label}</p>
      {block ? (
        <div className="mt-1 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ide-text">{block.title}</p>
            <p className="text-xs text-ide-muted">{formatRange(block, timeZone)}</p>
          </div>
          {showDone || showSkip ? (
            <div className="flex shrink-0 flex-wrap justify-end gap-1">
              {showSkip && block.task ? (
                <button
                  type="button"
                  className="ui-btn-secondary px-2.5 py-1 text-xs"
                  disabled={busyId === block.task.id}
                  onClick={() => onSkip(block)}
                >
                  {t('common.skip')}
                </button>
              ) : null}
              {showDone && block.task ? (
                <button
                  type="button"
                  className="ui-btn-secondary px-2.5 py-1 text-xs"
                  disabled={busyId === block.task.id}
                  onClick={() => onDone(block.task!)}
                >
                  {t('common.done')}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="mt-1 text-sm text-ide-muted">{empty}</p>
      )}
    </div>
  );
}

export function NowStrip() {
  const { t } = useTranslation();
  const nowMs = useNowMs();
  const { data: settings } = useGetUserSettingsQuery();
  const timeZone = resolveIanaTimeZone(settings?.timeZone);
  const ctx = useMemo(
    () => todayNowContext(new Date(nowMs).toISOString(), timeZone),
    [nowMs, timeZone],
  );
  const { data: todayEvents } = useGetEventsQuery({
    timeMin: ctx.fetchTimeMin,
    timeMax: ctx.fetchTimeMax,
  });
  const { data: tasks = [] } = useGetTasksQuery();
  const [updateTask] = useUpdateEventMutation();
  const [skipOccurrence] = useSkipOccurrenceMutation();
  const [busyId, setBusyId] = useState<string | null>(null);

  const blocks = useMemo(
    () => buildNowBlocks(todayEvents?.events ?? [], tasks, ctx.todayYmd, ctx.timeZone),
    [todayEvents?.events, tasks, ctx.todayYmd, ctx.timeZone],
  );
  const { now, next } = useMemo(
    () =>
      pickNowAndNext(
        blocks,
        nowMs,
        ctx.todayEndMs,
        new Date(ctx.fetchTimeMin).getTime(),
      ),
    [blocks, nowMs, ctx.todayEndMs, ctx.fetchTimeMin],
  );
  const occupied = useMemo(() => {
    const ids = new Set<string>();
    if (now?.task) ids.add(now.task.id);
    if (next?.task) ids.add(next.task.id);
    return ids;
  }, [now, next]);
  const inbox = useMemo(
    () => unscheduledTasksForToday(tasks, occupied, ctx.todayYmd, ctx.timeZone),
    [tasks, occupied, ctx.todayYmd, ctx.timeZone],
  );
  const phone = usePhoneLayout();
  const [expanded, setExpanded] = useState(false);

  const markDone = async (task: TaskDTO) => {
    setBusyId(task.id);
    try {
      await updateTask({ id: task.id, body: { status: 'completed' } }).unwrap();
      showSuccessToast({ title: t('tasks.completed'), detail: task.name });
    } catch (err) {
      showErrorToast({
        title: t('tasks.completeFailed'),
        detail: extractApiErrorMessage(err),
      });
    } finally {
      setBusyId(null);
    }
  };

  const markSkip = async (block: NowBlock) => {
    const task = block.task;
    if (!task) return;
    setBusyId(task.id);
    try {
      await skipOccurrence({
        id: task.id,
        body: {
          occurrenceStart: new Date(block.startMs).toISOString(),
          googleEventId: block.event?.id,
          googleEventCalendarId: block.event?.calendarId,
        },
      }).unwrap();
      showSuccessToast({ title: t('now.occurrenceSkipped'), detail: task.name });
    } catch (err) {
      showErrorToast({
        title: t('now.skipFailed'),
        detail: extractApiErrorMessage(err),
      });
    } finally {
      setBusyId(null);
    }
  };

  const emptyClock = !now && !next && inbox.length === 0;
  const nowSummary = now
    ? `${now.title} · ${formatRange(now, ctx.timeZone)}`
    : t('now.nothingInProgress');

  return (
    <section className="space-y-3 rounded-lg border border-ide-border bg-ide-panel p-3 max-md:space-y-2 max-md:p-2">
      {phone ? (
        <button
          type="button"
          className="flex min-h-0 w-full items-center gap-2 py-0.5 text-left"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
        >
          <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-ide-muted">
            {t('now.label')}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm text-ide-text">{nowSummary}</span>
        </button>
      ) : null}
      {phone && !expanded ? null : (
        <>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        <BlockRow
          label={t('now.label')}
          block={now}
          timeZone={ctx.timeZone}
          empty={t('now.nothingInProgress')}
          onDone={markDone}
          onSkip={markSkip}
          busyId={busyId}
        />
        <BlockRow
          label={t('now.next')}
          block={next}
          timeZone={ctx.timeZone}
          empty={t('now.nothingElseToday')}
          onDone={markDone}
          onSkip={markSkip}
          busyId={busyId}
        />
        <div className="min-w-0 rounded-md border border-ide-border bg-ide-surface px-3 py-2.5">
          <p className="text-xs font-medium uppercase tracking-wide text-ide-muted">
            {t('now.unscheduled')}
          </p>
          {inbox.length ? (
            <ul className="mt-1 space-y-1.5">
              {inbox.map((task) => (
                <li key={task.id} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-sm text-ide-text">{task.name}</span>
                  {task.isRecurring || task.isFixedExternal ? null : (
                    <button
                      type="button"
                      className="ui-btn-secondary shrink-0 px-2.5 py-1 text-xs"
                      disabled={busyId === task.id}
                      onClick={() => void markDone(task)}
                    >
                      {t('common.done')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-ide-muted">{t('now.noInbox')}</p>
          )}
        </div>
      </div>
      {emptyClock ? (
        <p className="text-xs text-ide-muted">{t('now.emptyClock')}</p>
      ) : null}
      {phone ? null : <HabitNowStrip />}
        </>
      )}
    </section>
  );
}
