export type VoiceUnderstanding =
  | 'complete'
  | 'sufficient'
  | 'needs_clarification';

export type VoiceParsedTask = {
  name: string;
  description?: string;
  eventType: 'fixed' | 'admin';
  estimatedTimeInMinutes: number;
  isRecurring: boolean;
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
};

export type VoiceParseResult = {
  understanding: VoiceUnderstanding;
  clarifyingQuestion: string | null;
  task: VoiceParsedTask | null;
};
