import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';
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

function pickHead(
  members: Array<{ task: TaskDTO; memberKind: SeriesMemberKind }>,
): { head: { task: TaskDTO; memberKind: SeriesMemberKind }; rest: typeof members } {
  const seriesIdx = members.findIndex((m) => m.memberKind === 'series');
  const idx = seriesIdx >= 0 ? seriesIdx : 0;
  const head = members[idx]!;
  const rest = members.filter((_, i) => i !== idx);
  return { head, rest };
}

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
  const { head, rest } = pickHead(members);
  const countLabel = t('tasks.group.memberCount', { count: members.length });
  const toggleLabel = expanded ? t('tasks.group.collapse') : t('tasks.group.expand');
  const deleteAllLabel = t('tasks.group.deleteAll');
  const groupBusy = members.some((m) => busyId === m.task.id);

  return (
    <div className="task-series-group space-y-1.5">
      {/* Head uses the same card as a lone task so series parents stay consistent. */}
      <EventItem
        event={head.task}
        onEdit={onEdit}
        onDelete={onDelete}
        onDone={onDone}
        onSchedule={onSchedule}
        onSkip={onSkip}
        onDoNow={onDoNow}
        openLabel={openLabel}
        busyId={busyId}
      />

      <div className="flex flex-wrap items-center gap-2 px-0.5">
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1 rounded-lg border border-ide-link/40 bg-ide-link/15 px-2.5 text-xs font-medium text-ide-link hover:bg-ide-link/25"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          aria-label={toggleLabel}
          title={title}
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          )}
          {countLabel}
        </button>
        <button
          type="button"
          className="text-xs text-ide-error/80 hover:text-ide-error hover:underline disabled:opacity-50"
          onClick={() =>
            onDeleteGroup(
              members.map((m) => m.task.id),
              title,
            )
          }
          disabled={groupBusy}
        >
          {deleteAllLabel}
        </button>
      </div>

      {expanded && rest.length > 0 ? (
        <div className="space-y-1.5 border-l-2 border-ide-border/80 pl-2 sm:pl-3">
          {rest.map(({ task, memberKind }) => (
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
