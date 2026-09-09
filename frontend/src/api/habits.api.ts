export type HabitDayMarker = {
  date: string;
  done: boolean;
};

export type HabitDTO = {
  id: string;
  name: string;
  color: string;
  description: string | null;
  checkedToday: boolean;
  checkedYesterday: boolean;
  currentStreak: number;
  points: number;
  totalCheckIns: number;
  last7Days: HabitDayMarker[];
  createdAt: string;
  updatedAt: string;
};

export type HabitsListDTO = {
  today: string;
  yesterday: string;
  timeZone: string;
  habits: HabitDTO[];
};

export type CreateHabitDTO = {
  name: string;
  color?: string;
  description?: string;
};

export type UpdateHabitDTO = Partial<CreateHabitDTO>;
