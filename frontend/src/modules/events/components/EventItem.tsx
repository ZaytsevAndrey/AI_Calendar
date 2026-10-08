import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlarmClock,
  CalendarClock,
  CalendarPlus,
  Check,
  CircleDot,
  ExternalLink,
  Inbox,
  Pencil,
  Repeat,
  SkipForward,
  Trash2,
  Zap,
} from 'lucide-react';
import { TaskDTO } from '../../../api/tasks.api';
import { formatDateTime, formatDateTimeRange, formatMinutes } from '../../../utils/formatDate';
import { buildUnscheduledIconMeta } from '../unscheduledCardMeta';
import { deadlineTone } from '../utils/deadlineTone';

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
  canceled: 'border-ide-border bg-white/5 text-ide-muted',
};

const tonePill = {
  overdue: 'border-ide-error/50 bg-ide-error/20 text-ide-error',
  today: 'border-ide-warn/50 bg-ide-warn/20 text-ide-warn',
  soon: 'border-ide-warn/40 bg-ide-warn/15 text-ide-warn',
  none: 'border-white/10 bg-white/5 text-ide-text',
};

const toneIcon = {
  overdue: 'border-ide-error/50 bg-ide-error/20 text-ide-error',
  today: 'border-ide-warn/50 bg-ide-warn/20 text-ide-warn',
  soon: 'border-ide-warn/40 bg-ide-warn/15 text-ide-warn',
  none: 'border-white/10 bg-white/5 text-ide-text',
  phase: 'border-white/10 bg-white/5 text-ide-text',
};

const pill = 'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium leading-none';

const iconBtn =
  'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-ide-text hover:bg-white/10 disabled:opacity-50';

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
}) => {
  const { t } = useTranslation();
  const deadline = formatDateTime(event.deadline);
  const from = formatDateTime(event.earliestStartTime);
  const slot = formatDateTimeRange(event.scheduledStartTime, event.scheduledEndTime);
  const tone = event.status === 'completed' ? 'none' : deadlineTone(event.deadline);
  const unscheduled = !!event.isUnscheduled;
  const busy = busyId === event.id;
  const color = priorityColors[event.priority];
  const when = slot || (!unscheduled && from && deadline ? `${from} – ${deadline}` : null);
  const editLabel = openLabel || t('common.edit');
  const EditIcon = openLabel ? ExternalLink : Pencil;
  const overdue = unscheduled && tone === 'overdue';

  const tonePrefix =
    tone === 'overdue'
      ? t('tasks.item.overduePrefix')
      : tone === 'today'
        ? t('tasks.item.dueSoonPrefix')
        : tone === 'soon'
          ? t('tasks.item.approachingPrefix')
          : '';

  const dueText =
    deadline && (!when || tone !== 'none')
      ? `${tonePrefix}${deadline}`
      : !deadline && from && !when
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
        deadlineFormatted: deadline,
        tone,
        fromLabel: (time) => t('tasks.item.from', { time }),
        dueLabel: (whenDue) => t('tasks.item.due', { when: whenDue }),
        overduePrefix: t('tasks.item.overduePrefix'),
        dueSoonPrefix: t('tasks.item.dueSoonPrefix'),
        approachingPrefix: t('tasks.item.approachingPrefix'),
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

  return (
    <div
      className={`task-item flex flex-col gap-3 border-l-4 ${overdue ? 'ring-1 ring-ide-error/40' : ''}`}
      style={{
        borderLeftColor: overdue ? '#f44336' : color,
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
            const Icon =
              meta.id === 'phase' ? CircleDot : meta.id === 'earliest' ? CalendarClock : AlarmClock;
            const className =
              meta.id === 'phase'
                ? iconMetaBtn
                : `${iconMetaBtn} ${toneIcon[meta.tone === 'phase' ? 'none' : meta.tone]}`;
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
          <Pill className="border-white/10 bg-white/5 text-ide-text">
            {formatMinutes(event.estimatedTimeInMinutes)}
          </Pill>
          {event.isRecurring ? (
            <Pill className="border-ide-link/40 bg-ide-link/15 text-ide-link">{t('tasks.item.repeats')}</Pill>
          ) : null}
          {when ? <Pill className={tonePill.none}>{when}</Pill> : null}
          {dueText ? <Pill className={tonePill[tone]}>{dueText}</Pill> : null}
        </div>
      )}

      {unscheduled ? null : (
        <div className="flex items-center justify-end gap-2 border-t border-white/10 pt-3 md:hidden">{actions}</div>
      )}
    </div>
  );
};

export default EventItem;
