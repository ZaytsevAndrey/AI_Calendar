/**
 * Test-harness helper for Stage 4 confirmation claims.
 * Production clients must send the same metadata on the wire later.
 */
import type { ProposalGroup } from '../contracts/proposal';
import type { SemanticEnvelopeV1 } from '../contracts/types';
import type { TurnInput } from '../pipeline';
import type { VNextSession } from '../session/session';

function wantsClaimFromEnvelope(envelope: SemanticEnvelopeV1 | null | undefined): boolean {
  if (!envelope || envelope.kind !== 'control') return false;
  return envelope.control === 'confirm_pending' || envelope.control === 'cancel_pending';
}

function wantsClaimFromGroup(group: ProposalGroup | null | undefined): boolean {
  if (!group) return false;
  return group.control === 'confirm' || group.control === 'cancel';
}

/**
 * Attach trusted confirm/cancel metadata from the open structured preview.
 * Never invents executionId / previewRevision — only copies what prepare already issued.
 */
export function withStructuredConfirmation(
  session: VNextSession,
  envelope: SemanticEnvelopeV1 | null | undefined,
  extra: Partial<TurnInput> = {},
  group?: ProposalGroup | null,
): Partial<TurnInput> {
  // Explicit confirmation key opts out of auto-claim (null/undefined = withhold trusted claim).
  if (Object.prototype.hasOwnProperty.call(extra, 'confirmation')) {
    if (extra.confirmation == null) {
      const rest: Partial<TurnInput> = { ...extra };
      delete rest.confirmation;
      return rest;
    }
    return extra;
  }
  if (!wantsClaimFromEnvelope(envelope) && !wantsClaimFromGroup(group)) return extra;
  const preview = session.structured?.preview;
  if (!preview || preview.protocol !== 'structured') return extra;
  return {
    ...extra,
    confirmation: {
      executionId: preview.executionId,
      previewRevision: preview.previewRevision,
    },
  };
}
