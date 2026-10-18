import type { VoiceToolCall } from './voice-agent.tools';
import { parsePlanEdits, type PlanEdit } from './voice-agent.plan-draft';
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
    }
  | { type: 'plan_edits'; edits: PlanEdit[]; answer: string }
  | { type: 'plan_question'; question: string; edits: PlanEdit[] }
  | { type: 'answer_pending' }
  | { type: 'confirm_pending' }
  | { type: 'cancel_pending' }
  | {
      type: 'final';
      outcome: 'answer' | 'clarify' | 'refuse';
      assistantMessage: string;
    };

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Parse one planner reply. Throws when the reply is not a JSON object. */
export function parsePlannerDecision(raw: string): PlannerDecision {
  const parsed = extractJsonObject(raw) as Record<string, unknown>;
  const type = text(parsed.type);
  switch (type) {
    case 'tools': {
      const rows = Array.isArray(parsed.calls) ? parsed.calls : [];
      const calls = rows
        .map((row): VoiceToolCall | null => {
          if (!row || typeof row !== 'object') return null;
          const name = text((row as { name?: unknown }).name);
          if (!name) return null;
          const args = (row as { args?: unknown }).args;
          return {
            name,
            args:
              args && typeof args === 'object' && !Array.isArray(args)
                ? (args as Record<string, unknown>)
                : {},
          };
        })
        .filter((call): call is VoiceToolCall => call != null);
      return { type, calls };
    }
    case 'steps': {
      const rows = Array.isArray(parsed.segments) ? parsed.segments : [];
      const segments = rows
        .map((row) =>
          typeof row === 'string' ? row.trim() : text((row as { text?: unknown })?.text),
        )
        .filter(Boolean)
        .slice(0, MAX_SEGMENTS);
      return { type, answer: text(parsed.answer), segments };
    }
    case 'plan_start':
      return {
        type,
        day: text(parsed.day),
        interview: parsed.interview === true,
        question: text(parsed.question),
        edits: parsePlanEdits(parsed.edits),
      };
    case 'plan_edits':
      return { type, edits: parsePlanEdits(parsed.edits), answer: text(parsed.answer) };
    case 'plan_question': {
      const question = text(parsed.question);
      if (!question) {
        return { type: 'plan_edits', edits: parsePlanEdits(parsed.edits), answer: '' };
      }
      return { type, question, edits: parsePlanEdits(parsed.edits) };
    }
    case 'answer_pending':
    case 'confirm_pending':
    case 'cancel_pending':
      return { type };
    default: {
      const outcome = text(parsed.outcome);
      return {
        type: 'final',
        outcome:
          outcome === 'clarify' || outcome === 'refuse' ? outcome : 'answer',
        assistantMessage: text(parsed.assistantMessage),
      };
    }
  }
}
