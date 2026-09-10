import axios from './axios';
import { TaskDTO } from './tasks.api';

export interface ScheduledTaskDTO extends TaskDTO {
  scheduledStartTime: string;
  scheduledEndTime: string;
}

export interface ScheduleQueryParams {
  startDate?: string;
  endDate?: string;
  categoryId?: string;
}

export interface ScheduleDiffItem {
  taskId: string;
  taskName: string;
  before: { id?: string; start: string; end: string }[];
  after: { id?: string; start: string; end: string }[];
}

export interface ScheduleJobResultPayload {
  diff: ScheduleDiffItem[];
  warnings: {
    code: string;
    message: string;
    taskId?: string;
    taskName?: string;
    meta?: Record<string, unknown>;
  }[];
  errors: { taskId: string; message: string }[];
}

export interface ScheduleJobStatusResponse {
  id: string;
  status: string;
  errorMessage?: string | null;
  result: ScheduleJobResultPayload | null;
  progressStage?: string | null;
  progressCurrent?: number | null;
  progressTotal?: number | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface SchedulingAlerts {
  jobId: string | null;
  errors: string[];
  warnings: string[];
  issueCount: number;
  updatedAt: string | null;
}

const EMPTY_ALERTS: SchedulingAlerts = {
  jobId: null,
  errors: [],
  warnings: [],
  issueCount: 0,
  updatedAt: null,
};

export function alertsFromJob(
  job: ScheduleJobStatusResponse | null,
  maxAgeHours?: number,
): SchedulingAlerts {
  if (!job?.result) return { ...EMPTY_ALERTS };
  if (typeof maxAgeHours === 'number') {
    const updatedAtMs = job.updatedAt ? new Date(job.updatedAt).getTime() : NaN;
    const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
    if (!Number.isFinite(updatedAtMs) || Date.now() - updatedAtMs > maxAgeMs) {
      return { ...EMPTY_ALERTS, jobId: job.id, updatedAt: job.updatedAt ?? null };
    }
  }
  const errors = [...new Set((job.result.errors ?? []).map((e) => e.message).filter(Boolean))];
  const warnings = [
    ...new Set(
      (job.result.warnings ?? []).map((w) => w?.message).filter(Boolean) as string[],
    ),
  ];
  return {
    jobId: job.id,
    errors,
    warnings,
    issueCount: errors.length + warnings.length,
    updatedAt: job.updatedAt ?? null,
  };
}

async function pollJobUntilDone(
  jobId: string,
  timeoutMs = 120_000,
  onProgress?: (job: ScheduleJobStatusResponse) => void,
): Promise<ScheduleJobStatusResponse> {
  const deadline = Date.now() + timeoutMs;
  let status = 'pending';
  let last: ScheduleJobStatusResponse | null = null;

  while (status === 'pending' || status === 'running') {
    if (Date.now() > deadline) {
      throw new Error('Schedule job timed out');
    }
    await new Promise((r) => setTimeout(r, 400));
    const { data } = await axios.get<ScheduleJobStatusResponse>(`/schedule-jobs/${jobId}`);
    last = data;
    status = data.status;
    onProgress?.(data);
    if (status === 'failed') {
      throw new Error(data.errorMessage || 'Schedule job failed');
    }
  }

  if (!last) {
    throw new Error('No job response');
  }
  return last;
}

export const ScheduleApi = {
  getScheduledTasks: async (params?: ScheduleQueryParams): Promise<ScheduledTaskDTO[]> => {
    const queryParams = new URLSearchParams();

    if (params?.startDate) {
      queryParams.append('startDate', params.startDate);
    }

    if (params?.endDate) {
      queryParams.append('endDate', params.endDate);
    }

    if (params?.categoryId) {
      queryParams.append('categoryId', params.categoryId);
    }

    const query = queryParams.toString() ? `?${queryParams.toString()}` : '';
    const response = await axios.get(`/schedule${query}`);
    return response.data as ScheduledTaskDTO[];
  },

  rescheduleTask: async (id: string, startTime: string, endTime: string): Promise<ScheduledTaskDTO> => {
    const response = await axios.patch(`/schedule/${id}`, {
      scheduledStartTime: startTime,
      scheduledEndTime: endTime,
    });
    return response.data as ScheduledTaskDTO;
  },

  /**
   * Enqueues replan, waits for job completion, returns refreshed tasks + engine output.
   */
  generateSchedule: async (
    startDate: string,
    endDate: string,
    onProgress?: (job: ScheduleJobStatusResponse) => void,
  ): Promise<{ tasks: ScheduledTaskDTO[]; job: ScheduleJobStatusResponse }> => {
    const { data } = await axios.post<{ jobId: string; status: string }>('/schedule/generate', {
      startDate,
      endDate,
    });
    const job = await pollJobUntilDone(data.jobId, 120_000, onProgress);

    const queryParams = new URLSearchParams();
    queryParams.append('startDate', startDate);
    queryParams.append('endDate', endDate);
    const list = await axios.get<ScheduledTaskDTO[]>(`/schedule?${queryParams.toString()}`);

    return { tasks: list.data, job };
  },

  getLatestDoneJob: async (): Promise<{
    job: ScheduleJobStatusResponse | null;
  }> => {
    const { data } = await axios.get<{ job: ScheduleJobStatusResponse | null }>(
      '/schedule-jobs/latest/done',
    );
    return data;
  },

  getLatestAlerts: async (
    maxAgeHours = 24,
  ): Promise<SchedulingAlerts> => {
    const { job } = await ScheduleApi.getLatestDoneJob();
    return alertsFromJob(job, maxAgeHours);
  },

  getUndoAvailability: async (): Promise<{
    available: boolean;
    jobId: string | null;
    generatedAt: string | null;
  }> => {
    const { data } = await axios.get<{
      available: boolean;
      jobId: string | null;
      generatedAt: string | null;
    }>('/schedule-jobs/undo');
    return data;
  },

  undoLastGenerate: async (): Promise<{ jobId: string; status: string }> => {
    const { data } = await axios.post<{ jobId: string; status: string }>(
      '/schedule-jobs/undo',
    );
    return data;
  },

  clearSchedule: async (
    _startDate?: string,
    _endDate?: string,
  ): Promise<{ deleted: number }> => {
    const { data } = await axios.delete<{ deleted: number }>('/schedule');
    return { deleted: data?.deleted ?? 0 };
  },
};
