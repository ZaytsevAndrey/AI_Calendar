import React, { useState } from 'react';
import { TaskDTO } from '../../../api/tasks.api';
import EventItem from './EventItem';

interface EventListProps {
  events: TaskDTO[];
  onEdit: (event: TaskDTO) => void;
  onDelete: (eventId: string) => void;
  onStatusChange: (eventId: string, status: 'todo' | 'in_progress' | 'completed' | 'canceled') => void;
  onSort: (field: 'name' | 'priority' | 'deadline' | 'estimatedTimeInMinutes') => void;
  isLoading: boolean;
}

const EventList: React.FC<EventListProps> = ({
  events,
  onEdit,
  onDelete,
  onStatusChange,
  onSort,
  isLoading
}) => {
  const [sortField, setSortField] = useState<string>('deadline');

  const handleSort = (field: 'name' | 'priority' | 'deadline' | 'estimatedTimeInMinutes') => {
    setSortField(field);
    onSort(field);
  };

  if (isLoading) {
    return <div className="loading">Loading events...</div>;
  }

  if (events.length === 0) {
    return <div className="empty-list">No events found. Add a new event to get started.</div>;
  }

  return (
    <div className="task-list">
      <div className="task-list-header">
        <button
          className="list-header-item"
          onClick={() => handleSort('name')}
          type="button"
        >
          Event Name {sortField === 'name' && '↓'}
        </button>
        <button
          className="list-header-item"
          onClick={() => handleSort('priority')}
          type="button"
        >
          Priority {sortField === 'priority' && '↓'}
        </button>
        <button
          className="list-header-item"
          onClick={() => handleSort('deadline')}
          type="button"
        >
          Deadline {sortField === 'deadline' && '↓'}
        </button>
        <button
          className="list-header-item"
          onClick={() => handleSort('estimatedTimeInMinutes')}
          type="button"
        >
          Estimated Time {sortField === 'estimatedTimeInMinutes' && '↓'}
        </button>
      </div>

      {events.map((event) => (
        <EventItem
          key={event.id}
          event={event}
          onEdit={onEdit}
          onDelete={onDelete}
          onStatusChange={onStatusChange}
        />
      ))}
    </div>
  );
};

export default EventList;
