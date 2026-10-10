import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Repeat, Trash2 } from 'lucide-react';
import { TaskDTO } from '../../../api/tasks.api';
import type { SeriesMemberKind } from '../utils/groupTasksBySeriesGroup';
import EventItem from './EventItem';

interface SeriesGroupRowProps {
  title: string;
  members: Array<{ task: TaskDTO; memberKind: SeriesMemberKind }>;
  onEdit: (event: TaskDTO) => void;
  onDelete: (eventId: string) => void;
  onDeleteGroup: (ids: string[], name: string) => void;
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

const SeriesGroupRow: React.FC<SeriesGroupRowProps> = ({
  title,
  members,
  onEdit,
  onDelete,
  onDeleteGroup,
  onDone,
  onSchedule,
  onSkip,
  onDoNow,
  openLabel,
  busyId,
}) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const primary = members[0]?.task;
  const color = primary ? priorityColors[primary.priority] : priorityColors.medium;
  const countLabel = t('tasks.group.memberCount', { count: members.length });
  const toggleLabel = expanded ? t('tasks.group.collapse') : t('tasks.group.expand');
  const deleteLabel = t('tasks.group.deleteAll');
  const groupBusy = members.some((m) => busyId === m.task.id);

  return (
    <div
      className="task-series-group overflow-hidden rounded-xl border border-ide-border border-l-4 shadow-ide"
      style={{
        borderLeftColor: color,
        backgroundColor: '#3C3F41',
        backgroundImage: `linear-gradient(135deg, ${color}28, ${color}10 46%, transparent)`,
      }}
    >
      <div className="flex items-center gap-2 px-3 py-2.5 sm:px-4">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left hover:opacity-90"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          aria-label={toggleLabel}
        >
          <span className="shrink-0 text-ide-muted" aria-hidden>
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </span>
          <h3 className="line-clamp-1 min-w-0 text-base font-semibold leading-snug text-ide-text">
            {title}
          </h3>
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-ide-link/40 bg-ide-link/15 px-2 py-0.5 text-xs font-medium text-ide-link"
            title={t('tasks.item.repeats')}
          >
            <Repeat className="h-3 w-3" aria-hidden />
            {countLabel}
          </span>
        </button>
        <button
          type="button"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-ide-error/80 hover:bg-white/10 hover:text-ide-error disabled:opacity-50"
          onClick={() => onDeleteGroup(
            members.map((m) => m.task.id),
            title,
          )}
          disabled={groupBusy}
          aria-label={deleteLabel}
          title={deleteLabel}
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {expanded ? (
        <div className="space-y-1.5 border-t border-white/10 px-2.5 pb-2.5 pt-2 sm:pl-6">
          {members.map(({ task, memberKind }) => (
            <EventItem
              key={task.id}
              event={task}
              nested
              memberKind={memberKind}
              onEdit={onEdit}
              onDelete={onDelete}
              onDone={onDone}
              onSchedule={onSchedule}
              onSkip={onSkip}
              onDoNow={onDoNow}
              openLabel={openLabel}
              busyId={busyId}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
};

export default SeriesGroupRow;
