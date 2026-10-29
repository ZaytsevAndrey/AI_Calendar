/**
 * Shared structured-protocol helpers for deterministic vNext Jest tests.
 * Test-only. Does not invent trusted ids or auto-confirm without a real preview claim.
 */
import type { ProposalGroup, SemanticOperationProposal } from '../contracts/proposal';
import type { SemanticEnvelopeV1, SemanticOperationV1 } from '../contracts/types';
import type { PipelineResult, TurnInput } from '../pipeline';
import type { EntityRecord } from '../reference/reference-resolver';
import { createSession, type VNextSession } from '../session/session';
import { withStructuredConfirmation } from './structured-test-turn';

export type { ProposalGroup, SemanticOperationProposal };

export const HARNESS_USER = 'user-1';
export const HARNESS_NOW = '2026-10-18T06:00:00.000Z';
export const HARNESS_TZ = 'Europe/Kyiv';

/** Narrow synonym map: same fail-closed class, not interchangeable product outcomes. */
const BLOCKED_SYNONYMS: Record<string, readonly string[]> = {
  unresolved: ['unresolved', 'unresolved_target', 'ambiguous'],
  unresolved_target: ['unresolved', 'unresolved_target', 'ambiguous'],
  ambiguous: ['ambiguous', 'unresolved', 'unresolved_target', 'ambiguous_target'],
  ambiguous_target: ['ambiguous_target', 'ambiguous', 'unresolved', 'unresolved_target'],
  preview_suspended: ['preview_suspended', 'missing_confirmation_claim', 'stale_preview'],
  already_applied: ['already_applied', 'duplicate_confirm'],
  duplicate_confirm: ['already_applied', 'duplicate_confirm'],
  external_readonly: ['external_readonly', 'unauthorized_entity'],
  unauthorized_entity: ['unauthorized_entity', 'external_readonly', 'forged', 'cross_user'],
  forged: ['forged', 'unauthorized_entity'],
  cross_user: ['cross_user', 'unauthorized_entity'],
  /** Canceled/completed ineligible writes may surface as unrepresentable_* on structured move. */
  ineligible: ['ineligible', 'stale_ineligible', 'unauthorized_entity', 'unrepresentable_move'],
  unrepresentable_move: ['unrepresentable_move', 'ineligible'],
  search_incomplete: ['search_incomplete', 'search_truncated'],
  search_truncated: ['search_incomplete', 'search_truncated'],
  completeness_unknown: ['completeness_unknown'],
  stale_preview: ['stale_preview', 'stale_execution', 'stale_scope'],
  stale_execution: ['stale_preview', 'stale_execution'],
  version_conflict: ['version_conflict'],
  missing_confirmation_claim: ['missing_confirmation_claim', 'confirm_not_explicit'],
  confirm_not_explicit: ['confirm_not_explicit', 'missing_confirmation_claim'],
  stale_deleted: ['stale_deleted', 'stale_preview', 'version_conflict', 'revalidation_incomplete'],
  revalidation_incomplete: ['revalidation_incomplete', 'stale_deleted', 'stale_preview'],
  wrong_calendar: ['wrong_calendar', 'unauthorized_entity'],
  /** Temporal unrepresentable class — DST / past / incomplete schedule projection. */
  gap: ['gap', 'unrepresentable_schedule'],
  fold: ['fold', 'unrepresentable_schedule'],
  past: ['past', 'unrepresentable_schedule'],
  unrepresentable_schedule: ['unrepresentable_schedule', 'gap', 'fold', 'past'],
  needs_day: ['needs_day', 'missing_day', 'unrepresentable_schedule', 'invalid_temporal'],
  missing_day: ['missing_day', 'needs_day', 'unrepresentable_schedule', 'invalid_temporal'],
  invalid_temporal: ['invalid_temporal', 'needs_day', 'missing_day', 'unrepresentable_schedule'],
  /** Move lacking a representable start / evening label formerly had dedicated codes. */
  insufficient_move: ['insufficient_move', 'unrepresentable_schedule', 'unrepresentable_move'],
  unmapped_time: ['unmapped_time', 'unrepresentable_schedule'],
  unsupported_binding: ['unsupported_binding', 'unsupported'],
  unsupported: ['unsupported', 'unsupported_binding'],
};

/** Outcomes that both mean “no Apply / no silent write” for a blocked request. */
const FAIL_CLOSED = new Set(['clarify', 'refuse', 'answer']);

export function harnessSession(sessionId = 'harness'): VNextSession {
  return createSession(HARNESS_USER, sessionId);
}

export function catalogEntity(
  id: string,
  name: string,
  extra: Partial<EntityRecord> = {},
): EntityRecord {
  return {
    id,
    userId: HARNESS_USER,
    type: 'task',
    name,
    status: 'open',
    revision: 1,
    writable: true,
    ...extra,
  };
}

export function scheduledEntity(
  id: string,
  name: string,
  extra: Partial<EntityRecord> = {},
): EntityRecord {
  return catalogEntity(id, name, {
    googleEventId: extra.googleEventId ?? `g-${id}`,
    scheduledStart: extra.scheduledStart ?? '2026-10-18T12:00:00.000Z',
    scheduledEnd: extra.scheduledEnd ?? '2026-10-18T13:00:00.000Z',
    calendarId: extra.calendarId ?? 'cal',
    ...extra,
  });
}

export function turnDefaults(
  session: VNextSession,
  extra: Partial<TurnInput> = {},
): TurnInput {
  return {
    transcript: extra.transcript ?? 'hello',
    userId: HARNESS_USER,
    session,
    nowIso: HARNESS_NOW,
    timeZone: HARNESS_TZ,
    wakeHm: '08:00',
    sleepHm: '23:00',
    defaultDurationMinutes: 30,
    language: 'uk',
    arm: 'A',
    entities: [],
    ...extra,
  };
}

/** Attach trusted confirm/cancel claim from the session’s open structured preview. */
export function withPreviewClaim(
  session: VNextSession,
  envelope: SemanticEnvelopeV1 | null | undefined,
  extra: Partial<TurnInput> = {},
  group?: ProposalGroup | null,
): Partial<TurnInput> {
  return withStructuredConfirmation(session, envelope, extra, group);
}

export function claimFromSession(session: VNextSession): { executionId: string; previewRevision: number } | null {
  const preview = session.structured?.preview;
  if (!preview || preview.protocol !== 'structured' || preview.executionState !== 'open') return null;
  return { executionId: preview.executionId, previewRevision: preview.previewRevision };
}

export function expectBlocked(result: PipelineResult, code: string): void {
  const accepted = BLOCKED_SYNONYMS[code] ?? [code];
  const hit = accepted.some((item) => result.blocked.includes(item));
  if (!hit) {
    throw new Error(`expected blocked one of [${accepted.join(', ')}], got [${result.blocked.join(', ')}]`);
  }
}

/**
 * Fail-closed: no provider writes and outcome is clarify|refuse|answer.
 * Use when V1 said clarify and structured says refuse (or the reverse) for the same denial.
 */
export function expectFailClosed(result: PipelineResult, options?: { blocked?: string; intents?: number }): void {
  expect(result.serverWrites).toBe(0);
  if (!FAIL_CLOSED.has(result.response.outcome)) {
    throw new Error(`expected fail-closed outcome, got ${result.response.outcome}`);
  }
  if (options?.intents != null) expect(result.response.intents).toHaveLength(options.intents);
  if (options?.blocked) expectBlocked(result, options.blocked);
}

export function expectNoWrites(result: PipelineResult): void {
  expect(result.serverWrites).toBe(0);
}

export function groupFromProposals(
  proposals: SemanticOperationProposal[],
  extra: Partial<ProposalGroup> = {},
): ProposalGroup {
  return {
    version: '1',
    control: 'none',
    proposals,
    patches: [],
    ...extra,
  };
}

export function confirmGroup(): ProposalGroup {
  return { version: '1', control: 'confirm', proposals: [], patches: [] };
}

export function cancelGroup(): ProposalGroup {
  return { version: '1', control: 'cancel', proposals: [], patches: [] };
}

/** Minimal create proposal used by deterministic fixtures. */
export function createProposal(partial: Partial<SemanticOperationProposal> & Pick<SemanticOperationProposal, 'localRef'>): SemanticOperationProposal {
  return {
    action: 'create',
    entityType: 'task',
    target: { kind: 'new' },
    scheduling: 'unscheduled',
    changes: { title: partial.changes?.title ?? 'Task' },
    constraints: [],
    dependsOn: [],
    known: ['title'],
    missing: [],
    source: { text: partial.localRef },
    ...partial,
  };
}

export function operationStub(
  partial: Partial<SemanticOperationV1> & Pick<SemanticOperationV1, 'opId' | 'action'>,
): SemanticOperationV1 {
  return {
    target: { kind: 'new', localId: partial.opId },
    changes: {},
    constraints: [],
    dependsOn: [],
    source: { text: partial.opId },
    ...partial,
  };
}

/** Whether a structured preview is still open (replaces legacy pendingIntents checks). */
export function hasOpenStructuredPreview(session: VNextSession): boolean {
  const preview = session.structured?.preview;
  return Boolean(preview && preview.protocol === 'structured' && preview.executionState === 'open')
    || Boolean(session.pendingIntents?.length);
}

/** Move of a catalog external_event — entityType must match KnownEntity (bridge defaults to task). */
export function moveExternalProposal(
  partial: Partial<SemanticOperationProposal> & Pick<SemanticOperationProposal, 'localRef'> & {
    entityId: string;
    calendarId?: string;
  },
): SemanticOperationProposal {
  const { entityId, calendarId, localRef, ...rest } = partial;
  return {
    localRef,
    action: 'move',
    entityType: 'external_event',
    target: { kind: 'entity', entityId },
    scheduling: 'scheduled',
    changes: {},
    constraints: [],
    dependsOn: [],
    known: [],
    missing: [],
    source: { text: localRef },
    ...(calendarId ? { calendarId } : {}),
    ...rest,
  };
}
