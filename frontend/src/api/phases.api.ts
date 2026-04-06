import apiCall from 'modules/common/utils/apiCall';

export interface PhaseDTO {
  id: string;
  name: string;
  color: string;
  description?: string;
  startTime: string;
  endTime: string;
  weekDays?: number[];
  type?: string;
  parentPhaseId?: string;
  subphases?: PhaseDTO[];
  createdAt: string;
  updatedAt: string;
}

export interface CreatePhaseDTO {
  name: string;
  color: string;
  description?: string;
  startTime: string;
  endTime: string;
  weekDays?: number[];
  type?: string;
  parentPhaseId?: string;
}

export type UpdatePhaseDTO = Partial<CreatePhaseDTO>;

export const PhasesApi = {
  getAllPhases: async (): Promise<PhaseDTO[]> => {
    const response = await apiCall({ method: 'GET', url: '/phases' });
    if (!response) throw new Error('No response from server');
    return response.data as PhaseDTO[];
  },

  getPhase: async (id: string): Promise<PhaseDTO> => {
    const response = await apiCall({ method: 'GET', url: `/phases/${id}` });
    if (!response) throw new Error('No response from server');
    return response.data as PhaseDTO;
  },

  createPhase: async (phase: CreatePhaseDTO): Promise<PhaseDTO> => {
    const response = await apiCall({ method: 'POST', url: '/phases', data: phase });
    if (!response) throw new Error('No response from server');
    return response.data as PhaseDTO;
  },

  updatePhase: async (id: string, phase: UpdatePhaseDTO): Promise<PhaseDTO> => {
    const response = await apiCall({ method: 'PATCH', url: `/phases/${id}`, data: phase });
    if (!response) throw new Error('No response from server');
    return response.data as PhaseDTO;
  },

  deletePhase: async (id: string): Promise<void> => {
    await apiCall({ method: 'DELETE', url: `/phases/${id}` });
  },

  // Get time phases
  getTimePhases: async (): Promise<PhaseDTO[]> => {
    const response = await apiCall({ method: 'GET', url: '/phases/time-phases' });
    if (!response) throw new Error('No response from server');
    return response.data as PhaseDTO[];
  },

  // Get time phases for a specific date
  getTimePhasesForDate: async (dateString: string): Promise<PhaseDTO[]> => {
    const response = await apiCall({ method: 'GET', url: `/phases/time-phases/date/${dateString}` });
    if (!response) throw new Error('No response from server');
    return response.data as PhaseDTO[];
  },

  // Get sleep time phases
  getSleepTimePhases: async (): Promise<PhaseDTO[]> => {
    const response = await apiCall({ method: 'GET', url: '/phases/sleep-time' });
    if (!response) throw new Error('No response from server');
    return response.data as PhaseDTO[];
  },
}; 