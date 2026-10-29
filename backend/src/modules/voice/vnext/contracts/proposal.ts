/**
 * Stage 2 proposal contract.
 * These types are not read by runVNextTurn. A localRef is not a stored id.
 */
import type { OperationChangesV1, SemanticActionV1 } from './types';

export const PROPOSAL_ENTITY_TYPES = ['task', 'reminder', 'external_event', 'day_plan_item'] as const;
export type ProposalEntityType = (typeof PROPOSAL_ENTITY_TYPES)[number];

export const SCHEDULING_STATES = ['scheduled', 'unscheduled', 'unresolved'] as const;
export type SchedulingState = (typeof SCHEDULING_STATES)[number];

export const EXECUTION_STATES = [
  'open',
  'dispatched',
  'provider_succeeded',
  'definitive_failure',
  'unknown',
  'superseded',
] as const;
export type ExecutionState = (typeof EXECUTION_STATES)[number];

export const PROPOSAL_CONTROLS = ['none', 'confirm', 'cancel', 'pause', 'new_command'] as const;
export type ProposalControl = (typeof PROPOSAL_CONTROLS)[number];

/** Normalized time from the model. A label such as "evening" is not a backend window. */
export type TemporalProposal =
  | { kind: 'date'; value: string }
  | { kind: 'clock'; value: string; role: 'start' | 'end' }
  | { kind: 'interval'; startHm: string; endHm: string }
  | { kind: 'duration'; minutes: number }
  | { kind: 'weekday'; weekday: number; which?: 'this' | 'next' }
  | { kind: 'ordering'; relation: 'before' | 'after'; entityId: string }
  | { kind: 'unresolved' };

export type ProposalConstraint = TemporalProposal & { localRef: string };

export type ProposalDependency =
  | { localRef: string }
  | { pendingId: string };

export type ProposalTarget =
  | { kind: 'new' }
  | { kind: 'entity'; entityId: string }
  | { kind: 'pending'; pendingId: string }
  | { kind: 'unresolved'; reason: 'not_found' | 'search_incomplete' | 'ambiguous' };

export type SemanticOperationProposal = {
  localRef: string;
  action: SemanticActionV1;
  entityType: ProposalEntityType;
  target: ProposalTarget;
  scheduling: SchedulingState;
  changes: OperationChangesV1;
  constraints: ProposalConstraint[];
  dependsOn: ProposalDependency[];
  known: string[];
  missing: string[];
  source: { text: string; span?: [number, number] };
  /** Bulk marker from the model. Expansion uses a trusted search receipt, never title similarity. */
  scope?: 'one' | 'all';
  /** Optional search description carried for receipt/catalog validation only. */
  scopeDescription?: string;
  /** Optional calendar filter for bulk receipt validation. */
  calendarId?: string;
};

export type FieldPatch =
  | { op: 'replace' | 'add'; field: 'title' | 'notes' | 'priority' | 'location'; value: string | null }
  | { op: 'remove'; field: 'title' | 'notes' | 'priority' | 'location' }
  | { op: 'replace'; field: 'scheduling'; value: SchedulingState };

export type ConstraintPatch =
  | { op: 'add'; constraint: ProposalConstraint }
  | { op: 'replace'; constraintId: string; constraint: TemporalProposal }
  | { op: 'remove'; constraintId: string };

export type OperationPatch = {
  pendingId: string;
  baseRevision: number;
  fields: FieldPatch[];
  constraints: ConstraintPatch[];
  retarget?: { entityId: string };
};

export type ProposalGroup = {
  version: '1';
  control: ProposalControl;
  previewExecutionId?: string;
  previewBoundary?: 'extend' | 'replace';
  proposals: SemanticOperationProposal[];
  patches: OperationPatch[];
};

export type ResolvedEntityReference = {
  kind: 'entity';
  entityId: string;
  entityType: ProposalEntityType;
  revision: number;
  calendarId: string | null;
  writable: boolean;
  /** Present only when a trusted catalog row already linked a calendar event. Never invented. */
  googleEventId?: string | null;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
};

export type PendingOperation = {
  pendingId: string;
  revision: number;
  action: SemanticActionV1;
  entityType: ProposalEntityType;
  target: { kind: 'new'; localId: string } | ResolvedEntityReference;
  scheduling: SchedulingState;
  changes: OperationChangesV1;
  constraints: Array<TemporalProposal & { constraintId: string }>;
  known: string[];
  missing: string[];
  sourceText: string;
};

export type PreviewSnapshot = {
  protocol: 'structured';
  previewRevision: number;
  executionId: string;
  executionState: ExecutionState;
  items: Array<{ pendingId: string; revision: number }>;
};

export type ExecutionRecord = {
  executionId: string;
  sessionId: string;
  previewRevision: number;
  state: ExecutionState;
  itemKeys: string[];
  itemState: Record<string, 'not_sent' | 'provider_succeeded' | 'definitive_failure' | 'unknown'>;
  sessionVersion: number;
};

/** Ids the model is allowed to copy. Anything else is untrusted. */
export type ProposalContext = {
  entityIds: readonly string[];
  pendingIds: readonly string[];
  pendingRevisions: Readonly<Record<string, number>>;
  pendingActions: Readonly<Record<string, SemanticActionV1>>;
  constraintIdsByPending: Readonly<Record<string, readonly string[]>>;
};
