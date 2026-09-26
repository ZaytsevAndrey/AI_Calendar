import React from 'react';
import { CalendarPlus, Check, Pencil, Trash2 } from 'lucide-react';
import { TaskDTO } from '../../../api/tasks.api';
import { formatDateTime, formatDateTimeRange, formatMinutes } from '../../../utils/formatDate';
import { deadlineTone, deadlineToneLabel } from '../utils/deadlineTone';

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

const priorityLabels = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

const statusLabels = {
  todo: 'To Do',
  in_progress: 'In Progress',
  completed: 'Completed',
  canceled: 'Canceled',
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
  const deadline = formatDateTime(event.deadline);
  const from = formatDateTime(event.earliestStartTime);
  const slot = formatDateTimeRange(event.scheduledStartTime, event.scheduledEndTime);
  const tone = event.status === 'completed' ? 'none' : deadlineTone(event.deadline);
  const unscheduled = !!event.isUnscheduled;
  const busy = busyId === event.id;
  const color = priorityColors[event.priority];
  const when = slot || (!unscheduled && from && deadline ? `${from} – ${deadline}` : null);
  const dueText =
    deadline && (!when || tone !== 'none')
      ? `${deadlineToneLabel(tone)}${deadline}`
      : !deadline && from && !when
        ? `From ${from}`
        : null;

  const actions = (
    <>
      {onDone ? (
        <>
          <button type="button" onClick={() => onDone(event)} className={`${iconBtn} md:hidden`} disabled={busy} aria-label="Done">
            <Check className="h-4 w-4" aria-hidden />
          </button>
          <button type="button" onClick={() => onDone(event)} className="ui-btn-secondary hidden px-3 py-1.5 text-sm md:inline-flex" disabled={busy}>
            Done
          </button>
        </>
      ) : null}
      {onSchedule ? (
        <>
          <button type="button" onClick={() => onSchedule(event)} className={`${iconBtn} text-ide-link md:hidden`} disabled={busy} aria-label="Schedule">
            <CalendarPlus className="h-4 w-4" aria-hidden />
          </button>
          <button type="button" onClick={() => onSchedule(event)} className="ui-btn-primary hidden px-3 py-1.5 text-sm md:inline-flex" disabled={busy}>
            Schedule
          </button>
        </>
      ) : null}
      <button type="button" onClick={() => onEdit(event)} className={`${iconBtn} md:hidden`} aria-label="Edit">
        <Pencil className="h-4 w-4" aria-hidden />
      </button>
      <button type="button" onClick={() => onEdit(event)} className="ui-btn-secondary hidden px-3 py-1.5 text-sm md:inline-flex">
        Edit
      </button>
      <button type="button" onClick={() => onDelete(event.id)} className={`${iconBtn} text-ide-error/80 hover:text-ide-error md:hidden`} aria-label="Delete">
        <Trash2 className="h-4 w-4" aria-hidden />
      </button>
      <button type="button" onClick={() => onDelete(event.id)} className="ui-btn-danger hidden px-3 py-1.5 text-sm md:inline-flex">
        Delete
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
        <span className="sr-only">{event.priority} priority</span>
        <Pill style={{ borderColor: `${color}88`, backgroundColor: `${color}24`, color }}>
          {priorityLabels[event.priority]}
        </Pill>
        <Pill className={statusPill[event.status]}>{statusLabels[event.status]}</Pill>
        {unscheduled ? (
          <Pill className="border-ide-warn/50 bg-ide-warn/15 text-ide-warn">Unscheduled</Pill>
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
          <Pill className="border-ide-link/40 bg-ide-link/15 text-ide-link">Repeats</Pill>
        ) : null}
        {when ? <Pill className={tonePill.none}>{when}</Pill> : null}
        {dueText ? <Pill className={tonePill[tone]}>{dueText}</Pill> : null}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-white/10 pt-3 md:hidden">{actions}</div>
    </div>
  );
};

export default EventItem;
