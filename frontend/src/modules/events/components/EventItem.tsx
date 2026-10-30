import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CalendarPlus,
  Check,
  ExternalLink,
  Flag,
  MoreHorizontal,
  Inbox,
  Pencil,
  Pin,
  Repeat,
  SkipForward,
  Trash2,
  Zap,
} from 'lucide-react';
import { TaskDTO } from '../../../api/tasks.api';
import { taskTraits } from '../../tasks/schedulingTraits';
import {
  formatDateTime,
  formatDateTimeRange,
  formatMinutes,
  formatSeriesSpanSummary,
} from '../../../utils/formatDate';
import type { SeriesMemberKind } from '../utils/groupTasksBySeriesGroup';
import { phaseColor } from 'theme/phasePalette';
import { ActionMenu, type ActionMenuItem } from 'ui/ActionMenu';
import { SwipeRow } from 'ui/SwipeRow';

interface EventItemProps {
  event: TaskDTO;
  onEdit: (event: TaskDTO) => void;
  onDelete: (eventId: string) => void;
  onDone?: (event: TaskDTO) => void;
  onSchedule?: (event: TaskDTO) => void;
  onSkip?: (event: TaskDTO) => void;
  onDoNow?: (event: TaskDTO) => void;
  openLabel?: string;
  busyId?: string | null;
  /** Nested under a series group — show kind instead of repeating the family name. */
  nested?: boolean;
  memberKind?: SeriesMemberKind;
}


const EventItem: React.FC<EventItemProps> = ({
  event,
  onEdit,
  onDelete,
  onDone,
  onSchedule,
  onSkip,
  onDoNow,
  openLabel,
  busyId,
  nested = false,
  memberKind,
}) => {
  const { t } = useTranslation();
  const moreRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const until = formatDateTime(event.deadline);
  const from = formatDateTime(event.earliestStartTime);
  const slot = formatDateTimeRange(event.scheduledStartTime, event.scheduledEndTime);
  const unscheduled = !!event.isUnscheduled;
  const busy = busyId === event.id;
  const when = slot || (!unscheduled && from && until ? `${from} – ${until}` : null);
  const editLabel = openLabel || t('common.edit');
  const EditIcon = openLabel ? ExternalLink : Pencil;
  const kindLabel =
    memberKind === 'series'
      ? t('tasks.group.kind.series')
      : memberKind === 'problematic'
        ? t('tasks.group.kind.problematic')
        : memberKind === 'oneOff'
          ? t('tasks.group.kind.oneOff')
          : null;
  const dueText = unscheduled
    ? null
    : !when && until
      ? t('tasks.item.until', { when: until })
      : !when && from
        ? t('tasks.item.from', { time: from })
        : null;

  const priorityLabel = t(`tasks.priority.${event.priority}`);
  if (nested) {
    const kindTone =
      memberKind === 'problematic'
        ? 'border-ide-error/50 bg-ide-error/20 text-ide-error'
        : memberKind === 'series'
          ? 'border-ide-link/40 bg-ide-link/15 text-ide-link'
          : 'border-ide-text/10 bg-ide-text/5 text-ide-muted';
    const compactBtn =
      'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-ide-text/10 bg-ide-text/5 text-ide-text hover:bg-ide-text/10 disabled:opacity-50';
    const summary =
      formatSeriesSpanSummary({
        seriesSpanStart: event.seriesSpanStart,
        seriesSpanEnd: event.seriesSpanEnd,
        scheduledStartTime: event.scheduledStartTime,
        isRecurring: event.isRecurring,
      }) ||
      when ||
      dueText ||
      formatMinutes(event.estimatedTimeInMinutes);
    const compactAction = (
      label: string,
      onClick: () => void,
      icon: React.ReactNode,
      className = compactBtn,
    ) => (
      <button
        type="button"
        onClick={onClick}
        className={className}
        disabled={busy}
        aria-label={label}
        title={label}
      >
        {icon}
      </button>
    );

    return (
      <div
        className="flex items-center gap-2 rounded-control border border-ide-border bg-ide-surface px-2.5 py-1.5"
        style={{
          boxShadow: `inset 3px 0 0 0 ${event.phase ? phaseColor(event.phase.color) : 'rgb(var(--ide-border))'}`,
        }}
      >
        <span className="sr-only">{event.name}</span>
        {kindLabel ? (
          <span className={`shrink-0 rounded-chip border px-1.5 py-0.5 text-caption font-medium leading-none ${kindTone}`}>
            {kindLabel}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-body-sm tabular-nums text-ide-muted" title={summary || undefined}>
          {summary || '—'}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {onDone
            ? compactAction(t('tasks.item.done'), () => onDone(event), <Check className="h-3.5 w-3.5" aria-hidden />)
            : null}
          {onSkip
            ? compactAction(
                t('tasks.item.skip'),
                () => onSkip(event),
                <SkipForward className="h-3.5 w-3.5" aria-hidden />,
              )
            : null}
          {onDoNow
            ? compactAction(
                t('tasks.item.doNow'),
                () => onDoNow(event),
                <Zap className="h-3.5 w-3.5" aria-hidden />,
                `${compactBtn} text-ide-link`,
              )
            : null}
          {onSchedule
            ? compactAction(
                t('tasks.item.schedule'),
                () => onSchedule(event),
                <CalendarPlus className="h-3.5 w-3.5" aria-hidden />,
                `${compactBtn} text-ide-link`,
              )
            : null}
          {compactAction(editLabel, () => onEdit(event), <EditIcon className="h-3.5 w-3.5" aria-hidden />)}
          {compactAction(
            t('common.delete'),
            () => onDelete(event.id),
            <Trash2 className="h-3.5 w-3.5" aria-hidden />,
            `${compactBtn} text-ide-error/80 hover:text-ide-error`,
          )}
        </div>
      </div>
    );
  }

  const traits = taskTraits(event);
  const overdue =
    !!event.deadline &&
    Date.parse(event.deadline) < Date.now() &&
    event.status !== 'completed' &&
    event.status !== 'canceled';
  const metaParts: React.ReactNode[] = [];
  if (!unscheduled && when) metaParts.push(<span key="when">{when}</span>);
  if (!unscheduled && dueText) metaParts.push(<span key="due">{dueText}</span>);
  if (unscheduled && from) metaParts.push(<span key="from">{t('tasks.item.from', { time: from })}</span>);
  if (event.estimatedTimeInMinutes) metaParts.push(<span key="dur">{formatMinutes(event.estimatedTimeInMinutes)}</span>);
  if (event.phase) {
    metaParts.push(
      <span key="phase" className="inline-flex items-center gap-1">
        <span
          aria-hidden
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: phaseColor(event.phase.color) }}
        />
        {event.phase.name}
      </span>,
    );
  }
  if (overdue && event.deadline) {
    metaParts.push(
      <span key="overdue" className="text-ide-error">
        {t('tasks.item.overdueUntil', { when: until })}
      </span>,
    );
  }
  const done = event.status === 'completed';
  const flagged = event.priority === 'high' || event.priority === 'urgent';
  const KindGlyph = unscheduled ? Inbox : traits.behavior === 'fixed' ? Pin : null;

  const hoverBtn =
    'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ide-muted transition hover:bg-ide-surface hover:text-ide-text disabled:opacity-50';
  const iconOnly = (label: string, onClick: () => void, Icon: typeof Check, tone = '') => (
    <button type="button" className={`${hoverBtn} ${tone}`} disabled={busy} aria-label={label} title={label} onClick={onClick}>
      <Icon className="h-4 w-4" aria-hidden />
    </button>
  );

  const menuItems: ActionMenuItem[] = [
    ...(onDone ? [{ id: 'done', label: t('tasks.item.done'), icon: Check, onSelect: () => onDone(event) }] : []),
    ...(onDoNow ? [{ id: 'now', label: t('tasks.item.doNow'), icon: Zap, onSelect: () => onDoNow(event) }] : []),
    ...(onSchedule && !unscheduled ? [{ id: 'schedule', label: t('tasks.item.schedule'), icon: CalendarPlus, onSelect: () => onSchedule(event) }] : []),
    ...(onSkip ? [{ id: 'skip', label: t('tasks.item.skip'), icon: SkipForward, onSelect: () => onSkip(event) }] : []),
    { id: 'edit', label: editLabel, icon: EditIcon, onSelect: () => onEdit(event) },
    { id: 'delete', label: t('common.delete'), icon: Trash2, danger: true, onSelect: () => onDelete(event.id) },
  ];

  return (
    <SwipeRow
      disabled={busy}
      start={onDone ? { label: t('tasks.item.done'), icon: Check, tone: 'success', onTrigger: () => onDone(event) } : undefined}
      end={
        onSkip
          ? { label: t('tasks.item.skip'), icon: SkipForward, tone: 'warning', onTrigger: () => onSkip(event) }
          : { label: t('common.delete'), icon: Trash2, tone: 'danger', onTrigger: () => onDelete(event.id) }
      }
    >
      <div
        className={`task-item group relative flex min-h-[56px] items-center gap-1 overflow-hidden rounded-control border border-ide-border bg-ide-panel py-1 pl-2 pr-1 transition-colors hover:border-ide-text/20 ${
          done ? 'opacity-70' : ''
        }`}
      >
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-[3px]"
          style={{ backgroundColor: event.phase ? phaseColor(event.phase.color) : 'rgb(var(--ide-border))' }}
        />
        <span className="sr-only">{t('tasks.item.prioritySr', { priority: priorityLabel })}</span>
        {onDone ? (
          <button
            type="button"
            className="group/done inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ide-muted transition hover:text-ide-accent disabled:opacity-50 md:h-9 md:w-9"
            disabled={busy}
            aria-label={t('tasks.item.done')}
            title={t('tasks.item.done')}
            onClick={() => onDone(event)}
          >
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border-[1.5px] border-current">
              <Check className="h-3 w-3 opacity-0 transition-opacity group-hover/done:opacity-100" aria-hidden />
            </span>
          </button>
        ) : (
          <span className="w-2 shrink-0" />
        )}
        <div className="min-w-0 flex-1 py-1">
          <h3 className="flex min-w-0 items-start gap-1.5">
            <button
              type="button"
              onClick={() => onEdit(event)}
              className={`line-clamp-2 text-left text-body font-medium leading-snug text-ide-text hover:underline ${
                done ? 'text-ide-muted line-through decoration-ide-muted/60' : ''
              }`}
            >
              {event.name}
            </button>
          </h3>
          <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-body-sm tabular-nums text-ide-muted">
            {KindGlyph ? (
              <span
                className="inline-flex"
                aria-label={unscheduled ? t('tasks.item.unscheduled') : t('tasks.preset.fixed')}
                title={unscheduled ? t('tasks.item.unscheduled') : t('tasks.preset.fixed')}
              >
                <KindGlyph className="h-3.5 w-3.5" aria-hidden />
              </span>
            ) : null}
            {event.isRecurring ? (
              <span className="inline-flex" aria-label={t('tasks.item.repeats')} title={t('tasks.item.repeats')}>
                <Repeat className="h-3.5 w-3.5" aria-hidden />
              </span>
            ) : null}
            {metaParts.map((part, index) => (
              <React.Fragment key={index}>
                {index > 0 ? <span aria-hidden>·</span> : null}
                {part}
              </React.Fragment>
            ))}
          </p>
        </div>
        {flagged ? (
          <span
            className={`inline-flex shrink-0 px-1 ${event.priority === 'urgent' ? 'text-ide-error' : 'text-ide-warn'}`}
            aria-label={priorityLabel}
            title={priorityLabel}
          >
            <Flag className="h-4 w-4" aria-hidden />
          </span>
        ) : null}
        {onSchedule && unscheduled ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onSchedule(event)}
            className="inline-flex h-9 shrink-0 items-center rounded-full border border-ide-border px-3 text-body-sm font-medium text-ide-link transition hover:bg-ide-surface disabled:opacity-50 md:h-8"
          >
            {t('tasks.item.schedule')}
          </button>
        ) : null}
        <div className="hidden shrink-0 items-center gap-0.5 transition-opacity md:flex md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
          {onDoNow ? iconOnly(t('tasks.item.doNow'), () => onDoNow(event), Zap, 'text-ide-link') : null}
          {onSchedule && !unscheduled ? iconOnly(t('tasks.item.schedule'), () => onSchedule(event), CalendarPlus, 'text-ide-link') : null}
          {onSkip ? iconOnly(t('tasks.item.skip'), () => onSkip(event), SkipForward) : null}
          {iconOnly(editLabel, () => onEdit(event), EditIcon)}
          {iconOnly(t('common.delete'), () => onDelete(event.id), Trash2, 'hover:text-ide-error')}
        </div>
        <button
          ref={moreRef}
          type="button"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-ide-muted hover:bg-ide-surface hover:text-ide-text md:hidden"
          aria-label={t('common.moreActions')}
          aria-haspopup="menu"
          onClick={() => setMenuOpen(true)}
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden />
        </button>
        <ActionMenu open={menuOpen} onClose={() => setMenuOpen(false)} anchorRef={moreRef} title={event.name} items={menuItems} />
      </div>
    </SwipeRow>
  );
};

export default EventItem;
