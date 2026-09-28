export type VoiceCommandIntent =
  | 'complete'
  | 'skip'
  | 'reschedule'
  | 'habit_check_in'
  | 'update'
  | 'delete'
  | 'habit_create'
  | 'habit_update'
  | 'habit_delete'
  | 'habit_uncheck';

export type VoiceCommandTask = {
  id: string;
  name: string;
  status: string;
  isRecurring: boolean;
  isUnscheduled: boolean;
  isFixedExternal: boolean;
  eventType: string;
  googleEventId: string | null;
  googleEventCalendarId: string | null;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
};

export type VoiceCommandHabit = {
  id: string;
  name: string;
};

export type VoiceCommandSlot = {
  id: string;
  taskId: string;
  startIso: string;
  endIso: string;
  googleEventId: string | null;
  googleEventCalendarId: string | null;
  /** Fixed tasks keep their clock on the task row, not in scheduled_tasks. */
  synthetic: boolean;
};

export type VoiceTaskPatch = {
  name?: string;
  description?: string | null;
  phaseId?: string | null;
  eventType?: string;
  estimatedTimeInMinutes?: number;
  isRecurring?: boolean;
  recurrencePattern?: string | null;
  recurrenceWeekDays?: number[] | null;
  allowSplit?: boolean;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  deadline?: string | null;
  earliestStartTime?: string | null;
  eligibleWeekDays?: number[] | null;
  scheduledStartTime?: string | null;
  scheduledEndTime?: string | null;
  status?: 'todo' | 'in_progress' | 'completed' | 'canceled';
  location?: string | null;
  googleColorId?: string | null;
  googleVisibility?: string | null;
  googleTransparency?: string | null;
  googleReminders?: {
    useDefault: boolean;
    overrides?: { method: 'email' | 'popup'; minutes: number }[];
  } | null;
};

export type VoiceHabitFields = {
  name?: string;
  color?: string;
  description?: string | null;
  blockStartTime?: string | null;
  blockMinutes?: number | null;
};

export type VoiceCommand =
  | { kind: 'refuse'; message: string }
  | { kind: 'complete'; taskId: string; taskName: string; summary: string }
  | { kind: 'cancel'; taskId: string; taskName: string; summary: string }
  | {
      kind: 'skip';
      taskId: string;
      taskName: string;
      summary: string;
      occurrenceStart: string;
      googleEventId: string | null;
      googleEventCalendarId: string | null;
    }
  | {
      kind: 'move';
      taskId: string;
      taskName: string;
      summary: string;
      googleEventId: string;
      calendarId: string | null;
      recurringEventId: string | null;
      originalStart: string;
      originalEnd: string;
      start: string;
      end: string;
    }
  | {
      kind: 'shift';
      taskId: string;
      taskName: string;
      summary: string;
      slotId: string;
      start: string;
      end: string;
    }
  | {
      kind: 'window';
      taskId: string;
      taskName: string;
      summary: string;
      earliestStartTime: string | null;
      deadline: string | null;
      scheduledStartTime: string | null;
      scheduledEndTime: string | null;
      clearUnscheduled: boolean;
    }
  | {
      kind: 'update';
      taskId: string;
      taskName: string;
      summary: string;
      patch: VoiceTaskPatch;
    }
  | {
      kind: 'delete';
      taskId: string;
      taskName: string;
      summary: string;
    }
  | {
      kind: 'habit_check_in';
      habitId: string;
      habitName: string;
      date: string;
      summary: string;
    }
  | {
      kind: 'habit_create';
      summary: string;
      fields: VoiceHabitFields & { name: string };
    }
  | {
      kind: 'habit_update';
      habitId: string;
      habitName: string;
      summary: string;
      patch: VoiceHabitFields;
    }
  | {
      kind: 'habit_delete';
      habitId: string;
      habitName: string;
      summary: string;
    }
  | {
      kind: 'habit_uncheck';
      habitId: string;
      habitName: string;
      date: string;
      summary: string;
    };

export type VoiceCommandDraft = {
  intent: VoiceCommandIntent;
  target: 'current' | 'named';
  taskName: string | null;
  spokenStart: string | null;
  spokenEnd: string | null;
  patch: VoiceTaskPatch | null;
  habitFields: VoiceHabitFields | null;
};
