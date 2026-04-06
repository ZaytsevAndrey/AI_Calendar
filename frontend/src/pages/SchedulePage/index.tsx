import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { ScheduleApi, ScheduledTaskDTO } from 'api/schedule.api';
import { PhasesApi } from 'api/phases.api';
import { TasksApi } from 'api/tasks.api';
import TaskForm from 'modules/tasks/components/TaskForm';
import TaskItem from 'modules/tasks/components/TaskItem';
import './styles.scss';
import CalendarComponent from 'modules/schedule/components/Calendar';

const SchedulePage: React.FC = () => {
  const [currentRange, setCurrentRange] = useState({
    startDate: new Date(),
    endDate: new Date(new Date().setDate(new Date().getDate() + 7)),
  });
  const [selectedTask, setSelectedTask] = useState<ScheduledTaskDTO | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [scheduledTasks, setScheduledTasks] = useState<ScheduledTaskDTO[]>([]);
  const [phases, setPhases] = useState<any[]>([]);

  const startDateStr = format(currentRange.startDate, 'yyyy-MM-dd');
  const endDateStr = format(currentRange.endDate, 'yyyy-MM-dd');

  // Fetch scheduled tasks
  useEffect(() => {
    ScheduleApi.getScheduledTasks({ startDate: startDateStr, endDate: endDateStr })
      .then(setScheduledTasks);
  }, [startDateStr, endDateStr]);

  // Fetch phases
  useEffect(() => {
    PhasesApi.getAllPhases().then(setPhases);
  }, []);

  const handleRangeChange = (start: Date, end: Date) => {
    setCurrentRange({
      startDate: start,
      endDate: end,
    });
  };

  const handleTaskSelect = (task: ScheduledTaskDTO) => {
    setSelectedTask(task);
    setIsEditing(false);
  };

  const handleEventDrop = async (taskId: string, start: Date, end: Date) => {
    await ScheduleApi.rescheduleTask(taskId, start.toISOString(), end.toISOString());
    const tasks = await ScheduleApi.getScheduledTasks({ startDate: startDateStr, endDate: endDateStr });
    setScheduledTasks(tasks);
  };

  const handleGenerateSchedule = async () => {
    setIsGenerating(true);
    await ScheduleApi.generateSchedule(startDateStr, endDateStr);
    const tasks = await ScheduleApi.getScheduledTasks({ startDate: startDateStr, endDate: endDateStr });
    setScheduledTasks(tasks);
    setIsGenerating(false);
  };

  const handleClearSchedule = async () => {
    if (window.confirm('Are you sure you want to clear all scheduled tasks in this range?')) {
      await ScheduleApi.clearSchedule(startDateStr, endDateStr);
      const tasks = await ScheduleApi.getScheduledTasks({ startDate: startDateStr, endDate: endDateStr });
      setScheduledTasks(tasks);
    }
  };

  const handleEditTask = () => {
    if (selectedTask) {
      setIsEditing(true);
    }
  };

  const handleUpdateTask = async (taskData: any) => {
    if (selectedTask) {
      await TasksApi.updateTask(selectedTask.id, taskData);
      const tasks = await ScheduleApi.getScheduledTasks({ startDate: startDateStr, endDate: endDateStr });
      setScheduledTasks(tasks);
      setIsEditing(false);
      setSelectedTask(null);
    }
  };

  const handleDeleteTask = async () => {
    if (selectedTask && window.confirm('Are you sure you want to delete this task?')) {
      await TasksApi.deleteTask(selectedTask.id);
      const tasks = await ScheduleApi.getScheduledTasks({ startDate: startDateStr, endDate: endDateStr });
      setScheduledTasks(tasks);
      setSelectedTask(null);
    }
  };

  const handleStatusChange = async (id: string, status: 'todo' | 'in_progress' | 'completed' | 'canceled') => {
    await TasksApi.updateTaskStatus(id, status);
    const tasks = await ScheduleApi.getScheduledTasks({ startDate: startDateStr, endDate: endDateStr });
    setScheduledTasks(tasks);
  };

  const handleCloseDetails = () => {
    setSelectedTask(null);
    setIsEditing(false);
  };

  return (
    <div className="schedule-page">
      <header className="page-header">
        <h1>Schedule</h1>
        <div className="date-range">
          {format(currentRange.startDate, 'MMM d, yyyy')} - {format(currentRange.endDate, 'MMM d, yyyy')}
        </div>
        <div className="header-actions">
          <button 
            onClick={handleGenerateSchedule} 
            disabled={isGenerating}
            className="generate-button"
          >
            {isGenerating ? 'Generating...' : 'Generate Schedule'}
          </button>
          <button 
            onClick={handleClearSchedule} 
            className="clear-button"
          >
            Clear Schedule
          </button>
        </div>
      </header>

      <div className="schedule-container">
        <div className="calendar-view">
          <CalendarComponent
            tasks={scheduledTasks}
            phases={phases}
            onEventSelect={handleTaskSelect}
            onRangeChange={handleRangeChange}
            onEventDrop={handleEventDrop}
          />
        </div>
        
        {selectedTask && (
          <div className="task-details-panel">
            <div className="panel-header">
              <h2>Task Details</h2>
              <button className="close-button" onClick={handleCloseDetails}>×</button>
            </div>
            
            {isEditing ? (
              <TaskForm
                initialData={selectedTask}
                phases={phases}
                onSubmit={handleUpdateTask}
                isSubmitting={false}
              />
            ) : (
              <>
                <TaskItem
                  task={selectedTask}
                  onEdit={handleEditTask}
                  onDelete={handleDeleteTask}
                  onStatusChange={handleStatusChange}
                />
                
                <div className="scheduled-times">
                  <h3>Scheduled Time</h3>
                  <p>
                    <strong>Start:</strong> {format(new Date(selectedTask.scheduledStartTime), 'MMM d, yyyy h:mm a')}
                  </p>
                  <p>
                    <strong>End:</strong> {format(new Date(selectedTask.scheduledEndTime), 'MMM d, yyyy h:mm a')}
                  </p>
                  <p>
                    <strong>Duration:</strong> {Math.round((new Date(selectedTask.scheduledEndTime).getTime() - 
                      new Date(selectedTask.scheduledStartTime).getTime()) / (1000 * 60))} minutes
                  </p>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default SchedulePage; 