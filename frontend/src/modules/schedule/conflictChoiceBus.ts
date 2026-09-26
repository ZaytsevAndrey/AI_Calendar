export type ConflictOptionId =
  | 'move_other'
  | 'move_new'
  | 'skip_occurrence'
  | 'leave_problematic';

export type SchedulingConflictDTO = {
  taskId: string;
  taskName: string;
  reason: 'preferred_on_fixed' | 'phase_full';
  options: ConflictOptionId[];
  meta?: Record<string, unknown>;
};

type Listener = (conflicts: SchedulingConflictDTO[]) => void;

let listener: Listener | null = null;

/** Host (ConflictChoiceHost) registers once; emit after create/generate jobs. */
export function setConflictChoiceListener(next: Listener | null): void {
  listener = next;
}

export function emitScheduleConflicts(conflicts: SchedulingConflictDTO[]): void {
  if (!conflicts.length || !listener) return;
  listener(conflicts);
}

/** For Voice/drag (§5–6): same entry as create/generate. */
export function openConflictChoice(conflicts: SchedulingConflictDTO[]): void {
  emitScheduleConflicts(conflicts);
}
