import React, { useState, useEffect, useCallback } from 'react';
import { format } from 'date-fns';
import {
  ScheduleApi,
  ScheduledTaskDTO,
  ScheduleJobResultPayload,
} from 'api/schedule.api';
import { PhasesApi } from 'api/phases.api';
import { TasksApi } from 'api/tasks.api';
import EventForm from 'modules/events/components/EventForm';
import EventItem from 'modules/events/components/EventItem';
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
    <div className="page-shell">
      <header className="page-head">
        <div className="min-w-0">
          <h1 className="page-title">Schedule</h1>
          <p className="page-lead mt-2">
            {format(currentRange.startDate, 'MMM d, yyyy')} — {format(currentRange.endDate, 'MMM d, yyyy')}
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-end">
          <button
            type="button"
            onClick={handleGenerateSchedule}
            disabled={isGenerating}
            className="ui-btn-primary w-full sm:w-auto"
          >
            {isGenerating ? 'Generating…' : 'Generate schedule'}
          </button>
          <button
            type="button"
            onClick={handleUndoLastReplan}
            disabled={isUndoing || !lastReplan?.canUndo}
            className="ui-btn-secondary w-full sm:w-auto"
            title={lastReplan?.canUndo ? 'Restore schedule before last replan' : 'No undo available'}
          >
            {isUndoing ? 'Undoing…' : 'Undo last replan'}
          </button>
          <button
            type="button"
            onClick={handleClearSchedule}
            className="ui-btn-danger w-full sm:w-auto"
          >
            Clear schedule
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

      <div className="schedule-layout">
        <div className="schedule-calendar-wrap min-h-0">
          <CalendarComponent
            tasks={scheduledTasks}
            phases={phases}
            onEventSelect={handleTaskSelect}
            onRangeChange={handleRangeChange}
            onEventDrop={handleEventDrop}
          />
        </div>

        {selectedTask ? (
          <aside className="schedule-side-panel max-h-[min(70vh,560px)] overflow-y-auto lg:max-h-none">
            <div className="mb-4 flex items-start justify-between gap-3 border-b border-ide-border pb-3">
              <h2 className="text-lg font-semibold text-ide-text">Event details</h2>
              <button
                type="button"
                className="ui-btn-ghost -mr-2 min-h-10 min-w-10 shrink-0 rounded-lg px-0 text-xl leading-none"
                onClick={handleCloseDetails}
                aria-label="Close details"
              >
                ×
              </button>
            </div>

            {isEditing ? (
              <EventForm
                initialData={selectedTask}
                phases={phases}
                onSubmit={handleUpdateTask}
                isSubmitting={false}
                onCancel={() => setIsEditing(false)}
                mode="edit"
              />
            ) : (
              <>
                <EventItem
                  event={selectedTask}
                  onEdit={handleEditTask}
                  onDelete={handleDeleteTask}
                  onStatusChange={handleStatusChange}
                />

                <div className="mt-4 rounded-lg border border-ide-border bg-ide-surface/50 p-4 text-sm text-ide-text">
                  <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ide-muted">
                    Scheduled time
                  </h3>
                  <dl className="space-y-2">
                    <div>
                      <dt className="text-ide-muted">Start</dt>
                      <dd className="font-medium">
                        {format(new Date(selectedTask.scheduledStartTime), 'MMM d, yyyy h:mm a')}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-ide-muted">End</dt>
                      <dd className="font-medium">
                        {format(new Date(selectedTask.scheduledEndTime), 'MMM d, yyyy h:mm a')}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-ide-muted">Duration</dt>
                      <dd className="font-medium">
                        {Math.round(
                          (new Date(selectedTask.scheduledEndTime).getTime() -
                            new Date(selectedTask.scheduledStartTime).getTime()) /
                            (1000 * 60)
                        )}{' '}
                        min
                      </dd>
                    </div>
                  </dl>
                </div>
              </>
            )}
          </aside>
        ) : null}
      </div>
    </div>
  );
};

export default SchedulePage; 