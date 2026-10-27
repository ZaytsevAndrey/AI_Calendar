/**
 * Planner assertions with two levels.
 * Deterministic checks cover JSON, decision type, counts, tools, rounds,
 * unambiguous clocks and dates, extra segments, and listed stem groups.
 * A closed verb set and calendar equivalences cover a few semantic contracts.
 * A property that cannot be decided from those checks is review, never pass.
 * This does not understand arbitrary natural language.
 */
import { MAX_SEGMENTS } from '../../src/modules/voice/voice-agent.planner.prompt';
import {
  actionClash,
  anyStem,
  groupHits,
  inventedDays,
  inventedHours,
  normalizeMatchText,
  stemHits,
  surplusWords,
  wordsOf,
} from '../stem-match';
import type { BenchScenario, FailureClass } from './scenarios';

export type BenchTrace = {
  fault?: string;
  type?: string;
  outcome?: string;
  segments: string[];
  answer: string;
  day?: string;
  edits: string[];
  question?: string;
  toolCalls: Array<{ name: string; args?: Record<string, unknown> }>;
  /** Tool-request rounds already completed. Omitted when the runner did not count them. */
  toolRounds?: number;
};

export type BenchVerdict = 'pass' | 'fail' | 'review';

export type BenchScore = {
  verdict: BenchVerdict;
  failures: Array<{ class: FailureClass; reason: string }>;
  review: string[];
};

const MAX_TOOL_CALLS = 6;
const MAX_TOOL_ROUNDS = 2;
const PRONOUNS = new Set(['його', 'її', 'це', 'цю', 'ту']);

export function scoreBench(scenario: BenchScenario, trace: BenchTrace): BenchScore {
  const failures: BenchScore['failures'] = [];
  const review: string[] = [];
  const segmentBlob = [...trace.segments, ...trace.edits].join('\n');
  const spoken = [trace.answer, trace.question ?? ''].join('\n');
  const visible = [segmentBlob, spoken].filter((item) => item.trim()).join('\n');

  if (trace.fault || !trace.type) {
    failures.push({ class: 'hard', reason: trace.fault || 'planner returned no decision' });
    return { verdict: 'fail', failures, review };
  }
  if (trace.segments.length > MAX_SEGMENTS) {
    failures.push({ class: 'hard', reason: `${trace.segments.length} segments exceed the limit of ${MAX_SEGMENTS}` });
  }
  if (trace.toolCalls.length > MAX_TOOL_CALLS) {
    failures.push({ class: 'tool', reason: `${trace.toolCalls.length} tool calls exceed the limit of ${MAX_TOOL_CALLS}` });
  }
  if ((trace.toolRounds ?? 0) > MAX_TOOL_ROUNDS) {
    failures.push({ class: 'tool', reason: `${trace.toolRounds} tool rounds exceed the limit of ${MAX_TOOL_ROUNDS}` });
  }

  const branch = scenario.branches.find((item) => item.type === trace.type);
  const forbidden = scenario.forbiddenDecisions?.find((item) => item.type === trace.type);
  if (!branch) {
    failures.push({
      class: forbidden?.class ?? scenario.wrongType,
      reason: forbidden
        ? `decision ${trace.type} would confirm, cancel, or answer the open batch`
        : `decision ${trace.type} is outside the allowed set`,
    });
  } else {
    if (branch.outcome && trace.outcome !== branch.outcome) {
      failures.push({ class: scenario.wrongType, reason: `outcome ${trace.outcome || 'none'} is not ${branch.outcome}` });
    }
    if (branch.day && trace.day !== branch.day) {
      failures.push({ class: 'semantic', reason: `plan day ${trace.day || 'none'} is not ${branch.day}` });
    }
    if (branch.question && !trace.question) {
      failures.push({ class: 'clarification', reason: 'the plan opening question is empty' });
    }
    if (branch.editsMust && !hits(trace.edits.join('\n'), branch.editsMust)) {
      failures.push({ class: 'semantic', reason: 'the plan edit does not carry the expected task' });
    }
    if (branch.parts) {
      const used = new Set<number>();
      for (const part of branch.parts) {
        const index = trace.segments.findIndex((text, at) => !used.has(at) && hits(text, part.must) && !hasAny(text, part.none ?? []));
        if (index < 0) failures.push({ class: scenario.countMismatch, reason: 'an independent operation is missing or merged' });
        else used.add(index);
      }
      const extras = trace.segments.filter((text, index) => text.trim() && !used.has(index));
      const unresolved = scenario.targetReview?.param ?? [];
      const allowed = allowedStems(scenario);
      const stray = extras.filter((text) => {
        const carries = unresolved.length > 0
          && hasAny(text, unresolved)
          && inventedHours(scenario.utterance, text).length === 0
          && surplusWords(scenario.utterance, text, allowed).length === 0;
        return !carries;
      });
      if (stray.length) failures.push({ class: scenario.countMismatch, reason: 'an extra operation sits beside the required ones' });
    } else if (scenario.finalState) {
      const full = trace.segments.filter((text) => hits(text, scenario.finalState!));
      const leftover = trace.segments.filter((text) => text.trim() && !hits(text, scenario.finalState!));
      if (!full.length) failures.push({ class: 'semantic', reason: 'the final state is not stated as one operation' });
      if (leftover.length) failures.push({ class: 'semantic', reason: 'a leftover operation sits beside the final state' });
      if (full.length > 1) failures.push({ class: 'semantic', reason: 'the final operation is repeated' });
    } else if (branch.count !== undefined && trace.segments.length !== branch.count) {
      failures.push({
        class: scenario.countMismatch,
        reason: `${trace.segments.length} segments, expected ${branch.count}`,
      });
    }
    if (branch.must && !hits(segmentBlob, branch.must)) {
      failures.push({ class: 'semantic', reason: 'the final operation is missing a required parameter or target' });
    }
    if (branch.answerMust && !hits(trace.answer || trace.question || '', branch.answerMust)) {
      failures.push({ class: 'tool', reason: 'the answer is not grounded in the fixture' });
    }
    if (branch.answerNone && hasAny(trace.answer || trace.question || '', branch.answerNone)) {
      failures.push({ class: 'tool', reason: 'the spoken answer contains a value the fixture does not support' });
    }
  }

  if (hasAny(visible, scenario.hardIf)) {
    failures.push({ class: 'hard', reason: 'a forbidden target or invented write is in the reply' });
  }
  if (scenario.spokenHardIf && hasAny(spoken, scenario.spokenHardIf)) {
    failures.push({ class: 'hard', reason: 'the spoken reply uses a forbidden clock or target' });
  }
  if (hasAny(visible, scenario.semanticIf)) {
    failures.push({ class: 'semantic', reason: 'a cancelled value, pronoun, or invented parameter remains' });
  }
  for (const text of trace.segments) {
    if (inventedHours(scenario.utterance, text).length || inventedDays(scenario.utterance, text).length) {
      failures.push({ class: 'semantic', reason: 'a clock or day in the segment was not in the utterance' });
      break;
    }
    if (actionClash(scenario.utterance, text)) {
      failures.push({ class: 'semantic', reason: 'the segment commits to an action the utterance did not' });
      break;
    }
  }
  if (scenario.settledStem) {
    const loose = trace.segments.find((text) => hasPronoun(text) && !stemHits(text, scenario.settledStem!));
    if (loose) failures.push({ class: 'semantic', reason: 'a pronoun is not in the same segment as its settled object' });
  }
  if (scenario.ambiguousParam) {
    const guessed = trace.segments.find((text) => hasAny(text, scenario.ambiguousParam!.param) && hasAny(text, scenario.ambiguousParam!.antecedents));
    if (guessed) failures.push({ class: 'hard', reason: 'an unresolved parameter was assigned to one of several antecedents' });
  }
  if (scenario.targetReview) {
    if (!hasAny(segmentBlob, scenario.targetReview.param)) {
      failures.push({ class: 'semantic', reason: 'the requested parameter is missing, so its target cannot be judged' });
    } else {
      review.push(scenario.targetReview.reason);
    }
  }
  if (scenario.copiedOpenTitle) {
    const blob = normalizeMatchText(visible);
    const forbidden = normalizeMatchText(scenario.copiedOpenTitle.forbidden);
    const unless = normalizeMatchText(scenario.copiedOpenTitle.unless);
    if (blob.includes(forbidden) && !blob.includes(unless)) {
      failures.push({ class: 'hard', reason: 'a similar title was rewritten to the open task' });
    }
  }
  if (!toolsOk(scenario, trace)) {
    failures.push({ class: 'tool', reason: 'the required calendar read did not happen' });
  }
  const allowed = allowedStems(scenario);
  const surplus = trace.segments.flatMap((text) => surplusWords(scenario.utterance, text, allowed));
  if (surplus.length) review.push(`a word is outside the utterance and the listed stems: ${surplus.join(', ')}`);
  if (scenario.emptyAnswer === 'review' && !trace.answer.trim() && trace.segments.length === 0 && !failures.length) {
    review.push('the read happened, but the reply does not say what it found');
  }
  if (scenario.tools?.length && wordsOf(spoken).some((word) => word.startsWith('взагал') || word === 'ніде' || word.startsWith('жодн'))) {
    review.push('the reply widens a read of one day into a claim about every task');
  }

  if (failures.length) return { verdict: 'fail', failures, review };
  if (review.length) return { verdict: 'review', failures, review };
  return { verdict: 'pass', failures, review };
}

function allowedStems(scenario: BenchScenario): string[] {
  const stems: string[] = [];
  for (const branch of scenario.branches) {
    for (const group of branch.must ?? []) stems.push(...group);
    for (const group of branch.answerMust ?? []) stems.push(...group);
    for (const part of branch.parts ?? []) for (const group of part.must) stems.push(...group);
    for (const group of branch.editsMust ?? []) stems.push(...group);
  }
  for (const group of scenario.finalState ?? []) stems.push(...group);
  if (scenario.settledStem) stems.push(scenario.settledStem);
  return stems;
}

function toolsOk(scenario: BenchScenario, trace: BenchTrace): boolean {
  const need = scenario.tools ?? [];
  if (!need.length) return true;
  const hit = (tool: { name: string; day?: string }) => trace.toolCalls.some((call) => {
    if (call.name !== tool.name) return false;
    if (!tool.day) return true;
    const raw = String(call.args?.day ?? call.args?.ymd ?? '').toLowerCase();
    return raw === tool.day || (tool.day.endsWith('10-19') && raw === 'tomorrow') || (tool.day.endsWith('10-18') && (raw === 'today' || raw === ''));
  });
  return scenario.toolMatch === 'any' ? need.some(hit) : need.every(hit);
}

function hits(text: string, groups: string[][]): boolean {
  return groupHits(text, groups);
}

function hasAny(text: string, stems: string[]): boolean {
  return anyStem(text, stems);
}

function hasPronoun(text: string): boolean {
  return wordsOf(text).some((word) => PRONOUNS.has(word));
}
