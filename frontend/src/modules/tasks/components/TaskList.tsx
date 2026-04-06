import React, { useState } from 'react';
import { TaskDTO } from '../../../api/tasks.api';
import TaskItem from './TaskItem';

interface TaskListProps {
  tasks: TaskDTO[];
  onEdit: (task: TaskDTO) => void;
  onDelete: (taskId: string) => void;
  onStatusChange: (taskId: string, status: 'todo' | 'in_progress' | 'completed' | 'canceled') => void;
  onSort: (field: 'name' | 'priority' | 'deadline' | 'estimatedTimeInMinutes') => void;
  isLoading: boolean;
}

const TaskList: React.FC<TaskListProps> = ({ 
  tasks, 
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
    return <div className="loading">Loading tasks...</div>;
  }

  if (tasks.length === 0) {
    return <div className="empty-list">No tasks found. Add a new task to get started.</div>;
  }

  return (
    <div className="task-list">
      <div className="task-list-header">
        <button 
          className="list-header-item" 
          onClick={() => handleSort('name')}
          type="button"
        >
          Task Name {sortField === 'name' && '↓'}
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

      {tasks.map(task => (
        <TaskItem
          key={task.id}
          task={task}
          onEdit={onEdit}
          onDelete={onDelete}
          onStatusChange={onStatusChange}
        />
      ))}
    </div>
  );
};

export default TaskList;
