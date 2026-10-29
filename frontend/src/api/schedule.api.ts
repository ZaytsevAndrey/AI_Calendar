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
  /** Set while a failed attempt waits for its retry (`progressStage: retrying`). */
  attempts?: number;
  nextRunAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/** A job waiting for a scheduled retry is still alive: wait past its retry time. */
export function jobPollDeadline(
  deadline: number,
  job: Pick<ScheduleJobStatusResponse, 'status' | 'nextRunAt'>,
): number {
  if (job.status !== 'pending' || !job.nextRunAt) return deadline;
  const retryAt = new Date(job.nextRunAt).getTime();
  return Number.isFinite(retryAt) ? Math.max(deadline, retryAt + 30_000) : deadline;
}

async function pollJobUntilDone(
  jobId: string,
  timeoutMs = 120_000,
  onProgress?: (job: ScheduleJobStatusResponse) => void,
): Promise<ScheduleJobStatusResponse> {
  let deadline = Date.now() + timeoutMs;
  let status = 'pending';
  let last: ScheduleJobStatusResponse | null = null;
  let first = true;

  while (status === 'pending' || status === 'running') {
    if (Date.now() > deadline) {
      throw new Error('Schedule job timed out');
    }
    if (!first) {
      // Waiting for a retry (seconds to minutes away): poll slower.
      const waiting = last?.progressStage === 'retrying';
      await new Promise((r) => setTimeout(r, waiting ? 2_000 : 350));
    }
    first = false;
    const { data } = await axios.get<ScheduleJobStatusResponse>(`/schedule-jobs/${jobId}`);
    last = data;
    status = data.status;
    deadline = jobPollDeadline(deadline, data);
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

export const SCHEDULE_RECOMMENDATION_KINDS = [
  'overload',
  'gap',
  'phase_mismatch',
  'deadline_risk',
] as const;

export type ScheduleRecommendationKind = (typeof SCHEDULE_RECOMMENDATION_KINDS)[number];

export type ScheduleRecommendation = {
  kind: ScheduleRecommendationKind;
  title: string;
  detail: string;
  taskId: string | null;
};

export type ScheduleRecommendations = {
  summary: string;
  suggestions: ScheduleRecommendation[];
};

export type MoveEventOptions = {
  /** Called after the user picks a series scope, before the write request. */
  onSeriesScopeChosen?: (scope: 'occurrence' | 'series' | 'all') => void;
  /** Called right before the POST that actually mutates (not the series-choice probe). */
  onMutationStart?: () => void;
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
      /** App slot (voice); the server then ignores the event id and original interval. */
      slotId?: string;
      googleEventId: string;
      calendarId?: string;
      /** google | microsoft | apple — required for external events */
      provider?: 'google' | 'microsoft' | 'apple';
      recurringEventId?: string;
      originalStart: string;
      originalEnd: string;
      start: string;
      end: string;
      seriesScope?: 'occurrence' | 'series' | 'all';
    },
    opts?: MoveEventOptions,
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

  /**
   * Voice move of one app slot: the same engine path as a calendar drag
   * (displace peers, conflicts, series scope, Google sync). The server reads
   * the slot's event id and original interval from `slotId`.
   */
  moveSlot: (
    slotId: string,
    start: string,
    end: string,
    opts?: MoveEventOptions,
  ) =>
    ScheduleApi.moveDisplayedEvent(
      { slotId, googleEventId: '', originalStart: start, originalEnd: end, start, end },
      opts,
    ),

  getLatestDoneJob: async (): Promise<{
    job: ScheduleJobStatusResponse | null;
  }> => {
    const { data } = await axios.get<{ job: ScheduleJobStatusResponse | null }>(
      '/schedule-jobs/latest/done',
    );
    return data;
  },

  recommendSchedule: async (): Promise<ScheduleRecommendations> => {
    const { data } = await axios.get<ScheduleRecommendations>('/schedule/recommendations');
    return {
      summary: data.summary ?? '',
      suggestions: Array.isArray(data.suggestions) ? data.suggestions : [],
    };
  },
};
