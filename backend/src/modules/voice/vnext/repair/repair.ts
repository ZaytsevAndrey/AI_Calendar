import { validateSemanticEnvelope, type ValidationResult } from '../contracts/validate';
import type { SemanticEnvelopeV1, ValidationIssue } from '../contracts/types';

export const REPAIR_SYSTEM = [
  'The previous JSON failed validation.',
  'Return one JSON object that matches the semantic envelope schema.',
  'Keep the user intent, the operation count, the target identity, the calendar identity, the time constraints, the reminder, the recurrence, and the dependencies.',
  'Do not add fields that were not in the schema.',
  'Do not invent clocks, dates, ids, or calendar facts.',
  'constraints is an array of objects with kind, not a map.',
  'target kind new is only for create and remind.',
  'target kind existing is an existing calendar or task entity.',
  'target kind operation_result refers only to an entity produced earlier in the same turn.',
  'target kind unresolved is an unsettled user reference. Do not invent an id for it.',
  'control is a string: confirm_pending, cancel_pending, or answer_pending. If it arrived as {"action":"confirm_pending"} or the same shape for cancel_pending or answer_pending, return that string. Do not replace a recoverable control with a clarification.',
  'Omit source.span.',
  'A question belongs in clarification.question, not at the top level. evidenceRefs belong in answer. operations is always an array.',
  'Write the clarification question in the language field of the repair payload. Ukrainian uses "Не зрозумів команду. Скажіть інакше." English uses "Please repeat that."',
  'If you cannot repair it safely, return a clarification and do not guess.',
].join(' ');

export type LlmUsage = { inputTokens: number; outputTokens: number; latencyMs: number; calls: number };

export type LlmComplete = {
  complete(input: { system: string; user: string }): Promise<{ text: string; inputTokens: number; outputTokens: number; latencyMs: number }>;
};

function add(usage: LlmUsage, row: { inputTokens: number; outputTokens: number; latencyMs: number }): void {
  usage.calls += 1;
  usage.inputTokens += row.inputTokens;
  usage.outputTokens += row.outputTokens;
  usage.latencyMs += row.latencyMs;
}

export function repairUser(errors: ValidationIssue[], invalid: string, user = ''): string {
  const language = user.includes('Ukrainian') ? 'uk' : user.includes('English') ? 'en' : undefined;
  return JSON.stringify({ errors: errors.slice(0, 20), invalid: invalid.slice(0, 4000), ...(language ? { language } : {}) });
}

async function observeCall(
  llm: LlmComplete,
  system: string,
  user: string,
  usage: LlmUsage,
  observer?: RepairObserver,
): Promise<{ text: string }> {
  try {
    const row = await llm.complete({ system, user });
    add(usage, row);
    observer?.call({
      systemChars: system.length,
      userChars: user.length,
      text: row.text,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      latencyMs: row.latencyMs,
    });
    return row;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    observer?.call({ systemChars: system.length, userChars: user.length, text: '', inputTokens: 0, outputTokens: 0, latencyMs: 0, error: message });
    throw err;
  }
}

export type RepairObserver = {
  call(input: { systemChars: number; userChars: number; text: string; inputTokens: number; outputTokens: number; latencyMs: number; error?: string }): void;
  validation(valid: boolean, errors: ValidationIssue[]): void;
};

export async function parseWithOneRepair(
  llm: LlmComplete,
  system: string,
  user: string,
  transcript: string,
  observer?: RepairObserver,
): Promise<{ result: ValidationResult; usage: LlmUsage; repaired: boolean }> {
  const usage: LlmUsage = { inputTokens: 0, outputTokens: 0, latencyMs: 0, calls: 0 };
  const first = await observeCall(llm, system, user, usage, observer);
  const parsed = validateSemanticEnvelope(first.text, transcript);
  observer?.validation(parsed.ok, parsed.ok ? [] : parsed.errors);
  if (parsed.ok) return { result: parsed, usage, repaired: false };
  const second = await observeCall(llm, REPAIR_SYSTEM, repairUser(parsed.errors, first.text, user), usage, observer);
  const again = validateSemanticEnvelope(second.text, transcript);
  observer?.validation(again.ok, again.ok ? [] : again.errors);
  if (!again.ok) {
    return {
      result: { ok: false, errors: [{ code: 'invalid_model_output', path: '', detail: again.errors[0]?.code ?? 'invalid' }] },
      usage,
      repaired: true,
    };
  }
  if (
    again.envelope.kind === 'clarification' &&
    again.envelope.clarification?.question === 'Please repeat that.' &&
    user.includes('Ukrainian')
  ) {
    again.envelope.clarification.question = 'Не зрозумів команду. Скажіть інакше.';
  }
  return { result: again, usage, repaired: true };
}

export function envelopeFromModel(value: SemanticEnvelopeV1): string {
  return JSON.stringify(value);
}
