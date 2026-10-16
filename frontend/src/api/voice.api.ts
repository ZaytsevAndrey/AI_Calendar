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
      kind: 'end_series';
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
      seriesScope?: 'occurrence' | 'series' | 'all';
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

export type VoiceTurnOutcome =
  | 'answer'
  | 'clarify'
  | 'confirm'
  | 'act'
  | 'refuse'
  | 'legacy_parse';

export type VoiceAgentActionId = 'confirm' | 'cancel' | 'retry' | 'skip_speak';

export type VoiceWriteIntent =
  | { type: 'create'; summary: string; task: VoiceParsedTask }
  | { type: 'command'; summary: string; command: VoiceCommandAction };

export type DayPlanProposalItem = {
  taskId: string;
  name: string;
  start: string;
  end: string;
  durationMinutes: number;
};

export type DayPlanProposal = {
  day: string;
  items: DayPlanProposalItem[];
};

export type VoiceTurnResult = {
  sessionId: string;
  outcome: VoiceTurnOutcome;
  assistantMessage: string;
  intents: VoiceWriteIntent[];
  actions: VoiceAgentActionId[];
  proposal: DayPlanProposal | null;
  clarifyCount: number;
  legacyParse: VoiceParseResult | null;
};

export const VoiceApi = {
  transcribe: async (
    audioBase64: string,
    mimeType: string,
    language?: string,
    sessionId?: string,
  ): Promise<TranscribeVoiceResult> => {
    const response = await apiCall({
      method: 'POST',
      url: '/voice/transcribe',
      data: { audioBase64, mimeType, language, sessionId },
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

  turn: async (body: {
    transcript?: string;
    sessionId: string;
    timeZone: string;
    clientNowIso?: string;
    actionId?: string;
  }): Promise<VoiceTurnResult> => {
    const response = await apiCall({
      method: 'POST',
      url: '/voice/turn',
      data: body,
    });
    if (!response) throw new Error('No response from server');
    return response.data as VoiceTurnResult;
  },

  endSession: async (sessionId: string): Promise<void> => {
    await apiCall({
      method: 'DELETE',
      url: `/voice/session/${encodeURIComponent(sessionId)}`,
    });
  },

  /** WAV from local Piper, or null when that process is not running. */
  speak: async (text: string, language?: string): Promise<Blob | null> => {
    try {
      const response = await apiCall({
        method: 'POST',
        url: '/voice/speak',
        data: { text, language },
        responseType: 'blob',
        validateStatus: () => true,
      });
      if (!response || response.status !== 200) return null;
      const blob = response.data as Blob;
      if (!blob || blob.size < 44) return null;
      if (blob.type.includes('json')) return null;
      return blob;
    } catch {
      return null;
    }
  },
};
