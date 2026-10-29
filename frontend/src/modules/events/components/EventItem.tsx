import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  CalendarClock,
  CalendarPlus,
  Check,
  CircleDot,
  ExternalLink,
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
import { buildUnscheduledIconMeta } from '../unscheduledCardMeta';
import type { SeriesMemberKind } from '../utils/groupTasksBySeriesGroup';

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

const priorityColors = {
  low: '#8bc34a',
  medium: '#03a9f4',
  high: '#ff9800',
  urgent: '#f44336',
};

const statusPill = {
  todo: 'border-ide-keyword/50 bg-ide-keyword/15 text-ide-keyword',
  in_progress: 'border-ide-link/50 bg-ide-link/20 text-ide-link',
  completed: 'border-ide-accent/50 bg-ide-accent/20 text-ide-accent',
  canceled: 'border-ide-border bg-ide-text/5 text-ide-muted',
};

const plainPill = 'border-ide-text/10 bg-ide-text/5 text-ide-text';

const pill = 'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium leading-none';

const iconBtn =
  'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-ide-text/10 bg-ide-text/5 text-ide-text hover:bg-ide-text/10 disabled:opacity-50';

const iconMetaBtn =
  'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border';

function Pill({
  className,
  style,
  children,
}: {
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <span className={`${pill} ${className ?? ''}`} style={style}>
      {children}
    </span>
  );
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
  const until = formatDateTime(event.deadline);
  const from = formatDateTime(event.earliestStartTime);
  const slot = formatDateTimeRange(event.scheduledStartTime, event.scheduledEndTime);
  const unscheduled = !!event.isUnscheduled;
  const busy = busyId === event.id;
  const color = priorityColors[event.priority];
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
  const statusLabel =
    event.status === 'todo'
      ? t('tasks.status.todo')
      : event.status === 'in_progress'
        ? t('tasks.status.inProgress')
        : event.status === 'completed'
          ? t('tasks.status.completed')
          : t('tasks.status.canceled');

  const unscheduledMeta = unscheduled
    ? buildUnscheduledIconMeta({
        phaseName: event.phase?.name,
        phaseColor: event.phase?.color,
        earliestFormatted: from,
        fromLabel: (time) => t('tasks.item.from', { time }),
      })
    : [];

  const iconAction = (
    label: string,
    onClick: () => void,
    icon: React.ReactNode,
    className = '',
  ) => (
    <button
      type="button"
      onClick={onClick}
      className={`${iconBtn} ${className}`}
      disabled={busy}
      aria-label={label}
      title={label}
    >
      {icon}
    </button>
  );

  const textOrIcon = (
    label: string,
    onClick: () => void,
    icon: React.ReactNode,
    desktopClass: string,
    iconClass = '',
  ) =>
    unscheduled ? (
      iconAction(label, onClick, icon, iconClass)
    ) : (
      <>
        <button
          type="button"
          onClick={onClick}
          className={`${iconBtn} ${iconClass} md:hidden`}
          disabled={busy}
          aria-label={label}
        >
          {icon}
        </button>
        <button
          type="button"
          onClick={onClick}
          className={`${desktopClass} hidden px-3 py-1.5 text-sm md:inline-flex`}
          disabled={busy}
        >
          {label}
        </button>
      </>
    );

  const actions = (
    <>
      {onDone
        ? textOrIcon(t('tasks.item.done'), () => onDone(event), <Check className="h-4 w-4" aria-hidden />, 'ui-btn-secondary')
        : null}
      {onSkip
        ? textOrIcon(
            t('tasks.item.skip'),
            () => onSkip(event),
            <SkipForward className="h-4 w-4" aria-hidden />,
            'ui-btn-secondary',
          )
        : null}
      {onDoNow
        ? textOrIcon(
            t('tasks.item.doNow'),
            () => onDoNow(event),
            <Zap className="h-4 w-4" aria-hidden />,
            'ui-btn-primary',
            'text-ide-link',
          )
        : null}
      {onSchedule
        ? textOrIcon(
            t('tasks.item.schedule'),
            () => onSchedule(event),
            <CalendarPlus className="h-4 w-4" aria-hidden />,
            'ui-btn-primary',
            'text-ide-link',
          )
        : null}
      {textOrIcon(editLabel, () => onEdit(event), <EditIcon className="h-4 w-4" aria-hidden />, 'ui-btn-secondary')}
      {textOrIcon(
        t('common.delete'),
        () => onDelete(event.id),
        <Trash2 className="h-4 w-4" aria-hidden />,
        'ui-btn-danger',
        'text-ide-error/80 hover:text-ide-error',
      )}
    </>
  );

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
        className="flex items-center gap-2 rounded-lg border border-ide-text/10 px-2.5 py-1.5"
        style={{
          borderLeftWidth: 3,
          borderLeftColor: color,
          backgroundColor: '#35383A',
        }}
      >
        <span className="sr-only">{event.name}</span>
        {kindLabel ? (
          <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[11px] font-medium leading-none ${kindTone}`}>
            {kindLabel}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-xs text-ide-muted" title={summary || undefined}>
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

  return (
    <div
      className="task-item flex flex-col gap-3 border-l-4"
      style={{
        borderLeftColor: color,
        backgroundColor: '#3C3F41',
        backgroundImage: `linear-gradient(135deg, ${color}38, ${color}14 46%, transparent)`,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="line-clamp-2 min-w-0 flex-1 text-base font-semibold leading-snug text-ide-text sm:text-lg">
          {event.name}
        </h3>
        <div className={`shrink-0 items-center gap-2 ${unscheduled ? 'flex' : 'hidden md:flex'}`}>
          {actions}
        </div>
      </div>

      {unscheduled ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="sr-only">{t('tasks.item.prioritySr', { priority: event.priority })}</span>
          <span
            className={`${iconMetaBtn} border-ide-warn/50 bg-ide-warn/15 text-ide-warn`}
            title={t('tasks.item.unscheduled')}
            aria-label={t('tasks.item.unscheduled')}
          >
            <Inbox className="h-4 w-4" aria-hidden />
          </span>
          {unscheduledMeta.map((meta) => {
            const Icon = meta.id === 'phase' ? CircleDot : CalendarClock;
            const className = `${iconMetaBtn} ${plainPill}`;
            return (
              <span
                key={meta.id}
                className={className}
                style={
                  meta.id === 'phase'
                    ? {
                        borderColor: `${meta.color || '#808080'}88`,
                        backgroundColor: `${meta.color || '#808080'}24`,
                        color: meta.color || undefined,
                      }
                    : undefined
                }
                title={meta.label}
                aria-label={meta.label}
              >
                <Icon className="h-4 w-4" aria-hidden />
              </span>
            );
          })}
          {taskTraits(event).behavior === 'fixed' ? (
            <span
              className={`${iconMetaBtn} border-ide-muted/40 bg-ide-muted/10 text-ide-muted`}
              title={t('tasks.preset.fixed')}
              aria-label={t('tasks.preset.fixed')}
            >
              <Pin className="h-4 w-4" aria-hidden />
            </span>
          ) : null}
          {event.isRecurring ? (
            <span
              className={`${iconMetaBtn} border-ide-link/40 bg-ide-link/15 text-ide-link`}
              title={t('tasks.item.repeats')}
              aria-label={t('tasks.item.repeats')}
            >
              <Repeat className="h-4 w-4" aria-hidden />
            </span>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <span className="sr-only">{t('tasks.item.prioritySr', { priority: event.priority })}</span>
          <Pill style={{ borderColor: `${color}88`, backgroundColor: `${color}24`, color }}>
            {priorityLabel}
          </Pill>
          <Pill className={statusPill[event.status]}>{statusLabel}</Pill>
          {event.phase ? (
            <Pill
              style={{
                borderColor: `${event.phase.color || '#808080'}88`,
                backgroundColor: `${event.phase.color || '#808080'}24`,
                color: event.phase.color || undefined,
              }}
            >
              {event.phase.name}
            </Pill>
          ) : null}
          <Pill className="border-ide-text/10 bg-ide-text/5 text-ide-text">
            {formatMinutes(event.estimatedTimeInMinutes)}
          </Pill>
          {taskTraits(event).behavior === 'fixed' ? (
            <Pill className="border-ide-muted/40 bg-ide-muted/10 text-ide-muted">{t('tasks.preset.fixed')}</Pill>
          ) : null}
          {event.isRecurring ? (
            <Pill className="border-ide-link/40 bg-ide-link/15 text-ide-link">{t('tasks.item.repeats')}</Pill>
          ) : null}
          {when ? <Pill className={plainPill}>{when}</Pill> : null}
          {dueText ? <Pill className={plainPill}>{dueText}</Pill> : null}
        </div>
      )}

      {unscheduled ? null : (
        <div className="flex items-center justify-end gap-2 border-t border-ide-text/10 pt-3 md:hidden">{actions}</div>
      )}
    </div>
  );
};

export default EventItem;
