export type VoiceCommandIntent = 'complete' | 'skip' | 'reschedule' | 'habit_check_in';

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
      kind: 'habit_check_in';
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
};
