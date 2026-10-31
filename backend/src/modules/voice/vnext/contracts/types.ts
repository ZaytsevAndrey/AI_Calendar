/**
 * Semantic envelope v1.
 * opId is stable only inside one turn. It is not a database id.
 * localId names an object this turn is creating. proposedId is untrusted.
 * Qualitative labels stay labels until qualitative-policy.ts maps a spec rule.
 */

export const SEMANTIC_VERSION = '1' as const;

export const SEMANTIC_ACTIONS = [
  'create',
  'update',
  'delete',
  'complete',
  'skip',
  'cancel',
  'move',
  'remind',
] as const;

export type SemanticActionV1 = (typeof SEMANTIC_ACTIONS)[number];

export const TIME_OF_DAY_LABELS = [
  'morning',
  'midday',
  'afternoon',
  'evening',
  'night',
  'after_lunch',
  'after_work',
] as const;

export type TimeOfDayLabelV1 = (typeof TIME_OF_DAY_LABELS)[number];

export type TargetRefV1 =
  | { kind: 'new'; localId: string }
  | { kind: 'existing'; proposedId?: string; description?: string; calendarId?: string }
  | { kind: 'operation_result'; opId: string }
  | { kind: 'context'; referentKey: string }
  | { kind: 'unresolved'; phrase: string };

export type SemanticConstraintV1 =
  | { kind: 'date'; value: string; precision: 'day' | 'week' | 'month' }
  | {
      kind: 'relative_time';
      anchor: 'now' | 'day_start' | 'referenced_task';
      direction: 'before' | 'after';
      amount?: number;
      unit?: 'minute' | 'hour' | 'day';
    }
  | {
      kind: 'time_of_day';
      label: TimeOfDayLabelV1;
      bound?: 'at' | 'until' | 'not_before';
    }
  | {
      kind: 'clock';
      value: string;
      role: 'start' | 'end' | 'preferred' | 'earliest' | 'deadline';
    }
  | { kind: 'duration'; minutes: number }
  /** expression is the user's words; pattern and weekDays are the model's structured reading of them. */
  | { kind: 'recurrence'; expression: string; pattern?: RecurrencePatternV1; weekDays?: number[] }
  | { kind: 'ordering'; relation: 'before' | 'after'; target: TargetRefV1 }
  | { kind: 'day_bound'; edge: 'wake' | 'sleep'; role: 'earliest' | 'deadline' }
  | { kind: 'weekday'; weekday: number; which: 'next' | 'this' }
  | { kind: 'all_day' };

export const RECURRENCE_PATTERNS = ['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY'] as const;
export type RecurrencePatternV1 = (typeof RECURRENCE_PATTERNS)[number];

export type ReminderChangeV1 = {
  op: 'create' | 'update' | 'resolve' | 'delete';
  name?: string;
  dueYmd?: string;
  notificationTime?: string | null;
  recurrencePattern?: 'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | null;
};

export type OperationChangesV1 = {
  title?: string;
  notes?: string | null;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  status?: 'completed' | 'canceled';
  spanRole?: 'event' | 'window';
  location?: string | null;
  reminder?: ReminderChangeV1;
  /** Take the time off a task: it goes to Later with no start, end, window or deadline (V7). */
  unschedule?: true;
  /** The user asked for another task even though one with this title exists (add / create / another). */
  explicitNew?: true;
};

export type SemanticOperationV1 = {
  opId: string;
  action: SemanticActionV1;
  target: TargetRefV1;
  changes: OperationChangesV1;
  constraints: SemanticConstraintV1[];
  dependsOn: string[];
  /** all means the user named a set. One matched record is not that set. */
  scope?: 'one' | 'all';
  /**
   * Recurring-series scope. This is not bulk `scope: all`.
   * `from_day` is the product's "this day and following", stored on the client as `series`.
   */
  seriesScope?: 'occurrence' | 'from_day' | 'all';
  /** Current date (YYYY-MM-DD) of the occurrence the user means, for a recurring series. */
  occurrence?: string;
  /**
   * The pending operation this one takes the place of (V7): the user corrected which record a pending
   * operation applies to, or restated it for another record. The named operation is withdrawn; other
   * pending operations stay. Without it a new operation is added beside what is pending.
   */
  replaces?: string;
  /**
   * Runtime-only marker set by trusted bulk expansion.
   * The envelope parser does not copy this from model JSON.
   */
  trustedSetMember?: boolean;
  source: { text: string; span?: [number, number] };
};

export type ReadRequestV1 = {
  requestId: string;
  name: string;
  args: Record<string, unknown>;
};

export type DayPlanPhaseV1 = 'start' | 'edit' | 'question' | 'apply' | 'cancel';

export type DayPlanEditV1 =
  | {
      op: 'add_task';
      name: string;
      durationMinutes: number | null;
      preferredHm: string | null;
      earliestHm: string | null;
      deadlineHm: string | null;
      qualitative?: TimeOfDayLabelV1;
    }
  | { op: 'include_task'; taskId: string }
  | { op: 'remove_item'; itemId: string }
  | { op: 'set_preferred_start'; itemId: string; hm: string | null; qualitative?: TimeOfDayLabelV1 }
  | {
      op: 'set_window';
      itemId: string;
      earliestHm?: string | null;
      deadlineHm?: string | null;
    }
  | { op: 'set_duration'; itemId: string; minutes: number }
  | { op: 'set_order'; itemIds: string[] };

export type DayPlanCommandV1 = {
  phase: DayPlanPhaseV1;
  day?: string;
  question?: string;
  edits?: DayPlanEditV1[];
};

export type SemanticEnvelopeV1 = {
  version: '1';
  kind: 'operations' | 'answer' | 'clarification' | 'day_plan' | 'control';
  operations: SemanticOperationV1[];
  answer?: { text?: string; evidenceRefs?: string[] };
  clarification?: { question: string; operationIds: string[]; missing: string[] };
  control?: 'confirm_pending' | 'cancel_pending' | 'answer_pending';
  dayPlan?: DayPlanCommandV1;
  requestedReads?: ReadRequestV1[];
};

export type ValidationIssue = { code: string; path: string; detail: string };
