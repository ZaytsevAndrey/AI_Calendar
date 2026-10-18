import {
  COMPANION_PANEL_MIN_HEIGHT,
  COMPANION_PANEL_MIN_WIDTH,
  clampCompanionPanelRect,
  defaultCompanionPanelRect,
} from './companionPanelGeometry';

describe('companionPanelGeometry', () => {
  it('defaults to the lower-right of the viewport', () => {
    const rect = defaultCompanionPanelRect(1200, 800);
    expect(rect.width).toBeLessThanOrEqual(400);
    expect(rect.height).toBeLessThanOrEqual(520);
    expect(rect.left + rect.width).toBeLessThanOrEqual(1200);
    expect(rect.top + rect.height).toBeLessThanOrEqual(800);
    expect(rect.left).toBeGreaterThan(600);
  });

  it('clamps below-minimum sizes up', () => {
    const rect = clampCompanionPanelRect(
      { left: 0, top: 0, width: 100, height: 100 },
      1200,
      800,
    );
    expect(rect.width).toBe(COMPANION_PANEL_MIN_WIDTH);
    expect(rect.height).toBe(COMPANION_PANEL_MIN_HEIGHT);
    expect(rect.left).toBeGreaterThanOrEqual(12);
    expect(rect.top).toBeGreaterThanOrEqual(12);
  });

  it('keeps the panel inside the viewport when dragged off-screen', () => {
    const rect = clampCompanionPanelRect(
      { left: 5000, top: 5000, width: 400, height: 400 },
      1000,
      700,
    );
    expect(rect.left + rect.width).toBeLessThanOrEqual(1000);
    expect(rect.top + rect.height).toBeLessThanOrEqual(700);
  });
});
