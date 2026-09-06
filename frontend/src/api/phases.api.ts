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