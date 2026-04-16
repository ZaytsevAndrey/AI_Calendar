import React from 'react';
import { TaskDTO } from '../../../api/tasks.api';

interface EventItemProps {
  event: TaskDTO;
  onEdit: (event: TaskDTO) => void;
  onDelete: (eventId: string) => void;
  onStatusChange: (eventId: string, status: 'todo' | 'in_progress' | 'completed' | 'canceled') => void;
}

const priorityColors = {
  low: '#8bc34a',
  medium: '#03a9f4',
  high: '#ff9800',
  urgent: '#f44336'
};

const statusLabels = {
  todo: 'To Do',
  in_progress: 'In Progress',
  completed: 'Completed',
  canceled: 'Canceled'
};

const EventItem: React.FC<EventItemProps> = ({ event, onEdit, onDelete, onStatusChange }) => {
  const handleStatusChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onStatusChange(event.id, e.target.value as 'todo' | 'in_progress' | 'completed' | 'canceled');
  };

  const formatDate = (dateString: string | undefined) => {
    if (!dateString) return 'No deadline';
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  return (
    <div className="task-item">
      <div className="task-header">
        <div
          className="task-priority"
          style={{ backgroundColor: priorityColors[event.priority] }}
        />
        <h3 className="task-name">{event.name}</h3>
        {event.phase && (
          <span className="task-phase" style={{ color: event.phase.color || '#000' }}>
            {event.phase.name}
          </span>
        )}
      </div>

      {event.description && (
        <p className="task-description">{event.description}</p>
      )}

      <div className="task-details">
        <div className="task-detail">
          <span className="detail-label">Estimated Time:</span>
          <span className="detail-value">{event.estimatedTimeInMinutes} minutes</span>
        </div>

        {event.deadline && (
          <div className="task-detail">
            <span className="detail-label">Deadline:</span>
            <span className={`detail-value ${new Date(event.deadline) < new Date() ? 'overdue' : ''}`}>
              {formatDate(event.deadline)}
            </span>
          </div>
        )}

        <div className="task-detail">
          <span className="detail-label">Status:</span>
          <select
            value={event.status}
            onChange={handleStatusChange}
            className={`status-selector ${event.status}`}
          >
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="task-actions">
        <button onClick={() => onEdit(event)} className="edit-button">
          Edit
        </button>
        <button onClick={() => onDelete(event.id)} className="delete-button">
          Delete
        </button>
      </div>
    </div>
  );
};

export default EventItem;
