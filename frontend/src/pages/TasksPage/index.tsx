import React, { useState } from 'react';
import { useGetTasksQuery, useCreateTaskMutation, useUpdateTaskMutation, useDeleteTaskMutation } from 'api/tasksApi';
import { useGetAllPhasesQuery } from 'api/phasesApi';
import TaskList from 'modules/tasks/components/TaskList';
import TaskForm from 'modules/tasks/components/TaskForm';
import './styles.scss';
import { TaskDTO } from 'api/tasks.api';
import { CreateTaskDTO, UpdateTaskDTO } from 'api/tasks.api';

type Priority = 'urgent' | 'high' | 'medium' | 'low';

const TasksPage: React.FC = () => {
  const [isCreating, setIsCreating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [currentTask, setCurrentTask] = useState<TaskDTO | null>(null);
  const [sortField, setSortField] = useState<'name' | 'priority' | 'deadline' | 'estimatedTimeInMinutes'>('deadline');
  const [filterStatus, setFilterStatus] = useState<string>('');

  // Fetch tasks
  const { data: tasks = [], isLoading: isLoadingTasks } = useGetTasksQuery();

  // Fetch phases
  const { data: phases = [] } = useGetAllPhasesQuery();

  // Create task mutation
  const [createTask, createTaskState] = useCreateTaskMutation();
  // Update task mutation
  const [updateTask, updateTaskState] = useUpdateTaskMutation();
  // Delete task mutation
  const [deleteTask, deleteTaskState] = useDeleteTaskMutation();

  // Sort tasks
  const sortedTasks = [...tasks].sort((a, b) => {
    switch (sortField) {
      case 'name': {
        return a.name.localeCompare(b.name);
      }
      case 'priority': {
        const priorityOrder: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      }
      case 'deadline': {
        if (!a.deadline && !b.deadline) return 0;
        if (!a.deadline) return 1;
        if (!b.deadline) return -1;
        return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
      }
      case 'estimatedTimeInMinutes': {
        return a.estimatedTimeInMinutes - b.estimatedTimeInMinutes;
      }
      default: {
        return 0;
      }
    }
  });

  // Combined handler for both create and update
  const handleSubmitTask = (data: CreateTaskDTO | UpdateTaskDTO) => {
    const cleanData = { ...data };
    if ((cleanData as any).phaseId === '') {
      delete (cleanData as any).phaseId;
    }
    if (isCreating) {
      createTask(cleanData as CreateTaskDTO);
      setIsCreating(false);
    } else if (currentTask) {
      updateTask({ id: currentTask.id, body: cleanData as UpdateTaskDTO });
      setIsEditing(false);
      setCurrentTask(null);
    }
  };

  const handleEditTask = (task: TaskDTO) => {
    setCurrentTask(task);
    setIsEditing(true);
    setIsCreating(false);
  };

  const handleDeleteTask = (id: string) => {
    if (window.confirm('Are you sure you want to delete this task?')) {
      deleteTask(id);
    }
  };

  const handleSort = (field: 'name' | 'priority' | 'deadline' | 'estimatedTimeInMinutes') => {
    setSortField(field);
  };

  const handleFilterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setFilterStatus(e.target.value);
  };

  // Filter by status
  const filteredTasks = filterStatus ? sortedTasks.filter(task => task.status === filterStatus) : sortedTasks;

  return (
    <div className="tasks-page">
      <header className="page-header">
        <h1>Tasks</h1>
        <div className="header-actions">
          <button 
            onClick={() => { 
              setIsCreating(!isCreating); 
              setIsEditing(false);
              setCurrentTask(null);
            }}
            className="primary-button"
          >
            {isCreating ? 'Cancel' : 'Create Task'}
          </button>
        </div>
      </header>

      <div className="filter-container">
        <label htmlFor="statusFilter">Filter by Status:</label>
        <select 
          id="statusFilter" 
          value={filterStatus} 
          onChange={handleFilterChange}
          className="status-filter"
        >
          <option value="">All Tasks</option>
          <option value="todo">To Do</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
          <option value="canceled">Canceled</option>
        </select>
      </div>

      {(isCreating || isEditing) && (
        <div className="form-container">
          <h2>{isCreating ? 'Create New Task' : 'Edit Task'}</h2>
          <TaskForm
            initialData={currentTask || undefined}
            phases={phases}
            onSubmit={handleSubmitTask}
            isSubmitting={createTaskState.isLoading || updateTaskState.isLoading}
          />
        </div>
      )}

      <div className="tasks-container">
        <TaskList
          tasks={filteredTasks}
          onEdit={handleEditTask}
          onDelete={handleDeleteTask}
          onStatusChange={() => {}}
          onSort={handleSort}
          isLoading={isLoadingTasks || deleteTaskState.isLoading}
        />
      </div>
    </div>
  );
};

export default TasksPage; 