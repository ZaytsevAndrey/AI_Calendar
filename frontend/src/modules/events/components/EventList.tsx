import React from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { Button } from 'ui/Button';
import { TaskDTO } from '../../../api/tasks.api';
import { groupTasksBySeriesGroup } from '../utils/groupTasksBySeriesGroup';
import EventItem from './EventItem';
import { ListSkeleton } from 'ui/ListSkeleton';
import SeriesGroupRow from './SeriesGroupRow';

interface EventListProps {
  events: TaskDTO[];
  onEdit: (event: TaskDTO) => void;
  onDelete: (eventId: string) => void;
  onDeleteGroup: (ids: string[], name: string) => void;
  onCreate: () => void;
  isLoading: boolean;
  onDone?: (event: TaskDTO) => void;
  onSchedule?: (event: TaskDTO) => void;
  onSkip?: (event: TaskDTO) => void;
  onDoNow?: (event: TaskDTO) => void;
  openLabel?: string;
  busyId?: string | null;
  emptyTitle?: string;
}

const EventList: React.FC<EventListProps> = ({
  events,
  onEdit,
  onDelete,
  onDeleteGroup,
  onCreate,
  isLoading,
  onDone,
  onSchedule,
  onSkip,
  onDoNow,
  openLabel,
  busyId,
  emptyTitle,
}) => {
  const { t } = useTranslation();

  if (isLoading) {
    return <ListSkeleton label={t('tasks.list.loading')} />;
  }

  if (events.length === 0) {
    return (
      <div className="rounded-control border border-dashed border-ide-border px-4 py-10 text-center">
        <p className="text-body-sm text-ide-muted">{emptyTitle || t('tasks.list.empty')}</p>
        <Button variant="secondary" icon={Plus} onClick={onCreate} className="mt-4">
          {t('tasks.list.createTask')}
        </Button>
      </div>
    );
  }

  const entries = groupTasksBySeriesGroup(events);

  return (
    <div className="task-list flex flex-col gap-2">
      {entries.map((entry) =>
        entry.kind === 'group' ? (
          <SeriesGroupRow
            key={`group-${entry.seriesGroupId}`}
            title={entry.title}
            members={entry.members}
            onEdit={onEdit}
            onDelete={onDelete}
            onDeleteGroup={onDeleteGroup}
            onDone={onDone}
            onSchedule={onSchedule}
            onSkip={onSkip}
            onDoNow={onDoNow}
            openLabel={openLabel}
            busyId={busyId}
          />
        ) : (
          <EventItem
            key={entry.task.id}
            event={entry.task}
            onEdit={onEdit}
            onDelete={onDelete}
            onDone={onDone}
            onSchedule={onSchedule}
            onSkip={onSkip}
            onDoNow={onDoNow}
            openLabel={openLabel}
            busyId={busyId}
          />
        ),
      )}
    </div>
  );
};

export default EventList;
