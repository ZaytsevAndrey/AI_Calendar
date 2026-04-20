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
  undoSnapshotId: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface SchedulingAlerts {
  errors: string[];
  warnings: string[];
  issueCount: number;
  updatedAt: string | null;
}

async function pollJobUntilDone(jobId: string, timeoutMs = 120_000): Promise<ScheduleJobStatusResponse> {
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

  getScheduledTask: async (id: string): Promise<ScheduledTaskDTO> => {
    const response = await axios.get(`/schedule/${id}`);
    return response.data as ScheduledTaskDTO;
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
  ): Promise<{ tasks: ScheduledTaskDTO[]; job: ScheduleJobStatusResponse }> => {
    const { data } = await axios.post<{ jobId: string; status: string }>('/schedule/generate', {
      startDate,
      endDate,
    });
    const job = await pollJobUntilDone(data.jobId);

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
    if (!job?.result) {
      return { errors: [], warnings: [], issueCount: 0, updatedAt: null };
    }
    const updatedAtMs = job.updatedAt ? new Date(job.updatedAt).getTime() : NaN;
    const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
    if (!Number.isFinite(updatedAtMs) || Date.now() - updatedAtMs > maxAgeMs) {
      return { errors: [], warnings: [], issueCount: 0, updatedAt: job.updatedAt ?? null };
    }

    const errorsRaw = (job.result.errors ?? []).map((e) => e.message).filter(Boolean);
    const warningsRaw = (job.result.warnings ?? [])
      .map((w) => w?.message)
      .filter(Boolean) as string[];
    const errors = [...new Set(errorsRaw)];
    const warnings = [...new Set(warningsRaw)];
    const issueCount = errors.length + warnings.length;
    return { errors, warnings, issueCount, updatedAt: job.updatedAt ?? null };
  },

  undoLastReplan: async (): Promise<{ restored: boolean }> => {
    const { data } = await axios.post<{ restored: boolean }>('/schedule-jobs/undo-last');
    return data;
  },

  clearSchedule: async (startDate: string, endDate: string): Promise<void> => {
    await axios.request({
      url: '/schedule',
      method: 'DELETE',
      data: { startDate, endDate },
    });
  },
};
