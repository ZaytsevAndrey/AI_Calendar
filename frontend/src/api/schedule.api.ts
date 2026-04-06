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
      scheduledEndTime: endTime
    });
    return response.data as ScheduledTaskDTO;
  },

  generateSchedule: async (startDate: string, endDate: string): Promise<ScheduledTaskDTO[]> => {
    const response = await axios.post('/schedule/generate', {
      startDate,
      endDate
    });
    return response.data as ScheduledTaskDTO[];
  },

  clearSchedule: async (startDate: string, endDate: string): Promise<void> => {
    await axios.request({
      url: '/schedule',
      method: 'DELETE',
      data: { startDate, endDate }
    });
  }
}; 