import axios from './axios';
import { TaskDTO } from './tasks.api';
import type { SchedulingConflictDTO } from 'modules/schedule/conflictChoiceBus';
import { askSeriesDragScope, SeriesMoveCancelled } from 'modules/schedule/seriesDragChoice';

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
  conflicts?: SchedulingConflictDTO[];
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

export type ScheduleRecommendationKind =
  | 'overload'
  | 'gap'
  | 'phase_mismatch'
  | 'deadline_risk';

export interface ScheduleRecommendation {
  kind: ScheduleRecommendationKind;
  title: string;
  detail: string;
  taskId: string | null;
}

export interface ScheduleRecommendations {
  summary: string;
  suggestions: ScheduleRecommendation[];
}

async function pollJobUntilDone(
  jobId: string,
  timeoutMs = 120_000,
  onProgress?: (job: ScheduleJobStatusResponse) => void,
): Promise<ScheduleJobStatusResponse> {
  const deadline = Date.now() + timeoutMs;
  let status = 'pending';
  let last: ScheduleJobStatusResponse | null = null;
  let first = true;

  while (status === 'pending' || status === 'running') {
    if (Date.now() > deadline) {
      throw new Error('Schedule job timed out');
    }
    if (!first) {
      await new Promise((r) => setTimeout(r, 350));
    }
    first = false;
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

export async function waitForScheduleJob(
  jobId: string,
  timeoutMs = 120_000,
  onProgress?: (job: ScheduleJobStatusResponse) => void,
): Promise<ScheduleJobStatusResponse> {
  return pollJobUntilDone(jobId, timeoutMs, onProgress);
}

export type FreeSlotIntervalDTO = {
  start: string;
  end: string;
  label?: string;
  color?: string;
};

export type FreeSlotsResponse = {
  ymd: string;
  timeZone: string;
  durationMinutes: number;
  dayStart: string;
  dayEnd: string;
  phase: { id: string; name: string; color: string } | null;
  busy: FreeSlotIntervalDTO[];
  free: FreeSlotIntervalDTO[];
  candidates: string[];
};

export const ScheduleApi = {
  getFreeSlots: async (
    taskId: string,
    ymd: string,
    phaseId?: string | null,
  ): Promise<FreeSlotsResponse> => {
    const { data } = await axios.get<FreeSlotsResponse>('/schedule/free-slots', {
      params: {
        taskId,
        ymd,
        ...(phaseId ? { phaseId } : {}),
      },
    });
    return {
      ymd: data.ymd,
      timeZone: data.timeZone,
      durationMinutes: data.durationMinutes,
      dayStart: data.dayStart,
      dayEnd: data.dayEnd,
      phase: data.phase ?? null,
      busy: data.busy ?? [],
      free: data.free ?? [],
      candidates: data.candidates ?? [],
    };
  },

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

  moveDisplayedEvent: async (
    body: {
      googleEventId: string;
      calendarId?: string;
      recurringEventId?: string;
      originalStart: string;
      originalEnd: string;
      start: string;
      end: string;
      seriesScope?: 'occurrence' | 'series' | 'all';
    },
    opts?: {
      /** Called after the user picks a series scope, before the write request. */
      onSeriesScopeChosen?: (scope: 'occurrence' | 'series' | 'all') => void;
      /** Called right before the POST that actually mutates (not the series-choice probe). */
      onMutationStart?: () => void;
    },
  ): Promise<{ kind: 'fixed' | 'slot' | 'google'; jobId: string | null }> => {
    const post = async (payload: typeof body) => {
      const response = await axios.post('/schedule/move-event', payload);
      return response.data as {
        kind: 'fixed' | 'slot' | 'google' | 'series-choice';
        jobId: string | null;
        taskName?: string;
      };
    };
    // Recurring instance without a chosen scope: first POST is a no-write probe.
    const needsSeriesProbe =
      Boolean(body.recurringEventId) && body.seriesScope == null;
    if (!needsSeriesProbe) {
      opts?.onMutationStart?.();
    }
    const first = await post(body);
    if (first.kind !== 'series-choice') {
      return { kind: first.kind, jobId: first.jobId };
    }
    const scope = await askSeriesDragScope(first.taskName ?? '');
    if (!scope) throw new SeriesMoveCancelled();
    opts?.onSeriesScopeChosen?.(scope);
    opts?.onMutationStart?.();
    const second = await post({ ...body, seriesScope: scope });
    return { kind: second.kind === 'series-choice' ? 'slot' : second.kind, jobId: second.jobId };
  },

  rescheduleTask: async (id: string, startTime: string, endTime: string): Promise<ScheduledTaskDTO> => {
    const response = await axios.patch(`/schedule/${id}`, {
      scheduledStartTime: startTime,
      scheduledEndTime: endTime,
    });
    return response.data as ScheduledTaskDTO;
  },

  recommendSchedule: async (): Promise<ScheduleRecommendations> => {
    const { data } = await axios.post<ScheduleRecommendations>(
      '/schedule/recommendations',
      {},
    );
    return {
      summary: data.summary ?? '',
      suggestions: data.suggestions ?? [],
    };
  },

  getLatestDoneJob: async (): Promise<{
    job: ScheduleJobStatusResponse | null;
  }> => {
    const { data } = await axios.get<{ job: ScheduleJobStatusResponse | null }>(
      '/schedule-jobs/latest/done',
    );
    return data;
  },
};
