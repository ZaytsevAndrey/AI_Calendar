/** Answers offered when a claim lands on an anchor (spec-conflict-rules.md). */
export type ConflictOptionId =
  | 'move_other'
  | 'move_new'
  | 'skip_occurrence'
  | 'place_on_top'
  | 'leave_problematic';

/** A placement that needs the user's choice; nothing was written. */
export type SchedulingConflict = {
  taskId: string;
  taskName: string;
  reason: 'preferred_on_fixed' | 'phase_full';
  options: ConflictOptionId[];
  meta?: Record<string, unknown>;
};
