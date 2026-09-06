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
  allowSplit: boolean;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  deadline?: string;
  status: 'todo' | 'in_progress' | 'completed' | 'canceled';
  scheduledStartTime?: string;
  scheduledEndTime?: string;
  createdAt: string;
  updatedAt: string;
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
  deadline?: string;
}

export interface UpdateTaskDTO extends Partial<CreateTaskDTO> {
  status?: 'todo' | 'in_progress' | 'completed' | 'canceled';
  phaseIds?: string[];
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
  }
}; 