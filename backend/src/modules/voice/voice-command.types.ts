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
  /** false schedules a Later task: the engine seats it in the window or at the clock given (VC-02). */
  isUnscheduled?: boolean;
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
  /** seriesScope 'all' marks a write on a whole repeating task, so the preview can say so (VC-06). */
  | { kind: 'complete'; taskId: string; taskName: string; summary: string; seriesScope?: VoiceSeriesScope }
  | { kind: 'cancel'; taskId: string; taskName: string; summary: string; seriesScope?: VoiceSeriesScope }
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
      /** The app slot to move. When set, the server derives the original times from it (VC-03). */
      slotId?: string | null;
      /** Calendar event id; null when the slot has none and `slotId` names the block. */
      googleEventId: string | null;
      calendarId: string | null;
      recurringEventId: string | null;
      originalStart: string;
      originalEnd: string;
      start: string;
      end: string;
      seriesScope?: VoiceSeriesScope;
    }
  | {
      kind: 'end_series';
      taskId: string;
      taskName: string;
      summary: string;
      occurrenceStart: string;
      googleEventId: string | null;
      googleEventCalendarId: string | null;
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
      seriesScope?: VoiceSeriesScope;
    }
  | {
      kind: 'delete';
      taskId: string;
      taskName: string;
      summary: string;
      seriesScope?: VoiceSeriesScope;
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
    }
  | {
      kind: 'remind_create';
      name: string;
      summary: string;
      dueYmd: string;
      notificationTime: string | null;
      description: string | null;
      recurrencePattern: 'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | null;
      recurrenceWeekDays: number[] | null;
    }
  | {
      kind: 'remind_update';
      reminderId: string;
      name: string;
      summary: string;
      dueYmd: string;
      notificationTime: string | null;
      description: string | null;
      recurrencePattern: 'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | null;
      recurrenceWeekDays: number[] | null;
    }
  | {
      kind: 'remind_resolve';
      reminderId: string;
      name: string;
      summary: string;
    }
  | {
      kind: 'remind_delete';
      reminderId: string;
      name: string;
      summary: string;
    };

export type VoiceSeriesScope = 'occurrence' | 'series' | 'all';

export type VoiceCommandDraft = {
  intent: VoiceCommandIntent;
  target: 'current' | 'named';
  taskName: string | null;
  spokenStart: string | null;
  spokenEnd: string | null;
  patch: VoiceTaskPatch | null;
  habitFields: VoiceHabitFields | null;
  /** Set when the speaker already chose one day, this and following, or the whole series. */
  seriesScope: VoiceSeriesScope | null;
};
