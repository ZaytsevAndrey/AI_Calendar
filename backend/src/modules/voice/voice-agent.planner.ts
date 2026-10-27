import { VOICE_READ_TOOL_NAMES, type VoiceToolCall } from './voice-agent.tools';
import { parsePlanEdits, type PlanEdit, type SkippedPlanEdit } from './voice-agent.plan-draft';
import { MAX_SEGMENTS } from './voice-agent.planner.prompt';
import { extractJsonObject } from './voice-parse.util';

export type PlannerDecision =
  | { type: 'tools'; calls: VoiceToolCall[] }
  | { type: 'steps'; answer: string; segments: string[] }
  | {
      type: 'plan_start';
      day: string;
      interview: boolean;
      question: string;
      edits: PlanEdit[];
      skipped: SkippedPlanEdit[];
    }
  | { type: 'plan_edits'; edits: PlanEdit[]; answer: string; skipped: SkippedPlanEdit[] }
  | { type: 'plan_question'; question: string; edits: PlanEdit[]; skipped: SkippedPlanEdit[] }
  | { type: 'answer_pending' }
  | { type: 'confirm_pending' }
  | { type: 'cancel_pending' }
  | {
      type: 'final';
      outcome: 'answer' | 'clarify' | 'refuse';
      assistantMessage: string;
    };

const READ_TOOLS: ReadonlySet<string> = new Set(VOICE_READ_TOOL_NAMES);

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function plainObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** The reply was not a JSON object. */
export class PlannerInvalidJsonError extends Error {
  readonly code = 'invalid_json' as const;

  constructor() {
    super('Planner reply was not a JSON object');
    this.name = 'PlannerInvalidJsonError';
  }
}

/** The reply parsed as JSON, but it is not a usable planner decision. */
export class PlannerInvalidDecisionError extends Error {
  readonly code = 'invalid_decision' as const;

  constructor(
    readonly typeName: string,
    readonly reason?: string,
  ) {
    super(
      reason
        ? `Invalid planner decision (${typeName || '(missing)'}): ${reason}`
        : `Unknown planner decision type: ${typeName || '(missing)'}`,
    );
    this.name = 'PlannerInvalidDecisionError';
  }
}

/** More write segments than one turn can apply. Nothing from the list is kept. */
export class PlannerSegmentLimitError extends Error {
  readonly code = 'segment_limit_exceeded' as const;

  constructor(
    readonly count: number,
    readonly limit: number,
  ) {
    super(`Planner returned ${count} segments; limit is ${limit}`);
    this.name = 'PlannerSegmentLimitError';
  }
}

function invalid(typeName: string, reason: string): never {
  throw new PlannerInvalidDecisionError(typeName, reason);
}

function parseToolCalls(rows: unknown): VoiceToolCall[] {
  if (!Array.isArray(rows)) invalid('tools', 'calls');
  const calls: VoiceToolCall[] = [];
  for (const row of rows) {
    const call = plainObject(row);
    if (!call) invalid('tools', 'call');
    const name = text(call.name);
    if (!name) invalid('tools', 'call');
    if (!READ_TOOLS.has(name)) invalid('tools', 'unknown_tool');
    if ('args' in call && call.args !== undefined && !plainObject(call.args)) {
      invalid('tools', 'args');
    }
    const args = plainObject(call.args);
    calls.push({ name, args: args ?? {} });
  }
  return calls;
}

function parseSegmentText(row: unknown): string {
  if (typeof row === 'string') return row.trim();
  const segment = plainObject(row);
  if (!segment || typeof segment.text !== 'string') invalid('steps', 'segment');
  return segment.text.trim();
}

function parseSteps(parsed: Record<string, unknown>): PlannerDecision {
  if (!Array.isArray(parsed.segments)) invalid('steps', 'segments');
  if ('answer' in parsed && parsed.answer != null && typeof parsed.answer !== 'string') {
    invalid('steps', 'answer');
  }
  const segments: string[] = [];
  for (const row of parsed.segments) {
    const segment = parseSegmentText(row);
    if (segment) segments.push(segment);
  }
  if (segments.length > MAX_SEGMENTS) {
    throw new PlannerSegmentLimitError(segments.length, MAX_SEGMENTS);
  }
  return {
    type: 'steps',
    answer: typeof parsed.answer === 'string' ? parsed.answer.trim() : '',
    segments,
  };
}

function parseFinal(parsed: Record<string, unknown>): PlannerDecision {
  const outcome = parsed.outcome;
  if (outcome !== 'answer' && outcome !== 'clarify' && outcome !== 'refuse') {
    invalid('final', 'outcome');
  }
  if (
    'assistantMessage' in parsed &&
    parsed.assistantMessage != null &&
    typeof parsed.assistantMessage !== 'string'
  ) {
    invalid('final', 'assistantMessage');
  }
  return {
    type: 'final',
    outcome,
    assistantMessage: text(parsed.assistantMessage),
  };
}

/** Parse one planner reply. Throws when the reply is not a usable decision. */
export function parsePlannerDecision(raw: string): PlannerDecision {
  let parsed: unknown;
  try {
    parsed = extractJsonObject(raw);
  } catch {
    throw new PlannerInvalidJsonError();
  }
  const decision = plainObject(parsed);
  if (!decision) throw new PlannerInvalidJsonError();
  const type = text(decision.type);
  switch (type) {
    case 'tools':
      return { type, calls: parseToolCalls(decision.calls) };
    case 'steps':
      return parseSteps(decision);
    case 'plan_start': {
      const parsed = parsePlanEdits(decision.edits);
      return {
        type,
        day: text(decision.day),
        interview: decision.interview === true,
        question: text(decision.question),
        edits: parsed.edits,
        skipped: parsed.skipped,
      };
    }
    case 'plan_edits': {
      const parsed = parsePlanEdits(decision.edits);
      return { type, edits: parsed.edits, answer: text(decision.answer), skipped: parsed.skipped };
    }
    case 'plan_question': {
      const question = text(decision.question);
      if (!question) invalid('plan_question', 'empty_question');
      const parsed = parsePlanEdits(decision.edits);
      return { type, question, edits: parsed.edits, skipped: parsed.skipped };
    }
    case 'answer_pending':
    case 'confirm_pending':
    case 'cancel_pending':
      return { type };
    case 'final':
      return parseFinal(decision);
    default:
      throw new PlannerInvalidDecisionError(type || '(missing)');
  }
}
