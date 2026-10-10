import React from 'react';
import { useTranslation } from 'react-i18next';
import { TaskDTO } from '../../../api/tasks.api';
import { groupTasksBySeriesGroup } from '../utils/groupTasksBySeriesGroup';
import EventItem from './EventItem';
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
    return <div className="loading">{t('tasks.list.loading')}</div>;
  }

  if (events.length === 0) {
    return (
      <div className="empty-list">
        <p>{emptyTitle || t('tasks.list.empty')}</p>
        <button type="button" onClick={onCreate} className="ui-btn-primary mt-4">
          {t('tasks.list.createTask')}
        </button>
      </div>
    );
  }

  const entries = groupTasksBySeriesGroup(events);

  return (
    <div className="task-list space-y-4">
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
