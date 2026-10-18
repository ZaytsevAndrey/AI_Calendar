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
  | 'skip_speak'
  | 'build_plan'
  | 'report';

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

export type VoiceIntentExecutionStatus =
  | 'applied'
  | 'skipped'
  | 'conflict'
  | 'error';

/** Client → server after running intents (`actionId: 'report'`). */
export type VoiceExecutionReport = {
  results: Array<{ summary: string; status: VoiceIntentExecutionStatus }>;
};

/** One understood piece of a multi-intent utterance. */
export type VoiceSegmentStatus = 'ready' | 'clarify' | 'refused' | 'dropped';

export type VoiceSegmentSummary = {
  summary: string;
  status: VoiceSegmentStatus;
};

export type PlanItemSource = 'unscheduled' | 'new' | 'flexible';

/** One task the day-plan dialogue tries to seat. Clocks are HH:MM on the plan day. */
export type PlanItem = {
  /** Stable id across revisions: the task id, or `new:N` for a task named in the dialogue. */
  id: string;
  taskId: string | null;
  source: PlanItemSource;
  name: string;
  durationMinutes: number;
  preferredHm: string | null;
  earliestHm: string | null;
  deadlineHm: string | null;
};

export type PlanStage = 'interview' | 'review';

export type DayPlanProposalItem = {
  itemId: string;
  taskId: string | null;
  source: PlanItemSource;
  name: string;
  start: string;
  end: string;
  durationMinutes: number;
};

export type DayPlanUnplacedReason = 'no_room' | 'deadline_passed' | 'conflict';

export type DayPlanUnplaced = {
  itemId: string;
  name: string;
  reason: DayPlanUnplacedReason;
};

export type DayPlanProposal = {
  day: string;
  stage: PlanStage;
  revision: number;
  items: DayPlanProposalItem[];
  unplaced: DayPlanUnplaced[];
  /** Items new or moved since the previous revision. */
  changedItemIds: string[];
};

export type PlanDraft = {
  day: string;
  stage: PlanStage;
  /** Interview questions asked so far (max 3). */
  interviewAsked: number;
  /** Seat order = priority order. */
  items: PlanItem[];
  revision: number;
  nextNewId: number;
  lastProposal: DayPlanProposal | null;
};

export type UnresolvedSegment = { segment: string; question: string };

/** Resolved intents held while one unclear segment is being clarified. */
export type PendingBatch = {
  intents: VoiceWriteIntent[];
  segments: VoiceSegmentSummary[];
  /** Unclear segments; the first one is being asked about. */
  unresolved: UnresolvedSegment[];
  /** Questions asked about the first unresolved segment so far. */
  clarifyCount: number;
  /** Q&A reply from the original utterance; spoken before the write summaries. */
  answer: string;
  /** Refusal / dropped-segment notes; spoken after the write summaries. */
  notes: string[];
  needsConfirm: boolean;
};

export type VoiceTurnResponse = {
  sessionId: string;
  outcome: VoiceTurnOutcome;
  assistantMessage: string;
  intents: VoiceWriteIntent[];
  actions: VoiceAgentActionId[];
  plan: DayPlanProposal | null;
  segments: VoiceSegmentSummary[];
  clarifyCount: number;
  /** Compatibility / e2e; prefer `intents` when non-empty. */
  legacyParse: VoiceParseResult | null;
};

export type VoiceSessionTurn = {
  role: 'user' | 'assistant' | 'system';
  text: string;
};

export type VoiceAgentSession = {
  sessionId: string;
  userId: string;
  createdAt: number;
  clarifyCount: number;
  turns: VoiceSessionTurn[];
  pendingIntents: VoiceWriteIntent[] | null;
  pendingSummary: string | null;
  /** `plan` = Apply of the open day plan; `writes` = a confirm-gated batch. */
  pendingKind: 'plan' | 'writes' | null;
  pendingBatch: PendingBatch | null;
  planDraft: PlanDraft | null;
  /** Groq rotation index for this session; set on first STT/chat call. */
  groqKeyIndex: number | null;
};

export const VOICE_AGENT_ACTION_IDS: VoiceAgentActionId[] = [
  'confirm',
  'cancel',
  'retry',
  'skip_speak',
  'build_plan',
  'report',
];
