import {
  EVENT_DRAG_MIN_DURATION_MIN,
  EVENT_DRAG_SNAP_MIN,
  snapMinutes,
} from './eventDrag';

/**
 * Time range for a drag on an empty day column.
 * The press is one edge and the pointer is the other. Both snap to 15 minutes.
 * A drag that stays inside one slot still covers that 15-minute step, growing
 * downward unless the pointer is above the press.
 */
export function applyTimeSelection(input: {
  anchorMin: number;
  pointerMin: number;
  dayStartMin: number;
  dayEndMin: number;
}): { startMin: number; endMin: number } {
  const step = EVENT_DRAG_SNAP_MIN;
  const minDur = EVENT_DRAG_MIN_DURATION_MIN;
  const dayStart = input.dayStartMin;
  const dayEnd = Math.max(input.dayEndMin, dayStart + minDur);
  const upward = input.pointerMin < input.anchorMin;

  const clamp = (minutes: number) =>
    Math.max(dayStart, Math.min(dayEnd, snapMinutes(minutes, step)));

  let start = Math.min(clamp(input.anchorMin), clamp(input.pointerMin));
  let end = Math.max(clamp(input.anchorMin), clamp(input.pointerMin));

  if (end - start < minDur) {
    if (upward) {
      start = Math.max(dayStart, end - minDur);
      if (end - start < minDur) end = Math.min(dayEnd, start + minDur);
    } else {
      end = Math.min(dayEnd, start + minDur);
      if (end - start < minDur) start = Math.max(dayStart, end - minDur);
    }
  }

  return { startMin: start, endMin: end };
}
