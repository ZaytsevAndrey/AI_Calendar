import { useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';
import {
  alertsFromJob,
  ScheduleApi,
  ScheduleJobResultPayload,
  SchedulingAlerts,
} from 'api/schedule.api';
import { eventsApi } from 'api/eventsApi';
import { showErrorToast, showInfoToast, showSuccessToast, showWarningToast } from 'utils/toast';
import { extractApiErrorMessage } from 'utils/extractApiErrorMessage';

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
  const [generateAlerts, setGenerateAlerts] = useState<SchedulingAlerts | null>(null);

  const refreshCalendarEvents = () => {
    dispatch(eventsApi.util.invalidateTags([{ type: 'Event', id: 'LIST' }]));
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
    try {
      const { tasks, job } = await ScheduleApi.generateSchedule(startDate, endDate);
      const parsed = parseJobResult(job.result);
      const alerts = alertsFromJob(job);
      setGenerateAlerts(alerts.issueCount > 0 ? alerts : null);

      const errorCount = parsed?.errors?.length ?? 0;
      const warningCount = parsed?.warnings?.length ?? 0;
      if (errorCount > 0) {
        showErrorToast(
          `Schedule generated with ${errorCount} error${errorCount === 1 ? '' : 's'}. Details are on this page.`,
        );
      } else if (warningCount > 0) {
        showWarningToast(
          `Schedule generated with ${warningCount} warning${warningCount === 1 ? '' : 's'}. Details are on this page.`,
        );
      } else {
        const changed = parsed?.diff?.length ?? 0;
        if (changed > 0) {
          showSuccessToast(
            `Schedule generated. ${changed} task${changed === 1 ? '' : 's'} rescheduled.`,
          );
        } else if (tasks.length > 0) {
          showSuccessToast(
            `Schedule generated. ${tasks.length} time block${tasks.length === 1 ? '' : 's'} in this range.`,
          );
        } else {
          showSuccessToast('Schedule generated. No time blocks in this range.');
        }
      }
      refreshCalendarEvents();
    } catch (e) {
      showErrorToast(extractApiErrorMessage(e) || 'Schedule generation failed');
    } finally {
      setIsGenerating(false);
    }
  };

  const clear = async () => {
    setIsClearing(true);
    try {
      const { deleted } = await ScheduleApi.clearSchedule();
      if (deleted === 0) {
        showInfoToast('Nothing to clear in the planning horizon.');
      } else {
        showSuccessToast(
          `Schedule cleared. ${deleted} generated time block${deleted === 1 ? '' : 's'} removed.`,
        );
      }
      refreshCalendarEvents();
    } catch (e) {
      showErrorToast(extractApiErrorMessage(e) || 'Failed to clear schedule');
    } finally {
      setIsClearing(false);
    }
  };

  return {
    isGenerating,
    isClearing,
    generate,
    clear,
    generateAlerts,
    dismissGenerateAlerts,
  };
}
