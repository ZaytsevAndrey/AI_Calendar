import React from 'react';
import { TaskDTO } from '../../../api/tasks.api';
import { formatDateTime, formatMinutes } from '../../../utils/formatDate';

interface EventItemProps {
  event: TaskDTO;
  onEdit: (event: TaskDTO) => void;
  onDelete: (eventId: string) => void;
}

const priorityColors = {
  low: '#8bc34a',
  medium: '#03a9f4',
  high: '#ff9800',
  urgent: '#f44336',
};

const statusLabels = {
  todo: 'To Do',
  in_progress: 'In Progress',
  completed: 'Completed',
  canceled: 'Canceled',
};

const statusClass = {
  todo: 'border-ide-keyword text-ide-keyword',
  in_progress: 'border-ide-link text-ide-link',
  completed: 'border-ide-dim text-ide-muted',
  canceled: 'border-ide-muted text-ide-muted',
};

const EventItem: React.FC<EventItemProps> = ({ event, onEdit, onDelete }) => {
  const deadline = formatDateTime(event.deadline);
  const overdue = event.deadline ? new Date(event.deadline) < new Date() && event.status !== 'completed' : false;

  return (
    <div className="task-item">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="h-3 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: priorityColors[event.priority] }}
              title={event.priority}
            />
            <h3 className="min-w-0 text-lg font-semibold text-ide-text">{event.name}</h3>
            {event.phase ? (
              <span className="task-phase" style={{ color: event.phase.color || undefined }}>
                {event.phase.name}
              </span>
            ) : null}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ide-muted">
            <span
              className={`inline-flex rounded border px-2 py-0.5 text-xs ${statusClass[event.status]}`}
            >
              {statusLabels[event.status]}
            </span>
            <span className="capitalize">{event.priority}</span>
            {deadline ? (
              <span className={overdue ? 'font-medium text-ide-error' : ''}>
                {overdue ? 'Overdue · ' : ''}
                {deadline}
              </span>
            ) : (
              <span>No deadline</span>
            )}
            <span>{formatMinutes(event.estimatedTimeInMinutes)}</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={() => onEdit(event)} className="edit-button">
            Edit
          </button>
          <button type="button" onClick={() => onDelete(event.id)} className="delete-button">
            Delete
          </button>
        </div>
      </div>
    </div>
  );
};

export default EventItem;
