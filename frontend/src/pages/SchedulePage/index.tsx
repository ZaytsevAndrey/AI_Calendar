import React, { useState, useEffect, useCallback } from 'react';
import { format } from 'date-fns';
import {
  ScheduleApi,
  ScheduledTaskDTO,
  ScheduleJobResultPayload,
} from 'api/schedule.api';
import { PhasesApi } from 'api/phases.api';
import { TasksApi } from 'api/tasks.api';
import TaskForm from 'modules/tasks/components/TaskForm';
import TaskItem from 'modules/tasks/components/TaskItem';
import './styles.scss';
import CalendarComponent from 'modules/schedule/components/Calendar';
import { showErrorToast, showSuccessToast, showWarningToast } from 'utils/toast';

function parseJobResult(result: unknown): ScheduleJobResultPayload | null {
  if (!result || typeof result !== 'object') return null;
  const o = result as Record<string, unknown>;
  if (!Array.isArray(o.diff)) return null;
  return {
    diff: o.diff as ScheduleJobResultPayload['diff'],
    warnings: Array.isArray(o.warnings) ? (o.warnings as string[]) : [],
    errors: Array.isArray(o.errors)
      ? (o.errors as ScheduleJobResultPayload['errors'])
      : [],
  };
}

function formatSlotRange(startIso: string, endIso: string): string {
  try {
    return `${format(new Date(startIso), 'MMM d, HH:mm')} → ${format(new Date(endIso), 'MMM d, HH:mm')}`;
  } catch {
    return `${startIso} → ${endIso}`;
  }
}

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
  const [lastReplan, setLastReplan] = useState<{
    result: ScheduleJobResultPayload | null;
    canUndo: boolean;
  } | null>(null);
  const [isUndoing, setIsUndoing] = useState(false);

  const startDateStr = format(currentRange.startDate, 'yyyy-MM-dd');
  const endDateStr = format(currentRange.endDate, 'yyyy-MM-dd');

  const refreshLastReplanMeta = useCallback(() => {
    ScheduleApi.getLatestDoneJob()
      .then(({ job }) => {
        if (!job) {
          setLastReplan(null);
          return;
        }
        setLastReplan((prev) => ({
          result: parseJobResult(job.result) ?? prev?.result ?? null,
          canUndo: !!job.undoSnapshotId,
        }));
      })
      .catch(() => {
        /* optional endpoint; ignore if unauthenticated in edge cases */
      });
  }, []);

  // Fetch scheduled tasks
  useEffect(() => {
    ScheduleApi.getScheduledTasks({ startDate: startDateStr, endDate: endDateStr })
      .then(setScheduledTasks);
  }, [startDateStr, endDateStr]);

  // Fetch phases
  useEffect(() => {
    PhasesApi.getAllPhases().then(setPhases);
  }, []);

  useEffect(() => {
    refreshLastReplanMeta();
  }, [refreshLastReplanMeta]);

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
    try {
      const { tasks, job } = await ScheduleApi.generateSchedule(startDateStr, endDateStr);
      setScheduledTasks(tasks);
      const parsed = parseJobResult(job.result);
      setLastReplan({
        result: parsed,
        canUndo: !!job.undoSnapshotId,
      });
      if (parsed?.warnings?.length) {
        parsed.warnings.forEach((w) => showWarningToast(w));
      }
      if (parsed?.errors?.length) {
        parsed.errors.forEach((e) => showErrorToast(e.message));
      }
      if (!parsed?.errors?.length) {
        showSuccessToast('Schedule updated');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Schedule generation failed';
      showErrorToast(msg);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleUndoLastReplan = async () => {
    if (!lastReplan?.canUndo) return;
    setIsUndoing(true);
    try {
      await ScheduleApi.undoLastReplan();
      showSuccessToast('Last replan undone');
      const tasks = await ScheduleApi.getScheduledTasks({
        startDate: startDateStr,
        endDate: endDateStr,
      });
      setScheduledTasks(tasks);
      await refreshLastReplanMeta();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Undo failed';
      showErrorToast(msg);
    } finally {
      setIsUndoing(false);
    }
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
            type="button"
            onClick={handleUndoLastReplan}
            disabled={isUndoing || !lastReplan?.canUndo}
            className="undo-button"
            title={lastReplan?.canUndo ? 'Restore schedule before last replan' : 'No undo available'}
          >
            {isUndoing ? 'Undoing…' : 'Undo last replan'}
          </button>
          <button onClick={handleClearSchedule} className="clear-button">
            Clear Schedule
          </button>
        </div>
      </header>

      {lastReplan?.result &&
        (lastReplan.result.diff.length > 0 ||
          lastReplan.result.warnings.length > 0 ||
          lastReplan.result.errors.length > 0) && (
          <section className="replan-panel" aria-label="Last replan summary">
            <h2 className="replan-panel__title">Last replan</h2>
            {lastReplan.result.errors.length > 0 && (
              <ul className="replan-panel__errors">
                {lastReplan.result.errors.map((err) => (
                  <li key={`${err.taskId}-${err.message}`}>{err.message}</li>
                ))}
              </ul>
            )}
            {lastReplan.result.warnings.length > 0 && (
              <ul className="replan-panel__warnings">
                {lastReplan.result.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
            {lastReplan.result.diff.length > 0 && (
              <ul className="replan-panel__diff">
                {lastReplan.result.diff.map((row) => (
                  <li key={row.taskId} className="replan-panel__diff-row">
                    <div className="replan-panel__diff-name">{row.taskName}</div>
                    <div className="replan-panel__diff-cols">
                      <div>
                        <span className="replan-panel__label">Before</span>
                        {row.before.length === 0 ? (
                          <span className="replan-panel__empty">—</span>
                        ) : (
                          <ul>
                            {row.before.map((seg, i) => (
                              <li key={seg.id ?? `b-${i}`}>
                                {formatSlotRange(seg.start, seg.end)}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div>
                        <span className="replan-panel__label">After</span>
                        {row.after.length === 0 ? (
                          <span className="replan-panel__empty">—</span>
                        ) : (
                          <ul>
                            {row.after.map((seg, i) => (
                              <li key={seg.id ?? `a-${i}`}>
                                {formatSlotRange(seg.start, seg.end)}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

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