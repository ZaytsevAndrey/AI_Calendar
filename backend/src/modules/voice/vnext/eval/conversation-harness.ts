import type { ProposalGroup } from '../contracts/proposal';
import type { SemanticEnvelopeV1 } from '../contracts/types';
import { runVNextTurn, type PipelineResult, type TurnInput } from '../pipeline';
import type { VNextSession } from '../session/session';
import { withStructuredConfirmation } from './structured-test-turn';

const EMPTY_USAGE = { calls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 };

export type ScriptedInterpret = {
  envelope?: SemanticEnvelopeV1;
  group?: ProposalGroup;
};

function normalizeScripted(scripted: SemanticEnvelopeV1 | ScriptedInterpret): ScriptedInterpret {
  if (
    scripted
    && typeof scripted === 'object'
    && ('group' in scripted || ('envelope' in scripted && !('kind' in scripted)))
  ) {
    return scripted as ScriptedInterpret;
  }
  return { envelope: scripted as SemanticEnvelopeV1 };
}

/**
 * Runs one scripted interpreter turn. The fixture is not a model call.
 * Confirm/cancel controls receive a trusted claim from the open structured preview.
 * Prefer `group` when the V1 envelope bridge would drop entityType / temporal meaning.
 */
export async function runScriptedTurn(
  session: VNextSession,
  transcript: string,
  scripted: SemanticEnvelopeV1 | ScriptedInterpret,
  base: Omit<TurnInput, 'session' | 'transcript'>,
): Promise<PipelineResult> {
  const { envelope, group } = normalizeScripted(scripted);
  const withClaim = withStructuredConfirmation(session, envelope ?? null, base, group);
  return runVNextTurn(
    { ...base, ...withClaim, session, transcript },
    {
      arm: 'A',
      interpret: async () => ({
        ok: true,
        ...(group ? { group } : {}),
        ...(envelope ? { envelope } : {}),
        reads: [],
        usage: EMPTY_USAGE,
        specialist: null,
        promptHash: 'phase476-deterministic',
      }),
    },
  );
}
