export type HabitAchievementId =
  | 'first_check_in'
  | 'streak_3'
  | 'streak_7'
  | 'streak_30'
  | 'streak_100'
  | 'clean_week';

export type HabitAchievementsMap = Partial<Record<HabitAchievementId, string>>;

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
  achievements: HabitAchievementsMap;
  newlyUnlocked: HabitAchievementId[];
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
