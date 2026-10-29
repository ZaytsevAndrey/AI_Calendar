import { ReadBroker } from '../broker/read-broker';
import type { SemanticEnvelopeV1 } from '../contracts/types';
import type { ReadRecord } from '../evidence/evidence';
import { parseWithOneRepair, type LlmComplete, type LlmUsage, type RepairObserver } from '../repair/repair';
import { envelopeSpecialistReason, mergeSpecialistFragment } from './complexity';
import { INTERPRETER_A_SYSTEM, INTERPRETER_B_SYSTEM, PROMPT_A_HASH, PROMPT_B_HASH, SPECIALIST_SYSTEM } from './prompts';

export type InterpretOutput = {
  ok: boolean;
  envelope?: SemanticEnvelopeV1;
  reads: ReadRecord[];
  usage: LlmUsage;
  specialist: string | null;
  promptHash: string;
  code?: string;
};

const EMPTY: LlmUsage = { inputTokens: 0, outputTokens: 0, latencyMs: 0, calls: 0 };

export const MAX_READ_RESULT_CHARS = 6000;
export const MAX_READ_CONTEXT_CHARS = 16000;

/** Drop a result that does not fit. Never replace it with a shorter lookalike. */
export function applyReadBudget(records: ReadRecord[], perResult = MAX_READ_RESULT_CHARS, total = MAX_READ_CONTEXT_CHARS): void {
  let budget = total;
  for (const record of records) {
    if (!record.ok || record.withheld) continue;
    if (record.result === undefined) {
      record.withheld = 'missing_result';
      continue;
    }
    const size = JSON.stringify(record.result).length;
    if (size > perResult || size > budget) {
      record.result = undefined;
      record.withheld = 'result_too_large';
      continue;
    }
    budget -= size;
  }
}

/** Facts for the next model turn. A failed read has no result field. */
export function readFollowUp(user: string, records: ReadRecord[]): string {
  const payload = records.map((record) => {
    const row: Record<string, unknown> = {
      requestId: record.requestId,
      name: record.name,
      args: record.args,
      ok: record.ok,
      error: record.error ?? null,
      day: record.day ?? null,
      scope: record.scope ?? null,
      withheld: record.withheld ?? null,
    };
    if (record.ok && !record.withheld) row.result = record.result ?? null;
    return row;
  });
  return `${user}\nReads:${JSON.stringify(payload)}`;
}

function plus(left: LlmUsage, right: LlmUsage): LlmUsage {
  return {
    calls: left.calls + right.calls,
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    latencyMs: left.latencyMs + right.latencyMs,
  };
}

async function readLoop(
  llm: LlmComplete,
  broker: ReadBroker,
  system: string,
  user: string,
  transcript: string,
  observer?: RepairObserver,
  onTools?: (records: ReadRecord[]) => void,
): Promise<{ output: InterpretOutput; envelope?: SemanticEnvelopeV1 }> {
  let prompt = user;
  let usage = { ...EMPTY };
  let matchTaskCalls = 0;
  for (let round = 0; round < 4; round += 1) {
    const parsed = await parseWithOneRepair(llm, system, prompt, transcript, observer);
    usage = plus(usage, parsed.usage);
    if (!parsed.result.ok) {
      return { output: { ok: false, reads: broker.records, usage, specialist: null, promptHash: '', code: 'invalid_model_output' } };
    }
    const envelope = parsed.result.envelope;
    const reads = envelope.requestedReads ?? [];
    if (!reads.length) {
      const started = envelope.kind === 'day_plan' && envelope.dayPlan?.phase === 'start' && !(envelope.dayPlan.edits?.length);
      if (started && round === 0) {
        const repaired = await parseWithOneRepair(
          llm,
          system,
          `${prompt}\nThe day_plan start has no edits. If the user named an activity to add, return that day_plan with add_task edits and time_of_day. If they only asked to open a plan, return the same empty start. Do not invent an activity.`,
          transcript,
          observer,
        );
        usage = plus(usage, repaired.usage);
        const repairedPlan = repaired.result.ok ? repaired.result.envelope : undefined;
        if (repairedPlan?.dayPlan?.edits?.length) {
          return { output: { ok: true, envelope: repairedPlan, reads: broker.records, usage, specialist: null, promptHash: '' }, envelope: repairedPlan };
        }
      }
      return { output: { ok: true, envelope, reads: broker.records, usage, specialist: null, promptHash: '' }, envelope };
    }
    const nextMatches = reads.filter((read) => read.name === 'match_task').length;
    if (matchTaskCalls + nextMatches > 3 || round === 3) {
      return { output: { ok: false, reads: broker.records, usage, specialist: null, promptHash: '', code: 'tool_limit' } };
    }
    matchTaskCalls += nextMatches;
    broker.nextRound();
    const records = await broker.run(round, reads);
    onTools?.(records.map((record) => ({ ...record })));
    applyReadBudget(broker.records);
    prompt = readFollowUp(user, broker.records);
  }
  return { output: { ok: false, reads: broker.records, usage, specialist: null, promptHash: '', code: 'tool_limit' } };
}

export async function runInterpreterA(
  llm: LlmComplete,
  broker: ReadBroker,
  user: string,
  transcript: string,
  observer?: RepairObserver,
  onTools?: (records: ReadRecord[]) => void,
): Promise<InterpretOutput> {
  const ran = await readLoop(llm, broker, INTERPRETER_A_SYSTEM, user, transcript, observer, onTools);
  return { ...ran.output, promptHash: PROMPT_A_HASH, specialist: null };
}

export async function runInterpreterB(
  llm: LlmComplete,
  broker: ReadBroker,
  user: string,
  transcript: string,
  observer?: RepairObserver,
  onTools?: (records: ReadRecord[]) => void,
): Promise<InterpretOutput> {
  const ran = await readLoop(llm, broker, INTERPRETER_B_SYSTEM, user, transcript, observer, onTools);
  if (!ran.output.ok || !ran.envelope) return { ...ran.output, promptHash: PROMPT_B_HASH };
  const reason = envelopeSpecialistReason(ran.envelope);
  if (!reason) return { ...ran.output, promptHash: PROMPT_B_HASH, specialist: 'bypass_simple' };
  const fragment = await parseWithOneRepair(
    llm,
    SPECIALIST_SYSTEM,
    JSON.stringify({ reason, operations: ran.envelope.operations }),
    transcript,
    observer,
  );
  const usage = plus(ran.output.usage, fragment.usage);
  if (!fragment.result.ok) {
    return { ok: false, reads: broker.records, usage, specialist: reason, promptHash: PROMPT_B_HASH, code: 'specialist_rejected' };
  }
  const merged = mergeSpecialistFragment(ran.envelope, fragment.result.envelope);
  if (!merged.ok) {
    return { ok: false, reads: broker.records, usage, specialist: reason, promptHash: PROMPT_B_HASH, code: 'specialist_rejected' };
  }
  return {
    ok: true,
    envelope: merged.envelope,
    reads: broker.records,
    usage,
    specialist: reason,
    promptHash: PROMPT_B_HASH,
  };
}
