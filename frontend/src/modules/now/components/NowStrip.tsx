import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarPlus, Check, Pencil, SkipForward, Zap } from 'lucide-react';
import { useGetEventsQuery } from 'api/eventsApi';
import type { GoogleCalendarEvent } from 'api/google-calendar.api';
import { useGetEventsQuery as useGetTasksQuery, useSkipOccurrenceMutation, useUpdateEventMutation } from 'api/eventTasksApi';
import { useGetUserSettingsQuery } from 'api/userSettingsApi';
import type { TaskDTO } from 'api/tasks.api';
import { previewEventFromTask } from 'modules/calendar/completedTaskEvents';
import { KindIcon, KIND_I18N_KEY } from 'modules/calendar/kindIcons';
import {
  schedulingKindForEvent,
  type SchedulingKind,
} from 'modules/calendar/schedulingKind';
import { resolveIanaTimeZone } from 'modules/user-settings/ianaTimeZones';
import { buildDoNowPatch } from 'modules/events/unscheduledActions';
import { localHm } from 'utils/ianaDateTime';
import { showErrorToast } from 'utils/toast';
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

/** Full-height icon actions pinned to the card's right edge. */
const stripIconBtn =
  'inline-flex h-full w-7 shrink-0 items-center justify-center text-ide-muted transition-colors hover:text-ide-text focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ide-link disabled:pointer-events-none disabled:opacity-50';
const stripIconPrimary = `${stripIconBtn} text-ide-link hover:text-ide-link`;

const cardFill = 'bg-ide-surface';

function StripActions({ children }: { children: React.ReactNode }) {
  return (
    <div className="pointer-events-none absolute inset-y-0 right-0 z-10 flex items-stretch bg-[linear-gradient(to_left,rgb(var(--ide-surface))_calc(100%-1.75rem),transparent)] pl-7 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100 max-md:opacity-100">
      <div
        className="pointer-events-none flex h-full items-stretch group-hover:pointer-events-auto group-focus-within:pointer-events-auto max-md:pointer-events-auto"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

type StripTone = 'now' | 'next' | 'inbox';

/** Gentle column tint — present, not neon. */
const TONE: Record<StripTone, { column: string; header: string; card: string }> = {
  now: {
    column: 'border-ide-accent/25 bg-ide-accent/[0.05]',
    header: 'text-ide-accent/90',
    card: `border-ide-accent/20 ${cardFill} hover:border-ide-accent/35`,
  },
  next: {
    column: 'border-ide-link/25 bg-ide-link/[0.05]',
    header: 'text-ide-link/90',
    card: `border-ide-link/20 ${cardFill} hover:border-ide-link/35`,
  },
  inbox: {
    column: 'border-ide-warn/25 bg-ide-warn/[0.05]',
    header: 'text-ide-warn/90',
    card: `border-ide-warn/20 ${cardFill} hover:border-ide-warn/35`,
  },
};

const KIND_BADGE: Record<SchedulingKind, string> = {
  fixed: 'border-ide-muted/35 bg-ide-muted/10 text-ide-muted',
  flexible: 'border-ide-link/35 bg-ide-link/10 text-ide-link',
  recurring: 'border-ide-accent/35 bg-ide-accent/10 text-ide-accent',
  habit: 'border-ide-keyword/35 bg-ide-keyword/10 text-ide-keyword',
  unscheduled: 'border-ide-warn/35 bg-ide-warn/10 text-ide-warn',
};

const cardBase =
  'group relative flex min-w-0 items-center gap-1.5 overflow-hidden rounded-lg border px-2 py-1.5 shadow-ide transition duration-200 ease-out hover:-translate-y-px hover:shadow-ide-md';

function kindForBlock(block: NowBlock): SchedulingKind {
  if (block.event) {
    return schedulingKindForEvent({
      event: block.event,
      task: block.task,
      isHabit: false,
    });
  }
  if (block.task) {
    if (block.task.isUnscheduled) return 'unscheduled';
    if (block.task.isRecurring) return 'recurring';
    if (block.task.eventType === 'fixed') return 'fixed';
    return 'flexible';
  }
  return 'flexible';
}

function KindBadge({ kind, title }: { kind: SchedulingKind; title: string }) {
  return (
    <span
      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${KIND_BADGE[kind]}`}
      title={title}
      aria-label={title}
    >
      <KindIcon kind={kind} className="h-3.5 w-3.5" />
    </span>
  );
}

export type NowStripProps = {
  /**
   * When the calendar page already loaded a range that covers today,
   * reuse those events instead of a second /calendar-providers/events call.
   */
  sharedEvents?: GoogleCalendarEvent[];
  skipEventsFetch?: boolean;
  onEditTask?: (task: TaskDTO) => void;
  onScheduleTask?: (task: TaskDTO) => void;
  onOpenPreview?: (event: GoogleCalendarEvent) => void;
  /** Google event ids that belong to day reminders and stay off the clock. */
  hiddenEventIds?: Set<string>;
};

function previewEventForBlock(block: NowBlock): GoogleCalendarEvent | null {
  if (block.event) return block.event;
  if (block.task) {
    return previewEventFromTask(block.task, {
      startMs: block.startMs,
      endMs: block.endMs,
    });
  }
  return null;
}

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

function ColumnHeader({
  tone,
  label,
  count,
}: {
  tone: StripTone;
  label: string;
  count?: number;
}) {
  const { t } = useTranslation();
  const { header } = TONE[tone];
  return (
    <div className={`flex items-center gap-1.5 ${header}`}>
      {tone === 'inbox' ? (
        <KindBadge kind="unscheduled" title={t(KIND_I18N_KEY.unscheduled)} />
      ) : null}
      <p className="min-w-0 truncate text-xs font-medium uppercase tracking-wide">{label}</p>
      {count != null && count > 0 ? (
        <span className="ml-auto shrink-0 text-xs font-normal normal-case tracking-normal opacity-70">
          {count}
        </span>
      ) : null}
    </div>
  );
}

function BlockRow({
  tone,
  label,
  block,
  timeZone,
  empty,
  onDone,
  onSkip,
  onOpenPreview,
  busyId,
}: {
  tone: StripTone;
  label: string;
  block: NowBlock | null;
  timeZone: string;
  empty: string;
  onDone: (block: NowBlock) => void;
  onSkip: (block: NowBlock) => void;
  onOpenPreview?: (event: GoogleCalendarEvent) => void;
  busyId: string | null;
}) {
  const { t } = useTranslation();
  const showDone = !!(block && canCompleteNowBlock(block));
  const showSkip = !!(block && canSkipNowBlock(block) && block.task);
  const rowBusyId = block?.task?.id ?? null;
  const toneStyle = TONE[tone];
  const kind = block ? kindForBlock(block) : null;
  const previewEvent = block ? previewEventForBlock(block) : null;
  const openPreview = () => {
    if (previewEvent && onOpenPreview) onOpenPreview(previewEvent);
  };
  return (
    <div
      className={`flex min-h-0 min-w-0 flex-col rounded-lg border px-3 py-2.5 ${toneStyle.column}`}
    >
      <ColumnHeader tone={tone} label={label} />
      {block && kind ? (
        <div
          role={onOpenPreview && previewEvent ? 'button' : undefined}
          tabIndex={onOpenPreview && previewEvent ? 0 : undefined}
          data-testid="now-strip-card"
          className={`${cardBase} mt-1.5 ${toneStyle.card} ${
            onOpenPreview && previewEvent ? 'cursor-pointer' : ''
          }`}
          onClick={openPreview}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              openPreview();
            }
          }}
        >
          <KindBadge kind={kind} title={t(KIND_I18N_KEY[kind])} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ide-text">{block.title}</p>
            <p className="text-xs text-ide-muted">{formatRange(block, timeZone)}</p>
          </div>
          {showDone || showSkip ? (
            <StripActions>
              {showSkip && block.task ? (
                <button
                  type="button"
                  className={stripIconBtn}
                  disabled={busyId === block.task.id}
                  aria-label={t('common.skip')}
                  title={t('common.skip')}
                  onClick={() => onSkip(block)}
                >
                  <SkipForward className="h-3.5 w-3.5" aria-hidden />
                </button>
              ) : null}
              {showDone ? (
                <button
                  type="button"
                  className={stripIconBtn}
                  disabled={!!rowBusyId && busyId === rowBusyId}
                  aria-label={t('common.done')}
                  title={t('common.done')}
                  onClick={() => onDone(block)}
                >
                  <Check className="h-3.5 w-3.5" aria-hidden />
                </button>
              ) : null}
            </StripActions>
          ) : null}
        </div>
      ) : (
        <p className="mt-1.5 text-sm text-ide-muted">{empty}</p>
      )}
    </div>
  );
}

export function NowStrip({
  sharedEvents,
  skipEventsFetch = false,
  onEditTask,
  onScheduleTask,
  onOpenPreview,
  hiddenEventIds,
}: NowStripProps = {}) {
  const { t } = useTranslation();
  const nowMs = useNowMs();
  const { data: settings } = useGetUserSettingsQuery();
  const timeZone = resolveIanaTimeZone(settings?.timeZone);
  const ctx = useMemo(
    () => todayNowContext(new Date(nowMs).toISOString(), timeZone),
    [nowMs, timeZone],
  );
  const { data: todayEvents } = useGetEventsQuery(
    {
      timeMin: ctx.fetchTimeMin,
      timeMax: ctx.fetchTimeMax,
    },
    { skip: skipEventsFetch },
  );
  const events = (skipEventsFetch
    ? (sharedEvents ?? [])
    : (todayEvents?.events ?? sharedEvents ?? [])
  ).filter((event) => !hiddenEventIds?.has(event.id));
  const { data: tasks = [] } = useGetTasksQuery();
  const [updateTask] = useUpdateEventMutation();
  const [skipOccurrence] = useSkipOccurrenceMutation();
  const [busyId, setBusyId] = useState<string | null>(null);

  const canActOnInbox = (task: TaskDTO) =>
    !task.isRecurring &&
    !task.isFixedExternal &&
    task.status !== 'completed' &&
    task.status !== 'canceled';

  const blocks = useMemo(
    () => buildNowBlocks(events, tasks, ctx.todayYmd, ctx.timeZone),
    [events, tasks, ctx.todayYmd, ctx.timeZone],
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

  const markDone = async (block: NowBlock) => {
    const task = block.task;
    if (!task) return;
    setBusyId(task.id);
    try {
      // Progress toast from eventTasksApi.updateEvent.
      await updateTask({ id: task.id, body: { status: 'completed' } }).unwrap();
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
      // Progress toast from eventTasksApi.skipOccurrence.
      await skipOccurrence({
        id: task.id,
        body: {
          occurrenceStart: new Date(block.startMs).toISOString(),
          googleEventId: block.event?.id,
          googleEventCalendarId: block.event?.calendarId,
        },
      }).unwrap();
    } catch (err) {
      showErrorToast({
        title: t('now.skipFailed'),
        detail: extractApiErrorMessage(err),
      });
    } finally {
      setBusyId(null);
    }
  };

  const markInboxDone = async (task: TaskDTO) => {
    if (!canActOnInbox(task)) return;
    setBusyId(task.id);
    try {
      await updateTask({ id: task.id, body: { status: 'completed' } }).unwrap();
    } catch (err) {
      showErrorToast({
        title: t('tasks.completeFailed'),
        detail: extractApiErrorMessage(err),
      });
    } finally {
      setBusyId(null);
    }
  };

  const markInboxSkip = async (task: TaskDTO) => {
    if (!canActOnInbox(task)) return;
    setBusyId(task.id);
    try {
      await updateTask({ id: task.id, body: { status: 'canceled' } }).unwrap();
    } catch (err) {
      showErrorToast({
        title: t('tasks.skipFailed'),
        detail: extractApiErrorMessage(err),
      });
    } finally {
      setBusyId(null);
    }
  };

  const doNowInbox = async (task: TaskDTO) => {
    if (!canActOnInbox(task)) return;
    setBusyId(task.id);
    try {
      await updateTask({ id: task.id, body: buildDoNowPatch(timeZone) }).unwrap();
    } catch (err) {
      showErrorToast({
        title: t('tasks.doNowFailed'),
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
          tone="now"
          label={t('now.label')}
          block={now}
          timeZone={ctx.timeZone}
          empty={t('now.nothingInProgress')}
          onDone={(block) => void markDone(block)}
          onSkip={markSkip}
          onOpenPreview={onOpenPreview}
          busyId={busyId}
        />
        <BlockRow
          tone="next"
          label={t('now.next')}
          block={next}
          timeZone={ctx.timeZone}
          empty={t('now.nothingElseToday')}
          onDone={(block) => void markDone(block)}
          onSkip={markSkip}
          onOpenPreview={onOpenPreview}
          busyId={busyId}
        />
        <div
          className={`flex min-h-0 min-w-0 flex-col rounded-lg border px-3 py-2.5 ${TONE.inbox.column}`}
        >
          <ColumnHeader tone="inbox" label={t('now.unscheduled')} count={inbox.length} />
          {inbox.length ? (
            <ul className="mt-1.5 max-h-48 space-y-1.5 overflow-y-auto overscroll-contain pr-0.5">
              {inbox.map((task) => {
                const busy = busyId === task.id;
                const actions = canActOnInbox(task);
                const openInboxPreview = () => {
                  if (onOpenPreview) onOpenPreview(previewEventFromTask(task));
                };
                return (
                  <li key={task.id} className="min-w-0">
                    <div
                      role={onOpenPreview ? 'button' : undefined}
                      tabIndex={onOpenPreview ? 0 : undefined}
                      className={`${cardBase} ${TONE.inbox.card} ${
                        onOpenPreview ? 'cursor-pointer' : ''
                      }`}
                      onClick={openInboxPreview}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openInboxPreview();
                        }
                      }}
                    >
                      <KindBadge
                        kind="unscheduled"
                        title={t(KIND_I18N_KEY.unscheduled)}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm text-ide-text" title={task.name}>
                        {task.name}
                      </span>
                      {actions ? (
                        <StripActions>
                          <button
                            type="button"
                            className={stripIconBtn}
                            disabled={busy}
                            aria-label={t('common.done')}
                            title={t('common.done')}
                            onClick={() => void markInboxDone(task)}
                          >
                            <Check className="h-3.5 w-3.5" aria-hidden />
                          </button>
                          <button
                            type="button"
                            className={stripIconBtn}
                            disabled={busy}
                            aria-label={t('tasks.item.skip')}
                            title={t('tasks.item.skip')}
                            onClick={() => void markInboxSkip(task)}
                          >
                            <SkipForward className="h-3.5 w-3.5" aria-hidden />
                          </button>
                          <button
                            type="button"
                            className={stripIconPrimary}
                            disabled={busy}
                            aria-label={t('tasks.item.doNow')}
                            title={t('tasks.item.doNow')}
                            onClick={() => void doNowInbox(task)}
                          >
                            <Zap className="h-3.5 w-3.5" aria-hidden />
                          </button>
                          {onScheduleTask ? (
                            <button
                              type="button"
                              className={stripIconPrimary}
                              disabled={busy}
                              aria-label={t('tasks.item.schedule')}
                              title={t('tasks.item.schedule')}
                              onClick={() => onScheduleTask(task)}
                            >
                              <CalendarPlus className="h-3.5 w-3.5" aria-hidden />
                            </button>
                          ) : null}
                          {onEditTask ? (
                            <button
                              type="button"
                              className={stripIconBtn}
                              disabled={busy}
                              aria-label={t('common.edit')}
                              title={t('common.edit')}
                              onClick={() => onEditTask(task)}
                            >
                              <Pencil className="h-3.5 w-3.5" aria-hidden />
                            </button>
                          ) : null}
                        </StripActions>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-1.5 text-sm text-ide-muted">{t('now.noInbox')}</p>
          )}
        </div>
      </div>
      {emptyClock ? (
        <p className="text-xs text-ide-muted">{t('now.emptyClock')}</p>
      ) : null}
        </>
      )}
    </section>
  );
}
