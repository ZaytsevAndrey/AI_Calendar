import apiCall from 'modules/common/utils/apiCall';

/** Stored scheduling mode. UI writes only `fixed` or `admin` (flexible/recurring). */
export type TaskEventType = 'fixed' | 'admin' | string;

export interface TaskDTO {
  id: string;
  name: string;
  description?: string;
  phaseId?: string;
  eventType?: TaskEventType;
  phases?: { id: string; name: string; color?: string }[];
  estimatedTimeInMinutes: number;
  isRecurring: boolean;
  recurrencePattern?: string;
  recurrenceWeekDays?: number[] | null;
  /** Civil days (YYYY-MM-DD) skipped on a recurring series. */
  skippedOccurrenceYmds?: string[] | null;
  allowSplit: boolean;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  deadline?: string;
  earliestStartTime?: string;
  eligibleWeekDays?: number[] | null;
  scheduleTimeZone?: string;
  status: 'todo' | 'in_progress' | 'completed' | 'canceled';
  scheduledStartTime?: string;
  scheduledEndTime?: string;
  googleEventId?: string | null;
  isFixedExternal?: boolean;
  isUnscheduled?: boolean;
  /** none | problematic | resolved. Distinct from status. */
  scheduleState?: 'none' | 'problematic' | 'resolved';
  /** Civil days that failed to place when parked as problematic. */
  problematicOccurrenceYmds?: string[] | null;
  /** Short engine reason code for the problematic park. */
  problematicReason?: string | null;
  /** Civil day (YYYY-MM-DD) of a problematic or resolved copy. */
  problematicDay?: string | null;
  problematicOriginalStart?: string | null;
  problematicOriginalEnd?: string | null;
  /** Series this copy was detached from. */
  parentSeriesId?: string | null;
  /** Logical recurring family (clock-split siblings + detached one-offs). */
  seriesGroupId?: string | null;
  /** First open occurrence start (Tasks UI series span). */
  seriesSpanStart?: string | null;
  /** Last open occurrence start (Tasks UI series span). */
  seriesSpanEnd?: string | null;
  location?: string | null;
  googleColorId?: string | null;
  googleVisibility?: string | null;
  googleTransparency?: string | null;
  googleReminders?: {
    useDefault: boolean;
    overrides?: { method: 'email' | 'popup'; minutes: number }[];
  } | null;
  createdAt: string;
  updatedAt: string;
  /** Present on create/update when a silent replan was enqueued. */
  jobId?: string | null;
  /** Skip of a non-recurring Problematic copy deletes the row; client must drop cache. */
  deleted?: boolean;
  /** Anchor conflict from the placement step — open the shared conflict sheet. */
  conflicts?: Array<{
    taskId: string;
    taskName: string;
    reason: 'preferred_on_fixed' | 'phase_full';
    options: Array<'move_other' | 'move_new' | 'skip_occurrence' | 'leave_problematic'>;
    meta?: Record<string, unknown>;
  }>;
  phase?: {
    id: string;
    name: string;
    color?: string;
  };
}

export interface CreateTaskDTO {
  name: string;
  description?: string;
  phaseId?: string;
  phaseIds?: string[];
  eventType?: TaskEventType;
  estimatedTimeInMinutes?: number;
  scheduledStartTime?: string | null;
  scheduledEndTime?: string | null;
  isRecurring?: boolean;
  recurrencePattern?: string;
  recurrenceWeekDays?: number[] | null;
  allowSplit?: boolean;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  deadline?: string | null;
  earliestStartTime?: string | null;
  eligibleWeekDays?: number[] | null;
  timeZone?: string;
  isUnscheduled?: boolean;
  scheduleState?: 'none' | 'problematic' | 'resolved';
  /** Civil days that failed to place when parked as problematic. */
  problematicOccurrenceYmds?: string[] | null;
  /** Short engine reason code for the problematic park. */
  problematicReason?: string | null;
  problematicDay?: string | null;
  problematicOriginalStart?: string | null;
  problematicOriginalEnd?: string | null;
  parentSeriesId?: string | null;
  location?: string | null;
  googleColorId?: string | null;
  googleVisibility?: string | null;
  googleTransparency?: string | null;
  googleReminders?: {
    useDefault: boolean;
    overrides?: { method: 'email' | 'popup'; minutes: number }[];
  } | null;
}

export interface UpdateTaskDTO extends Partial<CreateTaskDTO> {
  status?: 'todo' | 'in_progress' | 'completed' | 'canceled';
  phaseIds?: string[];
}

export interface SkipOccurrenceDTO {
  occurrenceStart: string;
  googleEventId?: string;
  googleEventCalendarId?: string;
}

export const TasksApi = {
  getAllTasks: async (): Promise<TaskDTO[]> => {
    const response = await apiCall({ method: 'GET', url: '/tasks' });
    if (!response) throw new Error('No response from server');
    return response.data as TaskDTO[];
  },

  getTasksByStatus: async (status: 'todo' | 'in_progress' | 'completed' | 'canceled'): Promise<TaskDTO[]> => {
    const response = await apiCall({ method: 'GET', url: `/tasks?status=${status}` });
    if (!response) throw new Error('No response from server');
    return response.data as TaskDTO[];
  },

  getTasksByPhase: async (phaseId: string): Promise<TaskDTO[]> => {
    const response = await apiCall({ method: 'GET', url: `/tasks?phaseId=${phaseId}` });
    if (!response) throw new Error('No response from server');
    return response.data as TaskDTO[];
  },

  getTask: async (id: string): Promise<TaskDTO> => {
    const response = await apiCall({ method: 'GET', url: `/tasks/${id}` });
    if (!response) throw new Error('No response from server');
    return response.data as TaskDTO;
  },

  createTask: async (task: CreateTaskDTO): Promise<TaskDTO> => {
    const response = await apiCall({ method: 'POST', url: '/tasks', data: task });
    if (!response) throw new Error('No response from server');
    return response.data as TaskDTO;
  },

  updateTask: async (id: string, task: UpdateTaskDTO): Promise<TaskDTO> => {
    const response = await apiCall({ method: 'PATCH', url: `/tasks/${id}`, data: task });
    if (!response) throw new Error('No response from server');
    return response.data as TaskDTO;
  },

  updateTaskStatus: async (id: string, status: 'todo' | 'in_progress' | 'completed' | 'canceled'): Promise<TaskDTO> => {
    const response = await apiCall({ method: 'PATCH', url: `/tasks/${id}/status`, data: { status } });
    if (!response) throw new Error('No response from server');
    return response.data as TaskDTO;
  },

  deleteTask: async (id: string): Promise<void> => {
    await apiCall({ method: 'DELETE', url: `/tasks/${id}` });
  },

  skipOccurrence: async (id: string, body: SkipOccurrenceDTO): Promise<TaskDTO> => {
    const response = await apiCall({
      method: 'POST',
      url: `/tasks/${id}/skip-occurrence`,
      data: body,
    });
    if (!response) throw new Error('No response from server');
    return response.data as TaskDTO;
  },
}; 