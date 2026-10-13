import type { VoiceParseResult } from './voice-parse.types';
import {
  matchCreateEvalScenario,
  harvestCreateEvalActual,
  type CreateEvalMatchResult,
} from './voice-create-eval.match';
import {
  harvestIntentEvalActual,
  type IntentEvalActual,
} from './voice-intent-eval.match';
import type { ClarifyEvalScenario } from './voice-clarify-eval.scenarios';
import { CLARIFY_EVAL_ANCHORS } from './voice-clarify-eval.scenarios';

export type ClarifyEvalMatchResult = {
  ok: boolean;
  failures: string[];
  actual: {
    understanding: VoiceParseResult['understanding'];
    commandKind: string | null;
    create: ReturnType<typeof harvestCreateEvalActual> | null;
    intent: IntentEvalActual | null;
  };
};

/**
 * Create answers reuse create matchers; pivots assert commandKind / understanding.
 */
export function matchClarifyEvalScenario(
  scenario: ClarifyEvalScenario,
  result: VoiceParseResult,
): ClarifyEvalMatchResult {
  const failures: string[] = [];
  const exp = scenario.expect;
  const intentActual = harvestIntentEvalActual(
    result,
    CLARIFY_EVAL_ANCHORS.timeZone,
  );

  if (result.understanding !== exp.understanding) {
    failures.push(
      `understanding: expected ${exp.understanding}, got ${result.understanding}`,
    );
  }

  if (exp.understanding === 'needs_clarification') {
    if (!result.clarifyingQuestion?.trim()) {
      failures.push('clarifyingQuestion: expected a non-empty question');
    }
    return {
      ok: failures.length === 0,
      failures,
      actual: {
        understanding: result.understanding,
        commandKind: intentActual.commandKind,
        create: null,
        intent: intentActual,
      },
    };
  }

  const wantsCreateFields =
    !exp.intent ||
    exp.intent === 'create' ||
    Boolean(
      exp.kind ||
        exp.nameIncludes ||
        exp.isUnscheduled ||
        exp.recurrencePattern ||
        exp.scheduledYmd ||
        exp.dayWindowYmd ||
        exp.hasEarliest ||
        exp.hasDeadline ||
        exp.hasScheduledStart,
    );

  let createMatch: CreateEvalMatchResult | null = null;
  if (wantsCreateFields && (!exp.intent || exp.intent === 'create')) {
    createMatch = matchCreateEvalScenario(
      {
        id: scenario.id,
        branch: 'clarify',
        transcript: scenario.answer,
        language: 'uk',
        expect: exp,
      },
      result,
      CLARIFY_EVAL_ANCHORS.timeZone,
      CLARIFY_EVAL_ANCHORS.nowIso,
    );
    failures.push(...createMatch.failures);
  }

  if (exp.commandKind && intentActual.commandKind !== exp.commandKind) {
    failures.push(
      `commandKind: expected ${exp.commandKind}, got ${intentActual.commandKind}`,
    );
  }

  return {
    ok: failures.length === 0,
    failures,
    actual: {
      understanding: result.understanding,
      commandKind: intentActual.commandKind,
      create: createMatch?.actual ?? null,
      intent: intentActual,
    },
  };
}
