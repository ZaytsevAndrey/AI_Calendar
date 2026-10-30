import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Bell, ChevronUp, Inbox } from 'lucide-react';
import { cx } from 'ui/cx';
import { blockEnd, blockStart, type TodayState } from './useToday';
import type { TodaySectionId } from './TodayPanel';

type Props = {
  today: TodayState;
  problematicCount: number;
  onOpen: (section?: TodaySectionId) => void;
};

function Pill({
  icon: Icon,
  count,
  tone,
  label,
  onClick,
  motionTarget,
}: {
  icon: typeof Bell;
  count: number;
  tone: 'neutral' | 'warning' | 'danger';
  label: string;
  onClick: () => void;
  /** Cards parked or moved to «На потім» fly into this counter. */
  motionTarget?: 'problems' | 'later';
}) {
  return (
    <button
      type="button"
      aria-label={label}
      data-motion-target={motionTarget}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={cx(
        'inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-body-sm font-medium tabular-nums',
        tone === 'danger' && 'bg-ide-errorTint text-ide-error',
        tone === 'warning' && 'bg-ide-warnTint text-ide-warn',
        tone === 'neutral' && 'bg-ide-surface text-ide-muted',
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {count}
    </button>
  );
}

/** Phone: one 44 px line above the grid — what is on now plus counters. Tap opens the «Сьогодні» sheet. */
export function TodayBar({ today, problematicCount, onOpen }: Props) {
  const { t } = useTranslation();
  const { now, next, later, dueReminders, overdueReminders, timeZone } = today;
  const summary = now
    ? { dot: true, lead: t('now.label'), text: now.title, tail: now.allDay ? '' : t('now.until', { time: blockEnd(now, timeZone) }) }
    : next
      ? { dot: false, lead: next.allDay ? t('now.next') : t('now.nextAt', { time: blockStart(next, timeZone) }), text: next.title, tail: '' }
      : { dot: false, lead: '', text: t('now.nothingInProgress'), tail: '' };

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid="today-bar"
      data-motion-target="today"
      aria-label={t('today.open')}
      onClick={() => onOpen()}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
      className="flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-control border border-ide-border bg-ide-panel px-3 active:bg-ide-surface"
    >
      {summary.dot ? <span className="h-2 w-2 shrink-0 rounded-full bg-ide-accent" aria-hidden /> : null}
      <span className="min-w-0 flex-1 truncate text-body-sm">
        {summary.lead ? <span className="text-ide-muted">{summary.lead} · </span> : null}
        <span className="text-ide-text">{summary.text}</span>
        {summary.tail ? <span className="tabular-nums text-ide-muted"> · {summary.tail}</span> : null}
      </span>
      {problematicCount > 0 ? (
        <Pill
          icon={AlertTriangle}
          count={problematicCount}
          tone="warning"
          label={t('schedule.problematicChip', { count: problematicCount })}
          onClick={() => onOpen('problems')}
          motionTarget="problems"
        />
      ) : null}
      {dueReminders.length > 0 ? (
        <Pill
          icon={Bell}
          count={dueReminders.length}
          tone={overdueReminders.length ? 'danger' : 'neutral'}
          label={t('today.remindersCount', { count: dueReminders.length })}
          onClick={() => onOpen('reminders')}
        />
      ) : null}
      {later.length > 0 ? (
        <Pill
          icon={Inbox}
          count={later.length}
          tone="neutral"
          label={t('today.laterCount', { count: later.length })}
          onClick={() => onOpen('later')}
          motionTarget="later"
        />
      ) : null}
      <ChevronUp className="h-4 w-4 shrink-0 text-ide-muted" aria-hidden />
    </div>
  );
}
