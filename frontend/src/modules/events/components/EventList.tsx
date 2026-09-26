import React from 'react';
import { TaskDTO } from '../../../api/tasks.api';
import EventItem from './EventItem';

interface EventListProps {
  events: TaskDTO[];
  onEdit: (event: TaskDTO) => void;
  onDelete: (eventId: string) => void;
  onCreate: () => void;
  isLoading: boolean;
  onDone?: (event: TaskDTO) => void;
  onSchedule?: (event: TaskDTO) => void;
  busyId?: string | null;
  emptyTitle?: string;
}

const EventList: React.FC<EventListProps> = ({
  events,
  onEdit,
  onDelete,
  onCreate,
  isLoading,
  onDone,
  onSchedule,
  busyId,
  emptyTitle,
}) => {
  if (isLoading) {
    return <div className="loading">Loading tasks…</div>;
  }

  if (events.length === 0) {
    return (
      <div className="empty-list">
        <p>{emptyTitle || 'No tasks found. Create one to get started.'}</p>
        <button type="button" onClick={onCreate} className="ui-btn-primary mt-4">
          Create task
        </button>
      </div>
    );
  }

  return (
    <div className="task-list space-y-4">
      {events.map((event) => (
        <EventItem
          key={event.id}
          event={event}
          onEdit={onEdit}
          onDelete={onDelete}
          onDone={onDone}
          onSchedule={onSchedule}
          busyId={busyId}
        />
      ))}
    </div>
  );
};

export default EventList;
