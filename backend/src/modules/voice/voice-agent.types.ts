import type { VoiceParseResult } from './voice-parse.types';

export type VoiceTurnOutcome =
  | 'answer'
  | 'clarify'
  | 'confirm'
  | 'act'
  | 'refuse'
  | 'legacy_parse';

export type VoiceAgentActionId =
  | 'confirm'
  | 'cancel'
  | 'retry'
  | 'skip_speak';

/** Client-executed write; shapes match create flow + executeVoiceCommand. */
export type VoiceWriteIntent =
  | {
      type: 'create';
      summary: string;
      task: Record<string, unknown>;
    }
  | {
      type: 'command';
      summary: string;
      command: Record<string, unknown>;
    };

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

export type VoiceTurnResponse = {
  sessionId: string;
  outcome: VoiceTurnOutcome;
  assistantMessage: string;
  intents: VoiceWriteIntent[];
  actions: VoiceAgentActionId[];
  proposal: DayPlanProposal | null;
  clarifyCount: number;
  /** Compatibility / e2e; prefer `intents` when non-empty. */
  legacyParse: VoiceParseResult | null;
};

export type VoiceSessionTurn = {
  role: 'user' | 'assistant';
  text: string;
};

export type VoiceAgentSession = {
  sessionId: string;
  userId: string;
  createdAt: number;
  clarifyCount: number;
  turns: VoiceSessionTurn[];
  pendingIntents: VoiceWriteIntent[] | null;
  pendingProposal: DayPlanProposal | null;
  pendingSummary: string | null;
  /** Groq rotation index for this session; set on first STT/chat call. */
  groqKeyIndex: number | null;
};

export const VOICE_AGENT_ACTION_IDS: VoiceAgentActionId[] = [
  'confirm',
  'cancel',
  'retry',
  'skip_speak',
];
