import { isFixedEventType } from '../scheduling/event-type.enum';

const SLOT_MATCH_MS = 60_000;

export type MoveTaskRef = {
  id: string;
  eventType: string;
  isRecurring: boolean;
  googleEventId: string | null;
};

export type MoveSlotRef = {
  id: string;
  taskId: string;
  googleEventId: string | null;
  scheduledStartTime: string;
};

export type DisplayedMovePlan =
  | { kind: 'rejected'; reason: 'habit' }
  | { kind: 'fixed'; taskId: string }
  | {
      kind: 'slot';
      slotId: string;
      taskId: string;
      updateTaskWindow: boolean;
    }
  | { kind: 'google' };

export function planDisplayedEventMove(input: {
  googleEventId: string;
  recurringEventId?: string | null;
  originalStartIso: string;
  isHabit: boolean;
  tasks: MoveTaskRef[];
  slots: MoveSlotRef[];
}): DisplayedMovePlan {
  if (input.isHabit) {
    return { kind: 'rejected', reason: 'habit' };
  }

  const ids = [input.googleEventId, input.recurringEventId].filter(
    (id): id is string => Boolean(id),
  );
  const task = input.tasks.find(
    (row) => !!row.googleEventId && ids.includes(row.googleEventId),
  );

  if (task && isFixedEventType(task.eventType) && !task.isRecurring) {
    return { kind: 'fixed', taskId: task.id };
  }

  const byInstance = input.slots.find(
    (slot) => slot.googleEventId === input.googleEventId,
  );
  const slot = byInstance ?? closestSlot(input.slots, task?.id, input.originalStartIso);
  if (slot) {
    const slotTask =
      input.tasks.find((row) => row.id === slot.taskId) ?? task ?? null;
    return {
      kind: 'slot',
      slotId: slot.id,
      taskId: slot.taskId,
      updateTaskWindow: !!slotTask && !slotTask.isRecurring,
    };
  }

  return { kind: 'google' };
}

function closestSlot(
  slots: MoveSlotRef[],
  taskId: string | undefined,
  originalStartIso: string,
): MoveSlotRef | undefined {
  if (!taskId) return undefined;
  const origin = new Date(originalStartIso).getTime();
  if (Number.isNaN(origin)) return undefined;
  let best: MoveSlotRef | undefined;
  let bestDelta = SLOT_MATCH_MS + 1;
  for (const slot of slots) {
    if (slot.taskId !== taskId) continue;
    const delta = Math.abs(new Date(slot.scheduledStartTime).getTime() - origin);
    if (delta < bestDelta) {
      best = slot;
      bestDelta = delta;
    }
  }
  return bestDelta <= SLOT_MATCH_MS ? best : undefined;
}
