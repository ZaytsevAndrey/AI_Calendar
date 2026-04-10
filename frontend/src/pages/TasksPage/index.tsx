import React, { useState } from 'react';
import { useGetTasksQuery, useCreateTaskMutation, useUpdateTaskMutation, useDeleteTaskMutation } from 'api/tasksApi';
import { useGetAllPhasesQuery } from 'api/phasesApi';
import TaskList from 'modules/tasks/components/TaskList';
import TaskForm from 'modules/tasks/components/TaskForm';
import { TaskDTO } from 'api/tasks.api';
import { CreateTaskDTO, UpdateTaskDTO } from 'api/tasks.api';

type Priority = 'urgent' | 'high' | 'medium' | 'low';

const TasksPage: React.FC = () => {
    const [isCreating, setIsCreating] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [currentTask, setCurrentTask] = useState<TaskDTO | null>(null);
    const [sortField, setSortField] = useState<
        'name' | 'priority' | 'deadline' | 'estimatedTimeInMinutes'
    >('deadline');
    const [filterStatus, setFilterStatus] = useState<string>('');

    const { data: tasks = [], isLoading: isLoadingTasks } = useGetTasksQuery();
    const { data: phases = [] } = useGetAllPhasesQuery();

    const [createTask, createTaskState] = useCreateTaskMutation();
    const [updateTask, updateTaskState] = useUpdateTaskMutation();
    const [deleteTask, deleteTaskState] = useDeleteTaskMutation();

    const sortedTasks = [...tasks].sort((a, b) => {
        switch (sortField) {
            case 'name':
                return a.name.localeCompare(b.name);
            case 'priority': {
                const priorityOrder: Record<Priority, number> = {
                    urgent: 0,
                    high: 1,
                    medium: 2,
                    low: 3,
                };
                return priorityOrder[a.priority] - priorityOrder[b.priority];
            }
            case 'deadline': {
                if (!a.deadline && !b.deadline) return 0;
                if (!a.deadline) return 1;
                if (!b.deadline) return -1;
                return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
            }
            case 'estimatedTimeInMinutes':
                return a.estimatedTimeInMinutes - b.estimatedTimeInMinutes;
            default:
                return 0;
        }
    });

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

    const filteredTasks = filterStatus
        ? sortedTasks.filter((task) => task.status === filterStatus)
        : sortedTasks;

    return (
        <div className="page-shell">
            <header className="page-head">
                <div>
                    <h1 className="page-title">Tasks</h1>
                    <p className="page-lead">Create, filter and sort your tasks.</p>
                </div>
                <button
                    type="button"
                    onClick={() => {
                        setIsCreating(!isCreating);
                        setIsEditing(false);
                        setCurrentTask(null);
                    }}
                    className="ui-btn-primary w-full shrink-0 sm:w-auto"
                >
                    {isCreating ? 'Cancel' : 'Create Task'}
                </button>
            </header>

            <div className="filter-bar">
                <div className="w-full sm:max-w-xs">
                    <label htmlFor="statusFilter" className="ui-label">
                        Status
                    </label>
                    <select
                        id="statusFilter"
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value)}
                        className="ui-select"
                    >
                        <option value="">All Tasks</option>
                        <option value="todo">To Do</option>
                        <option value="in_progress">In Progress</option>
                        <option value="completed">Completed</option>
                        <option value="canceled">Canceled</option>
                    </select>
                </div>
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

            <TaskList
                tasks={filteredTasks}
                onEdit={handleEditTask}
                onDelete={handleDeleteTask}
                onStatusChange={() => {}}
                onSort={handleSort}
                isLoading={isLoadingTasks || deleteTaskState.isLoading}
            />
        </div>
    );
};

export default TasksPage;
