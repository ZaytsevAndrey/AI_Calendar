import { applyTimeSelection } from './timeSelection';

const bounds = { dayStartMin: 7 * 60, dayEndMin: 23 * 60 };

describe('applyTimeSelection', () => {
  it('snaps a downward drag to 15 minute edges', () => {
    expect(
      applyTimeSelection({
        anchorMin: 10 * 60 + 7,
        pointerMin: 11 * 60 + 22,
        ...bounds,
      }),
    ).toEqual({ startMin: 10 * 60, endMin: 11 * 60 + 15 });
  });

  it('grows upward when the pointer moves above the press', () => {
    expect(
      applyTimeSelection({
        anchorMin: 11 * 60,
        pointerMin: 10 * 60 + 7,
        ...bounds,
      }),
    ).toEqual({ startMin: 10 * 60, endMin: 11 * 60 });
  });

  it('keeps a 15 minute block downward when the drag stays in the press slot', () => {
    expect(
      applyTimeSelection({
        anchorMin: 10 * 60,
        pointerMin: 10 * 60 + 7,
        ...bounds,
      }),
    ).toEqual({ startMin: 10 * 60, endMin: 10 * 60 + 15 });
  });

  it('keeps a 15 minute block upward when the drag stays in the press slot', () => {
    expect(
      applyTimeSelection({
        anchorMin: 10 * 60 + 7,
        pointerMin: 10 * 60 + 2,
        ...bounds,
      }),
    ).toEqual({ startMin: 9 * 60 + 45, endMin: 10 * 60 });
  });

  it('clamps an upward drag to the start of the visible day', () => {
    expect(
      applyTimeSelection({
        anchorMin: 7 * 60 + 5,
        pointerMin: 7 * 60,
        ...bounds,
      }),
    ).toEqual({ startMin: 7 * 60, endMin: 7 * 60 + 15 });
  });

  it('clamps a downward drag to the end of the visible day', () => {
    expect(
      applyTimeSelection({
        anchorMin: 22 * 60 + 55,
        pointerMin: 23 * 60,
        ...bounds,
      }),
    ).toEqual({ startMin: 22 * 60 + 45, endMin: 23 * 60 });
  });
});
