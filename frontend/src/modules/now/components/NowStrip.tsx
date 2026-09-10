import React, { useEffect, useMemo, useState } from 'react';
import { useGetEventsQuery } from 'api/eventsApi';
import { useGetEventsQuery as useGetTasksQuery, useUpdateEventMutation } from 'api/eventTasksApi';
import { useGetUserSettingsQuery } from 'api/userSettingsApi';
import type { TaskDTO } from 'api/tasks.api';
import { resolveIanaTimeZone } from 'modules/user-settings/ianaTimeZones';
import { localHm } from 'utils/ianaDateTime';
import { showErrorToast, showSuccessToast } from 'utils/toast';
import { extractApiErrorMessage } from 'utils/extractApiErrorMessage';
import {
  buildNowBlocks,
  canCompleteNowBlock,
  pickNowAndNext,
  todayNowContext,
  unscheduledTasksForToday,
  type NowBlock,
} from '../nowBlocks';
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
  if (block.allDay) return 'All day';
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
  busyId,
}: {
  label: string;
  block: NowBlock | null;
  timeZone: string;
  empty: string;
  onDone: (task: TaskDTO) => void;
  busyId: string | null;
}) {
  return (
    <div className="min-w-0 rounded-md border border-ide-border bg-ide-surface px-3 py-2.5">
      <p className="text-xs font-medium uppercase tracking-wide text-ide-muted">{label}</p>
      {block ? (
        <div className="mt-1 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ide-text">{block.title}</p>
            <p className="text-xs text-ide-muted">{formatRange(block, timeZone)}</p>
          </div>
          {canCompleteNowBlock(block) && block.task ? (
            <button
              type="button"
              className="ui-btn-secondary shrink-0 px-2.5 py-1 text-xs"
              disabled={busyId === block.task.id}
              onClick={() => onDone(block.task!)}
            >
              Done
            </button>
          ) : null}
        </div>
      ) : (
        <p className="mt-1 text-sm text-ide-muted">{empty}</p>
      )}
    </div>
  );
}

export function NowStrip() {
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
  const [busyId, setBusyId] = useState<string | null>(null);

  const blocks = useMemo(
    () => buildNowBlocks(todayEvents?.events ?? [], tasks, ctx.todayYmd, ctx.timeZone),
    [todayEvents?.events, tasks, ctx.todayYmd, ctx.timeZone],
  );
  const { now, next } = useMemo(
    () => pickNowAndNext(blocks, nowMs, ctx.todayEndMs),
    [blocks, nowMs, ctx.todayEndMs],
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

  const markDone = async (task: TaskDTO) => {
    setBusyId(task.id);
    try {
      await updateTask({ id: task.id, body: { status: 'completed' } }).unwrap();
      showSuccessToast({ title: 'Task completed', detail: task.name });
    } catch (err) {
      showErrorToast({
        title: 'Could not complete task',
        detail: extractApiErrorMessage(err),
      });
    } finally {
      setBusyId(null);
    }
  };

  const emptyClock = !now && !next && inbox.length === 0;

  return (
    <section className="space-y-3 rounded-lg border border-ide-border bg-ide-panel p-3">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        <BlockRow
          label="Now"
          block={now}
          timeZone={ctx.timeZone}
          empty="Nothing in progress"
          onDone={markDone}
          busyId={busyId}
        />
        <BlockRow
          label="Next"
          block={next}
          timeZone={ctx.timeZone}
          empty="Nothing else today"
          onDone={markDone}
          busyId={busyId}
        />
        <div className="min-w-0 rounded-md border border-ide-border bg-ide-surface px-3 py-2.5">
          <p className="text-xs font-medium uppercase tracking-wide text-ide-muted">Unscheduled</p>
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
                      Done
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-ide-muted">No inbox items for today</p>
          )}
        </div>
      </div>
      {emptyClock ? (
        <p className="text-xs text-ide-muted">
          Nothing on the clock.{' '}
          <span>Generate a schedule or add a task.</span>
        </p>
      ) : null}
      <HabitNowStrip />
    </section>
  );
}
