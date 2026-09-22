import {
  applyEventDrag,
  dateOnDayAtMinutes,
  dayIndexAtX,
  layoutEventLanes,
} from './eventDrag';

const bounds = { dayStartMin: 7 * 60, dayEndMin: 23 * 60 };

describe('applyEventDrag', () => {
  it('moves by 15 minute steps and keeps duration', () => {
    const next = applyEventDrag({
      mode: 'move',
      startMin: 9 * 60,
      endMin: 10 * 60,
      pointerMin: 11 * 60 + 7,
      grabOffsetMin: 0,
      ...bounds,
      dayIndex: 0,
      pointerDayIndex: 0,
    });
    expect(next).toEqual({ startMin: 11 * 60, endMin: 12 * 60, dayIndex: 0 });
  });

  it('clamps a move to the start of the visible day', () => {
    const next = applyEventDrag({
      mode: 'move',
      startMin: 9 * 60,
      endMin: 10 * 60,
      pointerMin: 7 * 60,
      grabOffsetMin: 30,
      ...bounds,
      dayIndex: 1,
      pointerDayIndex: 1,
    });
    expect(next.startMin).toBe(7 * 60);
    expect(next.endMin).toBe(8 * 60);
  });

  it('follows the column under the pointer when moving', () => {
    const next = applyEventDrag({
      mode: 'move',
      startMin: 9 * 60,
      endMin: 9 * 60 + 30,
      pointerMin: 9 * 60,
      grabOffsetMin: 0,
      ...bounds,
      dayIndex: 0,
      pointerDayIndex: 3,
    });
    expect(next.dayIndex).toBe(3);
  });

  it('resizes the start without changing the day or inverting the block', () => {
    const next = applyEventDrag({
      mode: 'resize-start',
      startMin: 9 * 60,
      endMin: 10 * 60,
      pointerMin: 10 * 60,
      grabOffsetMin: 0,
      ...bounds,
      dayIndex: 2,
      pointerDayIndex: 5,
    });
    expect(next).toEqual({
      startMin: 10 * 60 - 15,
      endMin: 10 * 60,
      dayIndex: 2,
    });
  });

  it('resizes the end and clamps to the visible day', () => {
    const next = applyEventDrag({
      mode: 'resize-end',
      startMin: 22 * 60,
      endMin: 22 * 60 + 30,
      pointerMin: 23 * 60 + 40,
      grabOffsetMin: 0,
      ...bounds,
      dayIndex: 0,
      pointerDayIndex: 1,
    });
    expect(next.endMin).toBe(23 * 60);
    expect(next.dayIndex).toBe(0);
  });
});

describe('dayIndexAtX', () => {
  const columns = [
    { left: 0, right: 100 },
    { left: 100, right: 200 },
  ];

  it('returns the column that contains the pointer', () => {
    expect(dayIndexAtX(150, columns)).toBe(1);
  });

  it('returns the nearest column when the pointer is outside', () => {
    expect(dayIndexAtX(240, columns)).toBe(1);
  });
});

describe('layoutEventLanes', () => {
  it('puts overlapping events side by side and reuses a free lane', () => {
    const lanes = layoutEventLanes([
      { id: 'a', startMin: 9 * 60, endMin: 10 * 60 },
      { id: 'b', startMin: 9 * 60 + 30, endMin: 10 * 60 + 30 },
      { id: 'c', startMin: 10 * 60, endMin: 11 * 60 },
    ]);
    expect(lanes.get('a')).toEqual({ lane: 0, laneCount: 2 });
    expect(lanes.get('b')).toEqual({ lane: 1, laneCount: 2 });
    expect(lanes.get('c')?.lane).toBe(0);
  });
});

describe('dateOnDayAtMinutes', () => {
  it('builds a local date at the snapped clock time', () => {
    const day = new Date(2026, 8, 22, 15, 45, 10);
    const next = dateOnDayAtMinutes(day, 9 * 60 + 15);
    expect(next.getFullYear()).toBe(2026);
    expect(next.getMonth()).toBe(8);
    expect(next.getDate()).toBe(22);
    expect(next.getHours()).toBe(9);
    expect(next.getMinutes()).toBe(15);
  });
});
