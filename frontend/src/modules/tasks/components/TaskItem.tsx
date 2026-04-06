import React from 'react';
import { TaskDTO } from '../../../api/tasks.api';

interface TaskItemProps {
  task: TaskDTO;
  onEdit: (task: TaskDTO) => void;
  onDelete: (taskId: string) => void;
  onStatusChange: (taskId: string, status: 'todo' | 'in_progress' | 'completed' | 'canceled') => void;
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

const TaskItem: React.FC<TaskItemProps> = ({ task, onEdit, onDelete, onStatusChange }) => {
  const handleStatusChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onStatusChange(task.id, e.target.value as 'todo' | 'in_progress' | 'completed' | 'canceled');
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
          style={{ backgroundColor: priorityColors[task.priority] }}
        />
        <h3 className="task-name">{task.name}</h3>
        {task.phase && (
          <span className="task-phase" style={{ color: task.phase.color || '#000' }}>
            {task.phase.name}
          </span>
        )}
      </div>
      
      {task.description && (
        <p className="task-description">{task.description}</p>
      )}
      
      <div className="task-details">
        <div className="task-detail">
          <span className="detail-label">Estimated Time:</span>
          <span className="detail-value">{task.estimatedTimeInMinutes} minutes</span>
        </div>
        
        {task.deadline && (
          <div className="task-detail">
            <span className="detail-label">Deadline:</span>
            <span className={`detail-value ${new Date(task.deadline) < new Date() ? 'overdue' : ''}`}>
              {formatDate(task.deadline)}
            </span>
          </div>
        )}
        
        <div className="task-detail">
          <span className="detail-label">Status:</span>
          <select 
            value={task.status} 
            onChange={handleStatusChange}
            className={`status-selector ${task.status}`}
          >
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
      </div>
      
      <div className="task-actions">
        <button onClick={() => onEdit(task)} className="edit-button">
          Edit
        </button>
        <button onClick={() => onDelete(task.id)} className="delete-button">
          Delete
        </button>
      </div>
    </div>
  );
};

export default TaskItem; 