import React from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarPlus, Check, Pencil, Trash2 } from 'lucide-react';
import { TaskDTO } from '../../../api/tasks.api';
import { formatDateTime, formatDateTimeRange, formatMinutes } from '../../../utils/formatDate';
import { deadlineTone } from '../utils/deadlineTone';

interface EventItemProps {
  event: TaskDTO;
  onEdit: (event: TaskDTO) => void;
  onDelete: (eventId: string) => void;
  onDone?: (event: TaskDTO) => void;
  onSchedule?: (event: TaskDTO) => void;
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

const pill = 'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium leading-none';

const iconBtn =
  'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-ide-text hover:bg-white/10 disabled:opacity-50';

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

  const actions = (
    <>
      {onDone ? (
        <>
          <button type="button" onClick={() => onDone(event)} className={`${iconBtn} md:hidden`} disabled={busy} aria-label={t('tasks.item.done')}>
            <Check className="h-4 w-4" aria-hidden />
          </button>
          <button type="button" onClick={() => onDone(event)} className="ui-btn-secondary hidden px-3 py-1.5 text-sm md:inline-flex" disabled={busy}>
            {t('tasks.item.done')}
          </button>
        </>
      ) : null}
      {onSchedule ? (
        <>
          <button type="button" onClick={() => onSchedule(event)} className={`${iconBtn} text-ide-link md:hidden`} disabled={busy} aria-label={t('tasks.item.schedule')}>
            <CalendarPlus className="h-4 w-4" aria-hidden />
          </button>
          <button type="button" onClick={() => onSchedule(event)} className="ui-btn-primary hidden px-3 py-1.5 text-sm md:inline-flex" disabled={busy}>
            {t('tasks.item.schedule')}
          </button>
        </>
      ) : null}
      <button type="button" onClick={() => onEdit(event)} className={`${iconBtn} md:hidden`} aria-label={t('common.edit')}>
        <Pencil className="h-4 w-4" aria-hidden />
      </button>
      <button type="button" onClick={() => onEdit(event)} className="ui-btn-secondary hidden px-3 py-1.5 text-sm md:inline-flex">
        {t('common.edit')}
      </button>
      <button type="button" onClick={() => onDelete(event.id)} className={`${iconBtn} text-ide-error/80 hover:text-ide-error md:hidden`} aria-label={t('common.delete')}>
        <Trash2 className="h-4 w-4" aria-hidden />
      </button>
      <button type="button" onClick={() => onDelete(event.id)} className="ui-btn-danger hidden px-3 py-1.5 text-sm md:inline-flex">
        {t('common.delete')}
      </button>
    </>
  );

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
        <div className="hidden shrink-0 items-center gap-2 md:flex">{actions}</div>
      </div>

      <div className="flex flex-wrap gap-2">
        <span className="sr-only">{t('tasks.item.prioritySr', { priority: event.priority })}</span>
        <Pill style={{ borderColor: `${color}88`, backgroundColor: `${color}24`, color }}>
          {priorityLabel}
        </Pill>
        <Pill className={statusPill[event.status]}>{statusLabel}</Pill>
        {unscheduled ? (
          <Pill className="border-ide-warn/50 bg-ide-warn/15 text-ide-warn">{t('tasks.item.unscheduled')}</Pill>
        ) : null}
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
        {!unscheduled ? (
          <Pill className="border-white/10 bg-white/5 text-ide-text">
            {formatMinutes(event.estimatedTimeInMinutes)}
          </Pill>
        ) : null}
        {event.isRecurring ? (
          <Pill className="border-ide-link/40 bg-ide-link/15 text-ide-link">{t('tasks.item.repeats')}</Pill>
        ) : null}
        {when ? <Pill className={tonePill.none}>{when}</Pill> : null}
        {dueText ? <Pill className={tonePill[tone]}>{dueText}</Pill> : null}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-white/10 pt-3 md:hidden">{actions}</div>
    </div>
  );
};

export default EventItem;
