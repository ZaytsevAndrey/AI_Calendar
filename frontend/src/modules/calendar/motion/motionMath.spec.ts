import {
  arcControl,
  arcTransforms,
  boxMoved,
  joinKeys,
  offscreenDirection,
  splitKeys,
  springEasing,
  stageProgress,
  travelTransform,
} from './motionMath';

function easingPoints(easing: string): number[] {
  const inner = easing.slice('linear('.length, -1);
  return inner.split(',').map((value) => Number(value.trim()));
}

describe('springEasing', () => {
  it('starts at rest, ends exactly at 1 and overshoots a little', () => {
    const points = easingPoints(springEasing(0.2));
    expect(points[0]).toBe(0);
    expect(points[points.length - 1]).toBe(1);
    expect(Math.max(...points)).toBeGreaterThan(1);
    expect(Math.max(...points)).toBeLessThan(1.15);
  });

  it('does not overshoot without bounce', () => {
    const points = easingPoints(springEasing(0));
    expect(Math.max(...points)).toBeLessThanOrEqual(1);
  });

  it('a lazier spring is further from the end halfway through', () => {
    const snappy = easingPoints(springEasing(0.1, 1.6));
    const lazy = easingPoints(springEasing(0.1, 1));
    const mid = Math.floor(snappy.length / 4);
    expect(lazy[mid]).toBeLessThan(snappy[mid]);
  });
});

describe('travelTransform', () => {
  it('moves center to center with one uniform scale', () => {
    const from = { left: 0, top: 0, width: 100, height: 40 };
    const to = { left: 200, top: 100, width: 100, height: 40 };
    expect(travelTransform(from, to)).toBe('translate(-200px, -100px) scale(1)');
  });

  it('clamps the scale so a wide row and a short chip only hint at each other', () => {
    const row = { left: 0, top: 0, width: 300, height: 60 };
    const chip = { left: 0, top: 0, width: 120, height: 12 };
    expect(travelTransform(row, chip)).toContain('scale(1.2)');
    expect(travelTransform(chip, row)).toContain('scale(0.4)');
  });
});

describe('boxMoved', () => {
  it('ignores sub-pixel jitter and sees a real move', () => {
    const a = { left: 10, top: 10, width: 50, height: 20 };
    expect(boxMoved(a, { ...a, left: 11 })).toBe(false);
    expect(boxMoved(a, { ...a, top: 30 })).toBe(true);
    expect(boxMoved(a, { ...a, height: 40 })).toBe(true);
  });
});

describe('offscreenDirection', () => {
  const range = { startMs: 1_000, endMs: 2_000 };

  it('points at the arrow the date hides behind', () => {
    expect(offscreenDirection(500, range)).toBe('prev');
    expect(offscreenDirection(2_000, range)).toBe('next');
    expect(offscreenDirection(1_500, range)).toBeNull();
  });

  it('has no answer without a range', () => {
    expect(offscreenDirection(500, null)).toBeNull();
  });
});

describe('stageProgress', () => {
  it('fills with the server stages', () => {
    expect(stageProgress('saving')).toBeLessThan(stageProgress('placing'));
    expect(stageProgress('placing')).toBeLessThan(stageProgress('syncing'));
    expect(stageProgress('done')).toBe(1);
    expect(stageProgress(null)).toBe(0);
  });
});

describe('keys', () => {
  it('round-trips and drops empties and repeats', () => {
    const joined = joinKeys(['ev-1', null, 'task-1', 'ev-1', undefined]);
    expect(joined).toBe('ev-1 task-1');
    expect(splitKeys(joined)).toEqual(['ev-1', 'task-1']);
    expect(splitKeys(undefined)).toEqual([]);
  });
});

describe('arcs', () => {
  it('bulges a sideways flight upward', () => {
    const control = arcControl({ x: 0, y: 100 }, { x: 400, y: 100 });
    expect(control.x).toBe(200);
    expect(control.y).toBeLessThan(100);
  });

  it('bulges a vertical flight toward the middle of the screen', () => {
    const left = arcControl({ x: 100, y: 0 }, { x: 100, y: 400 }, 0.28, 1440);
    const right = arcControl({ x: 1300, y: 0 }, { x: 1300, y: 400 }, 0.28, 1440);
    expect(left.x).toBeGreaterThan(100);
    expect(right.x).toBeLessThan(1300);
  });

  it('starts at the start box and ends exactly at the base', () => {
    const start = { left: 0, top: 0, width: 100, height: 40 };
    const end = { left: 300, top: 200, width: 100, height: 40 };
    const frames = arcTransforms({ start, end, base: end, lift: 0 });
    expect(frames[0]).toBe('translate(-300px, -200px) scale(1)');
    expect(frames[frames.length - 1]).toBe('translate(0px, 0px) scale(1)');
    // Off the straight line in the middle.
    const mid = frames[Math.floor(frames.length / 2)].match(/translate\((-?[\d.]+)px, (-?[\d.]+)px\)/);
    const [x, y] = [Number(mid?.[1]), Number(mid?.[2])];
    // The straight line passes (-150, -100) halfway; the arc bulges up off it.
    expect(x).toBeGreaterThan(-150);
    expect(y).toBeLessThan(-100);
  });
});
