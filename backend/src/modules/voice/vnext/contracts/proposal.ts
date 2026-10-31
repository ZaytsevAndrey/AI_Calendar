import type { StoredReminderFields } from '../reference/reference-resolver';
/**
 * Stage 2 proposal contract.
 * These types are not read by runVNextTurn. A localRef is not a stored id.
 */
import type { OperationChangesV1, RecurrencePatternV1, SemanticActionV1, TimeOfDayLabelV1 } from './types';

/** Which part of a recurring series a command touches. from_day is that occurrence and the ones after it. */
/** `preferred`: a wish the engine may move away from (flexible); `start`: a promised clock. */
export const CLOCK_ROLES = ['start', 'end', 'preferred', 'earliest', 'deadline'] as const;
export type ClockRole = (typeof CLOCK_ROLES)[number];

export type SeriesScope = 'occurrence' | 'from_day' | 'all';

/** One placed occurrence of a recurring row, from the authorized catalog. */
/** A placed occurrence. `slotId` is the app slot, so a move needs no calendar event id (VC-03). */
export type EntityOccurrence = { start: string; end: string; googleEventId: string | null; slotId?: string | null };

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
  /** earliest and deadline bound when the task may run; start and end place it. */
  | { kind: 'clock'; value: string; role: ClockRole }
  /** The whole waking day of the date constraint, from the user's wake and sleep settings. */
  | { kind: 'all_day' }
  /** A bound at the user's own wake or sleep time on the date constraint. */
  | { kind: 'day_bound'; edge: 'wake' | 'sleep'; role: 'earliest' | 'deadline' }
  /** Start an amount of time from now. The model supplies the numbers; the backend only adds them. */
  /** A delay from now, or from the target's own start when `anchor` is target ("an hour later"). */
  | { kind: 'relative'; direction: 'after' | 'before'; amount: number; unit: 'minute' | 'hour' | 'day'; anchor?: 'now' | 'target' }
  | { kind: 'interval'; startHm: string; endHm: string }
  | { kind: 'duration'; minutes: number }
  | { kind: 'weekday'; weekday: number; which?: 'this' | 'next' }
  | { kind: 'ordering'; relation: 'before' | 'after'; entityId: string }
  /** Structured repeat for a new task. weekDays are 0 (Sunday) to 6. */
  | { kind: 'recurrence'; pattern: RecurrencePatternV1; weekDays?: number[] }
  /** Time the contract cannot place. A time-of-day label is kept so the preview can say it was not placed. */
  | { kind: 'unresolved'; label?: TimeOfDayLabelV1 };

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
  /** Recurring targets only: the part of the series, and the date of the occurrence meant. */
  seriesScope?: SeriesScope;
  occurrenceDate?: string;
  /** The pending operation this proposal takes the place of; it is withdrawn when the group applies (V7). */
  replaces?: { pendingId: string };
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
  /** The one app slot of a one-off task; a move names it instead of a calendar event (VC-03). */
  slotId?: string | null;
  /** A Later (inbox) task: a day or clock given by voice schedules it (VC-02). */
  unscheduled?: boolean;
  /** Catalog status at preview. Only open rows are eligible for a write. */
  status?: 'open' | 'completed' | 'canceled';
  /** A recurring row needs a series scope the structured contract cannot carry yet. */
  recurring?: boolean;
  /** Provider of an external event. Absent for Luefy tasks and reminders. */
  provider?: 'google' | 'microsoft' | 'apple';
  /** Recurring rows: placed occurrences and the series event id. */
  occurrences?: EntityOccurrence[];
  seriesEventId?: string | null;
  /** The series group holds detached copies or parked days: a series-wide rename / end / delete is refused (D-03). */
  seriesCopies?: boolean;
  /** Stored title of the row, for preview copy. Never a match key. */
  name?: string;
  fixed?: boolean;
  /** Stored fields of a day reminder; an update keeps what the user did not restate (VC-05). */
  reminder?: StoredReminderFields;
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
  seriesScope?: SeriesScope;
  occurrenceDate?: string;
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
