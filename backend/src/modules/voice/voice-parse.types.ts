export type VoiceUnderstanding =
  | 'complete'
  | 'sufficient'
  | 'needs_clarification';

export type VoiceTaskKind =
  | 'fixed'
  | 'flexible'
  | 'unscheduled'
  | 'recurring';

export type VoiceParsedTask = {
  name: string;
  description?: string;
  eventType: 'fixed' | 'admin';
  estimatedTimeInMinutes: number;
  isRecurring: boolean;
  isUnscheduled?: boolean;
  recurrencePattern?: string | null;
  recurrenceWeekDays?: number[] | null;
  allowSplit: boolean;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  deadline?: string | null;
  earliestStartTime?: string | null;
  eligibleWeekDays?: number[] | null;
  scheduledStartTime?: string | null;
  scheduledEndTime?: string | null;
  phaseId?: string | null;
  phaseIds?: string[];
  /** Settings IANA zone used for From/Until / placement. */
  timeZone?: string;
  location?: string | null;
  googleColorId?: string | null;
  googleVisibility?: string | null;
  googleTransparency?: string | null;
  googleReminders?: {
    useDefault: boolean;
    overrides?: { method: 'email' | 'popup'; minutes: number }[];
  } | null;
};

import type { VoiceCommand } from './voice-command.types';

export type VoiceParseResult = {
  understanding: VoiceUnderstanding;
  clarifyingQuestion: string | null;
  /** Spoken when a one-off clock was already past and the task stays on that day. */
  scheduleNotice?: string | null;
  task: VoiceParsedTask | null;
  /** Set when the utterance is complete, skip, or reschedule. Null for create. */
  command?: VoiceCommand | null;
};
