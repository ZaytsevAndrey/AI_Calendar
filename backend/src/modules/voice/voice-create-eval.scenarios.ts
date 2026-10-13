/**
 * Live create-eval corpus (roadmap §23.3).
 * Expected outcomes for real parseTask — no frozen LLM JSON.
 *
 * Anchors: Europe/Kyiv, nowIso = 13:00 local (afternoon) so soft "опівдні"
 * rolls forward; today 2026-10-13 (Tue), tomorrow 2026-10-14.
 *
 * Corpus: structurally unique Ukrainian first messages
 * (uk200 + uk-extra noise/mind-change). Dialogues = clarify-continue later.
 */
import {
  CREATE_EVAL_UK200,
  type CreateEvalScenarioUk,
} from './voice-create-eval.scenarios.uk200';
import { CREATE_EVAL_UK_EXTRA } from './voice-create-eval.scenarios.uk-extra';

export const CREATE_EVAL_ANCHORS = {
  timeZone: 'Europe/Kyiv',
  nowIso: '2026-10-13T10:00:00.000Z',
  todayYmd: '2026-10-13',
  tomorrowYmd: '2026-10-14',
  wakeTime: '08:00',
  sleepTime: '23:00',
  defaultTaskDurationMinutes: 30,
} as const;

export type CreateEvalBranch = 1 | 2 | 3 | 4 | 5 | 6 | 'clarify';

export type CreateEvalExpect = {
  understanding: 'complete' | 'needs_clarification';
  kind?: 'recurring' | 'fixed' | 'flexible' | 'unscheduled';
  nameIncludes?: string;
  isUnscheduled?: boolean;
  recurrencePattern?: 'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';
  recurrenceWeekDays?: number[];
  scheduledYmd?: string;
  scheduledHour?: number;
  earliestYmd?: string;
  deadlineYmd?: string;
  dayWindowYmd?: string;
  hasScheduledStart?: boolean;
  hasEarliest?: boolean;
  hasDeadline?: boolean;
  noScheduleFields?: boolean;
};

export type CreateEvalScenario = {
  id: string;
  branch: CreateEvalBranch;
  transcript: string;
  language: 'uk' | 'en';
  /** Structural fingerprint — must be unique across the corpus. */
  construction?: string;
  expect: CreateEvalExpect;
};

/** Full create-eval corpus (unique UK first-message constructions). */
export const CREATE_EVAL_SCENARIOS: CreateEvalScenario[] = [
  ...CREATE_EVAL_UK200,
  ...CREATE_EVAL_UK_EXTRA,
];

export type { CreateEvalScenarioUk };

/** Local grow / nightly: run one 50-scenario block at a time. */
export const CREATE_EVAL_BLOCK_SIZE = 50;

export function createEvalBlockCount(
  scenarios: readonly CreateEvalScenario[] = CREATE_EVAL_SCENARIOS,
): number {
  return Math.max(1, Math.ceil(scenarios.length / CREATE_EVAL_BLOCK_SIZE));
}

/**
 * One 50-scenario chunk. Index 0 is the first block; `latest` is the last.
 */
export function selectCreateEvalBlock(
  which: number | 'latest',
  scenarios: readonly CreateEvalScenario[] = CREATE_EVAL_SCENARIOS,
): CreateEvalScenario[] {
  const count = createEvalBlockCount(scenarios);
  const index = which === 'latest' ? count - 1 : which;
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    throw new Error(
      `Create-eval block ${String(which)} is out of range (0–${count - 1}, ${scenarios.length} scenarios).`,
    );
  }
  const start = index * CREATE_EVAL_BLOCK_SIZE;
  return scenarios.slice(start, start + CREATE_EVAL_BLOCK_SIZE);
}
