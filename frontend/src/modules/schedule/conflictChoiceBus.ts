export type ConflictOptionId =
  | 'move_other'
  | 'move_new'
  | 'skip_occurrence'
  | 'place_on_top'
  | 'leave_problematic';

export type SchedulingConflictDTO = {
  taskId: string;
  taskName: string;
  reason: 'preferred_on_fixed' | 'phase_full';
  options: ConflictOptionId[];
  meta?: Record<string, unknown>;
};

type Listener = (conflicts: SchedulingConflictDTO[]) => void;
type PendingListener = (conflict: SchedulingConflictDTO | null) => void;
type ConsumedListener = (taskId: string) => void;
type SettledListener = () => void;

let listener: Listener | null = null;
const emitSubscribers = new Set<Listener>();
const settledSubscribers = new Set<SettledListener>();
let pending: SchedulingConflictDTO | null = null;
const pendingListeners = new Set<PendingListener>();
const consumedListeners = new Set<ConsumedListener>();

/** Host (ConflictChoiceHost) registers once; emit after create/generate jobs. */
export function setConflictChoiceListener(next: Listener | null): void {
  listener = next;
}

/** Voice waits for the next conflict emit after create/window. */
export function subscribeScheduleConflictEmit(cb: Listener): () => void {
  emitSubscribers.add(cb);
  return () => {
    emitSubscribers.delete(cb);
  };
}

/** Job finished with no conflicts (or no job). */
export function subscribeScheduleJobSettled(cb: SettledListener): () => void {
  settledSubscribers.add(cb);
  return () => {
    settledSubscribers.delete(cb);
  };
}

export function notifyScheduleJobSettled(): void {
  for (const cb of settledSubscribers) cb();
}

export function emitScheduleConflicts(conflicts: SchedulingConflictDTO[]): void {
  if (!conflicts.length) {
    notifyScheduleJobSettled();
    return;
  }
  listener?.(conflicts);
  for (const cb of emitSubscribers) cb(conflicts);
}

/** For Voice/drag (§5–6): same entry as create/generate. */
export function openConflictChoice(conflicts: SchedulingConflictDTO[]): void {
  emitScheduleConflicts(conflicts);
}

/** Current sheet conflict (Host keeps this in sync with the queue head). */
export function getPendingConflictChoice(): SchedulingConflictDTO | null {
  return pending;
}

export function setPendingConflictChoice(next: SchedulingConflictDTO | null): void {
  pending = next;
  for (const cb of pendingListeners) cb(next);
}

export function subscribePendingConflict(cb: PendingListener): () => void {
  pendingListeners.add(cb);
  return () => {
    pendingListeners.delete(cb);
  };
}

/** Voice applied an option; Host drops that task from the queue. */
export function notifyConflictChoiceConsumed(taskId: string): void {
  for (const cb of consumedListeners) cb(taskId);
}

export function subscribeConflictChoiceConsumed(cb: ConsumedListener): () => void {
  consumedListeners.add(cb);
  return () => {
    consumedListeners.delete(cb);
  };
}

type VoiceOpener = () => void;
let voiceOpener: VoiceOpener | null = null;

/** Calendar/Tasks register so the conflict sheet can open Voice on top. */
export function setConflictVoiceOpener(next: VoiceOpener | null): void {
  voiceOpener = next;
}

export function openVoiceForConflictChoice(): void {
  voiceOpener?.();
}

/**
 * Await the next replan settle after create/update.
 * Resolves with a conflict if one was emitted, otherwise null when the job settles.
 */
export function waitForScheduleConflict(timeoutMs = 12_000): Promise<SchedulingConflictDTO | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: SchedulingConflictDTO | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubEmit();
      unsubSettled();
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    const unsubEmit = subscribeScheduleConflictEmit((incoming) => {
      if (incoming[0]) finish(incoming[0]);
    });
    const unsubSettled = subscribeScheduleJobSettled(() => finish(null));
  });
}
