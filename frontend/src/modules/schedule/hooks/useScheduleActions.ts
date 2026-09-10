import { useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';
import {
  alertsFromJob,
  ScheduleApi,
  ScheduleJobResultPayload,
  ScheduleJobStatusResponse,
  SchedulingAlerts,
} from 'api/schedule.api';
import { eventsApi } from 'api/eventsApi';
import { eventTasksApi } from 'api/eventTasksApi';
import { showErrorToast, showInfoToast, showSuccessToast, showWarningToast } from 'utils/toast';
import { extractApiErrorMessage } from 'utils/extractApiErrorMessage';

export type GenerateProgress = {
  stage: string;
  current: number | null;
  total: number | null;
  startedAt: number;
};

const DISMISSED_JOB_KEY = 'scheduleGenerateAlertsDismissedJobId';

function parseJobResult(result: unknown): ScheduleJobResultPayload | null {
  if (!result || typeof result !== 'object') return null;
  const o = result as Record<string, unknown>;
  if (!Array.isArray(o.diff)) return null;
  return {
    diff: o.diff as ScheduleJobResultPayload['diff'],
    warnings: Array.isArray(o.warnings)
      ? (o.warnings as ScheduleJobResultPayload['warnings'])
      : [],
    errors: Array.isArray(o.errors)
      ? (o.errors as ScheduleJobResultPayload['errors'])
      : [],
  };
}

function readDismissedJobId(): string | null {
  try {
    return localStorage.getItem(DISMISSED_JOB_KEY);
  } catch {
    return null;
  }
}

function writeDismissedJobId(jobId: string) {
  try {
    localStorage.setItem(DISMISSED_JOB_KEY, jobId);
  } catch {
    /* ignore quota / private mode */
  }
}

export function useScheduleActions() {
  const dispatch = useDispatch();
  const [isGenerating, setIsGenerating] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [isUndoing, setIsUndoing] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [generateAlerts, setGenerateAlerts] = useState<SchedulingAlerts | null>(null);
  const [generateProgress, setGenerateProgress] = useState<GenerateProgress | null>(null);

  const refreshCalendarEvents = () => {
    dispatch(eventsApi.util.invalidateTags([{ type: 'Event', id: 'LIST' }]));
    dispatch(eventTasksApi.util.invalidateTags([{ type: 'EventTask', id: 'LIST' }]));
  };

  const refreshUndoAvailability = () => {
    ScheduleApi.getUndoAvailability()
      .then((state) => {
        setCanUndo(Boolean(state.available));
      })
      .catch(() => {
        setCanUndo(false);
      });
  };

  useEffect(() => {
    let cancelled = false;
    ScheduleApi.getLatestAlerts()
      .then((alerts) => {
        if (cancelled) return;
        if (!alerts.issueCount || (alerts.jobId && readDismissedJobId() === alerts.jobId)) {
          setGenerateAlerts(null);
          return;
        }
        setGenerateAlerts(alerts);
      })
      .catch(() => {
        if (!cancelled) setGenerateAlerts(null);
      });
    ScheduleApi.getUndoAvailability()
      .then((state) => {
        if (!cancelled) setCanUndo(Boolean(state.available));
      })
      .catch(() => {
        if (!cancelled) setCanUndo(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const dismissGenerateAlerts = () => {
    if (generateAlerts?.jobId) {
      writeDismissedJobId(generateAlerts.jobId);
    }
    setGenerateAlerts(null);
  };

  const generate = async (startDate: string, endDate: string) => {
    setIsGenerating(true);
    setGenerateProgress({
      stage: 'preparing',
      current: null,
      total: null,
      startedAt: Date.now(),
    });
    try {
      const { tasks, job } = await ScheduleApi.generateSchedule(
        startDate,
        endDate,
        (next: ScheduleJobStatusResponse) => {
          setGenerateProgress((prev) => ({
            stage: next.progressStage || prev?.stage || 'preparing',
            current: next.progressCurrent ?? prev?.current ?? null,
            total: next.progressTotal ?? prev?.total ?? null,
            startedAt: prev?.startedAt ?? Date.now(),
          }));
        },
      );
      const parsed = parseJobResult(job.result);
      const alerts = alertsFromJob(job);
      setGenerateAlerts(alerts.issueCount > 0 ? alerts : null);

      const errorCount = parsed?.errors?.length ?? 0;
      const warningCount = parsed?.warnings?.length ?? 0;
      if (errorCount > 0) {
        showErrorToast({
          title: 'Schedule generated with errors',
          detail: `${errorCount} error${errorCount === 1 ? '' : 's'}. Details are on this page.`,
        });
      } else if (warningCount > 0) {
        showWarningToast({
          title: 'Schedule generated with warnings',
          detail: `${warningCount} warning${warningCount === 1 ? '' : 's'}. Details are on this page.`,
        });
      } else {
        const changed = parsed?.diff?.length ?? 0;
        if (changed > 0) {
          showSuccessToast({
            title: 'Schedule generated',
            detail: `${changed} task${changed === 1 ? '' : 's'} rescheduled.`,
          });
        } else if (tasks.length > 0) {
          showSuccessToast({
            title: 'Schedule generated',
            detail: `${tasks.length} time block${tasks.length === 1 ? '' : 's'} in this range.`,
          });
        } else {
          showSuccessToast({
            title: 'Schedule generated',
            detail: 'No time blocks in this range.',
          });
        }
      }
      refreshCalendarEvents();
    } catch (e) {
      showErrorToast({
        title: 'Schedule generation failed',
        detail: extractApiErrorMessage(e),
      });
    } finally {
      setIsGenerating(false);
      setGenerateProgress(null);
      refreshUndoAvailability();
    }
  };

  const undo = async () => {
    setIsUndoing(true);
    try {
      await ScheduleApi.undoLastGenerate();
      showSuccessToast({
        title: 'Last generate undone',
        detail: 'Upcoming app blocks were restored. Finished blocks stayed.',
      });
      refreshCalendarEvents();
    } catch (e) {
      showErrorToast({
        title: 'Could not undo generate',
        detail: extractApiErrorMessage(e),
      });
    } finally {
      setIsUndoing(false);
      refreshUndoAvailability();
    }
  };

  const clear = async () => {
    setIsClearing(true);
    try {
      const { deleted } = await ScheduleApi.clearSchedule();
      if (deleted === 0) {
        showInfoToast({
          title: 'Nothing to clear',
          detail: 'There are no generated time blocks in the planning horizon.',
        });
      } else {
        showSuccessToast({
          title: 'Schedule cleared',
          detail: `${deleted} generated time block${deleted === 1 ? '' : 's'} removed.`,
        });
      }
      refreshCalendarEvents();
    } catch (e) {
      showErrorToast({
        title: 'Could not clear schedule',
        detail: extractApiErrorMessage(e),
      });
    } finally {
      setIsClearing(false);
      refreshUndoAvailability();
    }
  };

  return {
    isGenerating,
    isClearing,
    isUndoing,
    canUndo,
    generate,
    undo,
    clear,
    generateAlerts,
    dismissGenerateAlerts,
    generateProgress,
  };
}
