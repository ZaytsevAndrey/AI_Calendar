export const EVENT_DRAG_SNAP_MIN = 15;
export const EVENT_DRAG_MIN_DURATION_MIN = 15;

export type EventDragMode = 'move' | 'resize-start' | 'resize-end';

export function snapMinutes(minutes: number, step: number): number {
  return Math.round(minutes / step) * step;
}

export function pointerMinutes(
  clientY: number,
  columnTop: number,
  columnHeight: number,
  dayStartMin: number,
  daySpanMin: number,
): number {
  const height = Math.max(columnHeight, 1);
  const y = Math.max(0, Math.min(height, clientY - columnTop));
  return dayStartMin + (y / height) * daySpanMin;
}

export function dayIndexAtX(
  clientX: number,
  columns: { left: number; right: number }[],
): number {
  if (!columns.length) return 0;
  const inside = columns.findIndex(
    (col) => clientX >= col.left && clientX <= col.right,
  );
  if (inside >= 0) return inside;
  let best = 0;
  let bestDist = Infinity;
  columns.forEach((col, index) => {
    const dist = Math.abs(clientX - (col.left + col.right) / 2);
    if (dist < bestDist) {
      best = index;
      bestDist = dist;
    }
  });
  return best;
}

export function applyEventDrag(input: {
  mode: EventDragMode;
  startMin: number;
  endMin: number;
  pointerMin: number;
  grabOffsetMin: number;
  dayStartMin: number;
  dayEndMin: number;
  dayIndex: number;
  pointerDayIndex: number;
}): { startMin: number; endMin: number; dayIndex: number } {
  const minDur = EVENT_DRAG_MIN_DURATION_MIN;
  const span = Math.max(input.dayEndMin - input.dayStartMin, minDur);
  const duration = Math.min(span, Math.max(minDur, input.endMin - input.startMin));

  if (input.mode === 'move') {
    let nextStart = snapMinutes(
      input.pointerMin - input.grabOffsetMin,
      EVENT_DRAG_SNAP_MIN,
    );
    const maxStart = input.dayEndMin - duration;
    nextStart = Math.max(input.dayStartMin, Math.min(maxStart, nextStart));
    return {
      startMin: nextStart,
      endMin: nextStart + duration,
      dayIndex: input.pointerDayIndex,
    };
  }

  if (input.mode === 'resize-start') {
    let nextStart = snapMinutes(input.pointerMin, EVENT_DRAG_SNAP_MIN);
    nextStart = Math.max(
      input.dayStartMin,
      Math.min(input.endMin - minDur, nextStart),
    );
    return {
      startMin: nextStart,
      endMin: input.endMin,
      dayIndex: input.dayIndex,
    };
  }

  let nextEnd = snapMinutes(input.pointerMin, EVENT_DRAG_SNAP_MIN);
  nextEnd = Math.max(input.startMin + minDur, Math.min(input.dayEndMin, nextEnd));
  return {
    startMin: input.startMin,
    endMin: nextEnd,
    dayIndex: input.dayIndex,
  };
}

export function dateOnDayAtMinutes(day: Date, minutes: number): Date {
  const d = new Date(day);
  d.setHours(0, 0, 0, 0);
  const whole = Math.max(0, Math.round(minutes));
  d.setHours(Math.floor(whole / 60), whole % 60, 0, 0);
  return d;
}

export function layoutEventLanes(
  items: { id: string; startMin: number; endMin: number }[],
): Map<string, { lane: number; laneCount: number }> {
  const sorted = [...items].sort(
    (a, b) => a.startMin - b.startMin || a.endMin - b.endMin,
  );
  const laneEnds: number[] = [];
  const laneOf = new Map<string, number>();
  for (const item of sorted) {
    let lane = laneEnds.findIndex((end) => end <= item.startMin);
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.push(item.endMin);
    } else {
      laneEnds[lane] = item.endMin;
    }
    laneOf.set(item.id, lane);
  }

  const result = new Map<string, { lane: number; laneCount: number }>();
  for (const item of sorted) {
    const overlaps = sorted.filter(
      (other) => other.startMin < item.endMin && item.startMin < other.endMin,
    );
    const laneCount = Math.max(
      1,
      ...overlaps.map((other) => (laneOf.get(other.id) ?? 0) + 1),
    );
    result.set(item.id, { lane: laneOf.get(item.id) ?? 0, laneCount });
  }
  return result;
}
