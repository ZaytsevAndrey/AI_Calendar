import apiCall from 'modules/common/utils/apiCall';
import type { CreateTaskDTO } from './tasks.api';

export type VoiceUnderstanding = 'complete' | 'sufficient' | 'needs_clarification';

export type VoiceParsedTask = CreateTaskDTO;

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

export type VoiceParseResult = {
  understanding: VoiceUnderstanding;
  clarifyingQuestion: string | null;
  task: VoiceParsedTask | null;
  command?: VoiceCommand | null;
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

export type VoiceCommandAction = Exclude<VoiceCommand, { kind: 'refuse' }>;

export type TranscribeVoiceResult = {
  transcript: string;
  language?: string;
};

export const VoiceApi = {
  transcribe: async (audioBase64: string, mimeType: string): Promise<TranscribeVoiceResult> => {
    const response = await apiCall({
      method: 'POST',
      url: '/voice/transcribe',
      data: { audioBase64, mimeType },
    });
    if (!response) throw new Error('No response from server');
    return response.data as TranscribeVoiceResult;
  },

  parseTask: async (body: {
    transcript: string;
    timeZone: string;
    clientNowIso?: string;
    previousTranscript?: string;
    clarificationAnswer?: string;
  }): Promise<VoiceParseResult> => {
    const response = await apiCall({
      method: 'POST',
      url: '/voice/parse-task',
      data: body,
    });
    if (!response) throw new Error('No response from server');
    return response.data as VoiceParseResult;
  },
};
