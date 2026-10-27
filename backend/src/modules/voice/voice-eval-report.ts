import type { VoiceStep } from '../../common/voice-trace';

export type DialogueEvalCall = {
  label: string;
  model: string;
  tokens: number;
  keyIndex: number;
};

/** One dialogue-eval turn. `steps` is the voice trace; `calls` stays the pace spend log. */
export function dialogueEvalCase(input: {
  id: string;
  failures: string[];
  outcome: string;
  kinds: string[];
  names: string[];
  plan: string | null;
  message: string;
  ms: number;
  calls: DialogueEvalCall[];
  traceId: string;
  steps: VoiceStep[];
}): Record<string, unknown> {
  return {
    id: input.id,
    ok: input.failures.length === 0,
    failures: input.failures,
    outcome: input.outcome,
    kinds: input.kinds,
    names: input.names,
    plan: input.plan,
    message: input.message,
    ms: input.ms,
    calls: input.calls,
    traceId: input.traceId,
    steps: input.steps.map((step) => ({ ...step })),
  };
}
