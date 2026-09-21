export type HabitDTO = {
  id: string;
  name: string;
  color: string;
  description: string | null;
  checkedToday: boolean;
  currentStreak: number;
  points: number;
  totalCheckIns: number;
  checkInDates: string[];
  blockStartTime: string | null;
  blockMinutes: number | null;
  googleEventId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type HabitsListDTO = {
  today: string;
  editableFrom: string;
  editableTo: string;
  timeZone: string;
  habits: HabitDTO[];
};

export type CreateHabitDTO = {
  name: string;
  color?: string;
  description?: string;
  blockStartTime?: string | null;
  blockMinutes?: number | null;
};

export type UpdateHabitDTO = Partial<CreateHabitDTO>;
