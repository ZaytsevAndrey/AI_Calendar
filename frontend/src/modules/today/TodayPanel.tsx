import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  Bell,
  CalendarPlus,
  Check,
  Inbox,
  MoreHorizontal,
  Pencil,
  SkipForward,
  Zap,
} from 'lucide-react';
import type { GoogleCalendarEvent } from 'api/google-calendar.api';
import type { TaskDTO } from 'api/tasks.api';
import type { DayReminderDTO } from 'api/dayReminders.api';
import { previewEventFromTask } from 'modules/calendar/completedTaskEvents';
import { KindIcon, KIND_I18N_KEY } from 'modules/calendar/kindIcons';
import { schedulingKindForEvent, type SchedulingKind } from 'modules/calendar/schedulingKind';
import { taskTraits } from 'modules/tasks/schedulingTraits';
import { ReminderList } from 'modules/day-reminders/ReminderList';
import { canCompleteNowBlock, canSkipNowBlock, type NowBlock } from 'modules/now/nowBlocks';
import { ActionMenu } from 'ui/ActionMenu';
import { Button } from 'ui/Button';
import { cx } from 'ui/cx';
import { formatDurationShort } from 'ui/durationLabel';
import { formatCivilYmd } from 'utils/formatDate';
import { localYmd } from 'utils/ianaDateTime';
import { blockEnd, blockRange, blockStart, canActOnLater, type TodayState } from './useToday';

export type TodaySectionId = 'now' | 'problems' | 'reminders' | 'later';

export const todaySectionDomId = (id: TodaySectionId) => `today-${id}`;

type Props = {
  today: TodayState;
  problematicTasks: TaskDTO[];
  onOpenProblematic: () => void;
  onOpenPreview?: (event: GoogleCalendarEvent) => void;
  onEditTask?: (task: TaskDTO) => void;
  onScheduleTask?: (task: TaskDTO) => void;
  onEditReminder: (reminder: DayReminderDTO) => void;
  className?: string;
};

function kindForBlock(block: NowBlock): SchedulingKind {
  if (block.event) return schedulingKindForEvent({ event: block.event, task: block.task, isHabit: false });
  if (block.task) {
    const traits = taskTraits(block.task);
    return traits.unscheduled ? 'unscheduled' : traits.behavior;
  }
  return 'flexible';
}

function previewEventForBlock(block: NowBlock): GoogleCalendarEvent | null {
  if (block.event) return block.event;
  if (block.task) return previewEventFromTask(block.task, { startMs: block.startMs, endMs: block.endMs });
  return null;
}

function SectionHeader({
  icon: Icon,
  title,
  count,
  tone = 'muted',
}: {
  icon: typeof Bell;
  title: string;
  count?: number;
  tone?: 'muted' | 'warning';
}) {
  return (
    <h3
      className={cx(
        'mb-2 flex items-center gap-1.5 text-body-sm font-medium',
        tone === 'warning' ? 'text-ide-warn' : 'text-ide-muted',
      )}
    >
      <Icon className="h-4 w-4" aria-hidden />
      {title}
      {count ? <span className="ml-auto tabular-nums">{count}</span> : null}
    </h3>
  );
}

const iconBtn =
  'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-ide-muted transition hover:bg-ide-elevated hover:text-ide-text disabled:opacity-50 md:h-8 md:w-8';

/** «Сьогодні»: now / next, problematic, reminders, later. The desktop side panel and the phone sheet share it. */
export function TodayPanel({
  today,
  problematicTasks,
  onOpenProblematic,
  onOpenPreview,
  onEditTask,
  onScheduleTask,
  onEditReminder,
  className,
}: Props) {
  const { t } = useTranslation();
  const { now, next, later, timeZone, busyId } = today;

  return (
    <div className={cx('flex flex-col gap-5', className)}>
      <section id={todaySectionDomId('now')} aria-label={t('now.label')}>
        {now ? (
          <NowCard block={now} today={today} onOpenPreview={onOpenPreview} />
        ) : (
          <div className="rounded-control border border-dashed border-ide-border px-3 py-3 text-body-sm text-ide-muted">
            {t('now.nothingInProgress')}
          </div>
        )}
        {next ? (
          <NextRow block={next} today={today} onOpenPreview={onOpenPreview} />
        ) : now ? null : (
          <p className="mt-2 px-1 text-body-sm text-ide-muted">{t('now.nothingElseToday')}</p>
        )}
      </section>

      {problematicTasks.length > 0 ? (
        <section id={todaySectionDomId('problems')}>
          <SectionHeader
            icon={AlertTriangle}
            tone="warning"
            title={t('schedule.problematicTitle')}
            count={problematicTasks.length}
          />
          <div className="rounded-control border border-ide-warn/40 bg-ide-warnTint p-3">
            <ul className="mb-2 flex flex-col gap-1">
              {problematicTasks.slice(0, 3).map((task) => (
                <li key={task.id} className="truncate text-body text-ide-text">
                  {task.name}
                </li>
              ))}
              {problematicTasks.length > 3 ? (
                <li className="text-body-sm text-ide-muted">
                  {t('common.andMore', { count: problematicTasks.length - 3 })}
                </li>
              ) : null}
            </ul>
            <p className="mb-3 text-body-sm text-ide-muted">{t('schedule.problematicLead')}</p>
            <Button variant="secondary" size={{ base: 'md', md: 'sm' }} onClick={onOpenProblematic} className="w-full">
              {t('schedule.problematicReview')}
            </Button>
          </div>
        </section>
      ) : null}

      {today.dueReminders.length > 0 ? (
        <section id={todaySectionDomId('reminders')}>
          <SectionHeader icon={Bell} title={t('dayReminders.title')} count={today.dueReminders.length} />
          <ReminderList scope="due" headless onEdit={onEditReminder} />
        </section>
      ) : null}

      <section id={todaySectionDomId('later')}>
        <SectionHeader icon={Inbox} title={t('now.unscheduled')} count={later.length} />
        {later.length ? (
          <ul className="flex flex-col gap-1">
            {later.map((task) => (
              <LaterRow
                key={task.id}
                task={task}
                timeZone={timeZone}
                busy={busyId === task.id}
                today={today}
                onOpenPreview={onOpenPreview}
                onEditTask={onEditTask}
                onScheduleTask={onScheduleTask}
              />
            ))}
          </ul>
        ) : (
          <p className="px-1 text-body-sm text-ide-muted">{t('now.noInbox')}</p>
        )}
      </section>
    </div>
  );
}

function NowCard({
  block,
  today,
  onOpenPreview,
}: {
  block: NowBlock;
  today: TodayState;
  onOpenPreview?: (event: GoogleCalendarEvent) => void;
}) {
  const { t } = useTranslation();
  const kind = kindForBlock(block);
  const preview = previewEventForBlock(block);
  const span = Math.max(1, block.endMs - block.startMs);
  const progress = block.allDay ? null : Math.min(1, Math.max(0, (today.nowMs - block.startMs) / span));
  const showDone = canCompleteNowBlock(block);
  const showSkip = canSkipNowBlock(block) && !!block.task;
  const busy = !!block.task && today.busyId === block.task.id;
  const open = () => preview && onOpenPreview?.(preview);
  return (
    <div
      data-testid="now-strip-card"
      className="rounded-control border border-ide-accent/30 bg-ide-successTint p-3"
    >
      <p className="mb-1 flex items-center gap-1.5 text-caption font-medium uppercase tracking-wide text-ide-accent">
        <span className="h-1.5 w-1.5 rounded-full bg-ide-accent motion-safe:animate-pulse" aria-hidden />
        {t('now.label')}
      </p>
      <button type="button" className="block w-full min-w-0 text-left" onClick={open} disabled={!preview || !onOpenPreview}>
        <span className="flex items-start gap-1.5">
          <span className="mt-0.5 text-ide-muted" title={t(KIND_I18N_KEY[kind])}>
            <KindIcon kind={kind} className="h-4 w-4" />
          </span>
          <span className="line-clamp-2 min-w-0 text-heading font-semibold text-ide-text">{block.title}</span>
        </span>
        <span className="mt-0.5 block text-body-sm tabular-nums text-ide-muted">
          {block.allDay
            ? t('common.allDay')
            : t('now.until', { time: blockEnd(block, today.timeZone), range: blockRange(block, today.timeZone) })}
        </span>
      </button>
      {progress != null ? (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-ide-border" aria-hidden>
          <div className="h-full rounded-full bg-ide-accent" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      ) : null}
      {showDone || showSkip ? (
        <div className="mt-3 flex gap-2">
          {showDone && block.task ? (
            <Button
              size={{ base: 'md', md: 'sm' }}
              variant="secondary"
              icon={Check}
              disabled={busy}
              className="flex-1"
              onClick={() => void today.complete(block.task!)}
            >
              {t('now.markDone')}
            </Button>
          ) : null}
          {showSkip ? (
            <Button
              size={{ base: 'md', md: 'sm' }}
              variant="ghost"
              icon={SkipForward}
              disabled={busy}
              aria-label={t('common.skip')}
              onClick={() => void today.skipBlock(block)}
            >
              {t('common.skip')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function NextRow({
  block,
  today,
  onOpenPreview,
}: {
  block: NowBlock;
  today: TodayState;
  onOpenPreview?: (event: GoogleCalendarEvent) => void;
}) {
  const { t } = useTranslation();
  const preview = previewEventForBlock(block);
  const showSkip = canSkipNowBlock(block) && !!block.task;
  const busy = !!block.task && today.busyId === block.task.id;
  return (
    <div data-testid="now-strip-card" className="mt-2 flex min-w-0 items-center gap-1 rounded-control bg-ide-surface pl-3">
      <button
        type="button"
        className="min-w-0 flex-1 py-2 text-left"
        onClick={() => preview && onOpenPreview?.(preview)}
        disabled={!preview || !onOpenPreview}
      >
        <span className="block text-caption text-ide-muted">
          {block.allDay ? t('now.next') : t('now.nextAt', { time: blockStart(block, today.timeZone) })}
        </span>
        <span className="block truncate text-body text-ide-text">{block.title}</span>
      </button>
      {showSkip ? (
        <button
          type="button"
          className={iconBtn}
          disabled={busy}
          aria-label={t('common.skip')}
          title={t('common.skip')}
          onClick={() => void today.skipBlock(block)}
        >
          <SkipForward className="h-4 w-4" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

function LaterRow({
  task,
  timeZone,
  busy,
  today,
  onOpenPreview,
  onEditTask,
  onScheduleTask,
}: {
  task: TaskDTO;
  timeZone: string;
  busy: boolean;
  today: TodayState;
  onOpenPreview?: (event: GoogleCalendarEvent) => void;
  onEditTask?: (task: TaskDTO) => void;
  onScheduleTask?: (task: TaskDTO) => void;
}) {
  const { t } = useTranslation();
  const moreRef = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState(false);
  const actions = canActOnLater(task);
  const meta = [
    task.estimatedTimeInMinutes ? formatDurationShort(task.estimatedTimeInMinutes, t) : null,
    task.deadline
      ? t('tasks.item.due', { when: formatCivilYmd(localYmd(task.deadline, timeZone)) ?? '' })
      : null,
  ].filter(Boolean);
  return (
    <li className="flex min-w-0 items-center gap-1 rounded-control bg-ide-surface pl-3">
      <button
        type="button"
        className="min-w-0 flex-1 py-2 text-left"
        onClick={() => onOpenPreview?.(previewEventFromTask(task))}
      >
        <span className="line-clamp-2 text-body text-ide-text">{task.name}</span>
        {meta.length ? (
          <span className="block truncate text-caption tabular-nums text-ide-muted">{meta.join(' · ')}</span>
        ) : null}
      </button>
      {actions && onScheduleTask ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => onScheduleTask(task)}
          className="inline-flex h-9 shrink-0 items-center rounded-full border border-ide-border px-3 text-body-sm font-medium text-ide-link transition hover:bg-ide-elevated disabled:opacity-50 md:h-7 md:px-2.5"
        >
          {t('tasks.item.schedule')}
        </button>
      ) : null}
      {actions ? (
        <>
          <button
            ref={moreRef}
            type="button"
            className={iconBtn}
            disabled={busy}
            aria-label={t('common.moreActions')}
            aria-haspopup="menu"
            onClick={() => setMenu(true)}
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden />
          </button>
          <ActionMenu
            open={menu}
            onClose={() => setMenu(false)}
            anchorRef={moreRef}
            title={task.name}
            items={[
              { id: 'done', label: t('now.markDone'), icon: Check, onSelect: () => void today.complete(task) },
              { id: 'now', label: t('tasks.item.doNow'), icon: Zap, onSelect: () => void today.doNow(task) },
              ...(onScheduleTask
                ? [{ id: 'schedule', label: t('tasks.item.schedule'), icon: CalendarPlus, onSelect: () => onScheduleTask(task) }]
                : []),
              ...(onEditTask ? [{ id: 'edit', label: t('common.edit'), icon: Pencil, onSelect: () => onEditTask(task) }] : []),
              { id: 'skip', label: t('tasks.item.skip'), icon: SkipForward, onSelect: () => void today.skipLater(task) },
            ]}
          />
        </>
      ) : null}
    </li>
  );
}
