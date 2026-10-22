import type { VoiceCompanionMode } from '../voice-companion-mode';
import type { VoiceExecutionReport } from '../voice-agent.types';
import { VOICE_EVAL_FIXTURES } from './fixtures';

/**
 * Dialogue-eval expectations. A write turn is `confirm`. Spoken yes is `act`.
 * The live clock is tomorrow 07:30 Europe/Kyiv, before wake, so a morning that
 * has not ended is still ahead and a bare hour still has a later place today.
 */
export type DialogueExpect = {
  outcome: string | string[];
  kinds?: string[];
  maxIntents?: number;
  unscheduled?: boolean;
  nameIncludes?: string;
  answer?: boolean;
  noPlan?: boolean;
  minPlannerCalls?: number;
  noLlm?: boolean;
  planStage?: 'interview' | 'review';
  actionsInclude?: string;
  planNames?: string[];
  planAbsent?: string[];
  planRevisionMin?: number;
  maxPlanItems?: number;
  messageExcludes?: string[];
};

export type DialogueTurn = {
  transcript?: string;
  actionId?: 'build_plan' | 'confirm' | 'cancel' | 'report';
  executionReport?: VoiceExecutionReport;
  expect: DialogueExpect;
};

export type DialogueScenario = {
  id: string;
  corpus: string;
  construction: string;
  mode?: VoiceCompanionMode;
  turns: DialogueTurn[];
};

/**
 * Inbox titles seeded by the dialogue eval. Spoken cases do not invent errands
 * under these titles. A day-plan picture still lists them.
 */
export const SEEDED_INBOX = VOICE_EVAL_FIXTURES.tasks
  .filter((task) => !task.isRecurring)
  .map((task) => task.name);

/** Exact title of the seeded series. Close names such as «тренування» are a different branch. */
export const SEEDED_SERIES = VOICE_EVAL_FIXTURES.tasks.find((task) => task.isRecurring)!.name;

const scenarios: DialogueScenario[] = [];
const constructions = new Set<string>();

export function scenario(
  corpus: string,
  construction: string,
  turns: DialogueTurn[],
  mode?: VoiceCompanionMode,
): void {
  const id = `${corpus}.${construction}`;
  if (constructions.has(id)) throw new Error(`duplicate construction ${id}`);
  constructions.add(id);
  scenarios.push({ id, corpus, construction, mode, turns });
}

export function registeredScenarios(): readonly DialogueScenario[] {
  return scenarios;
}

export function line(transcript: string, expect: DialogueExpect): DialogueTurn[] {
  return [{ transcript, expect }];
}

export function created(name: string, extra: Partial<DialogueExpect> = {}): DialogueExpect {
  return {
    outcome: 'confirm',
    kinds: ['create'],
    maxIntents: 1,
    noPlan: true,
    nameIncludes: name,
    ...extra,
  };
}

export const ask: DialogueExpect = { outcome: 'clarify', maxIntents: 0, noPlan: true };

export const noWrite: DialogueExpect = {
  outcome: ['clarify', 'refuse'],
  maxIntents: 0,
  noPlan: true,
};

export const moved: DialogueExpect = {
  outcome: 'confirm',
  kinds: ['window|shift|update'],
  maxIntents: 1,
  noPlan: true,
  nameIncludes: 'звіт',
};

export const readCalendar: DialogueExpect = {
  outcome: 'answer',
  maxIntents: 0,
  noPlan: true,
  answer: true,
  minPlannerCalls: 2,
};
