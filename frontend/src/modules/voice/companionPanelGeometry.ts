export type CompanionPanelRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export const COMPANION_PANEL_STORAGE_KEY = 'companion-panel-geometry';

export const COMPANION_PANEL_MIN_WIDTH = 320;
export const COMPANION_PANEL_MIN_HEIGHT = 360;
export const COMPANION_PANEL_DEFAULT_WIDTH = 400;
export const COMPANION_PANEL_DEFAULT_HEIGHT = 520;
export const COMPANION_PANEL_MARGIN = 12;

export function defaultCompanionPanelRect(
  viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280,
  viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800,
): CompanionPanelRect {
  const width = Math.min(COMPANION_PANEL_DEFAULT_WIDTH, viewportWidth - COMPANION_PANEL_MARGIN * 2);
  const height = Math.min(COMPANION_PANEL_DEFAULT_HEIGHT, viewportHeight - COMPANION_PANEL_MARGIN * 2);
  return {
    width,
    height,
    left: Math.max(COMPANION_PANEL_MARGIN, viewportWidth - width - COMPANION_PANEL_MARGIN),
    top: Math.max(COMPANION_PANEL_MARGIN, viewportHeight - height - COMPANION_PANEL_MARGIN),
  };
}

export function clampCompanionPanelRect(
  rect: CompanionPanelRect,
  viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280,
  viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800,
): CompanionPanelRect {
  const maxWidth = Math.max(COMPANION_PANEL_MIN_WIDTH, viewportWidth - COMPANION_PANEL_MARGIN * 2);
  const maxHeight = Math.max(COMPANION_PANEL_MIN_HEIGHT, viewportHeight - COMPANION_PANEL_MARGIN * 2);
  const width = Math.min(Math.max(rect.width, COMPANION_PANEL_MIN_WIDTH), maxWidth);
  const height = Math.min(Math.max(rect.height, COMPANION_PANEL_MIN_HEIGHT), maxHeight);
  const maxLeft = Math.max(COMPANION_PANEL_MARGIN, viewportWidth - width - COMPANION_PANEL_MARGIN);
  const maxTop = Math.max(COMPANION_PANEL_MARGIN, viewportHeight - height - COMPANION_PANEL_MARGIN);
  return {
    width,
    height,
    left: Math.min(Math.max(rect.left, COMPANION_PANEL_MARGIN), maxLeft),
    top: Math.min(Math.max(rect.top, COMPANION_PANEL_MARGIN), maxTop),
  };
}

export function loadCompanionPanelRect(): CompanionPanelRect {
  const fallback = defaultCompanionPanelRect();
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(COMPANION_PANEL_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<CompanionPanelRect>;
    if (
      typeof parsed.left !== 'number' ||
      typeof parsed.top !== 'number' ||
      typeof parsed.width !== 'number' ||
      typeof parsed.height !== 'number'
    ) {
      return fallback;
    }
    return clampCompanionPanelRect({
      left: parsed.left,
      top: parsed.top,
      width: parsed.width,
      height: parsed.height,
    });
  } catch {
    return fallback;
  }
}

export function saveCompanionPanelRect(rect: CompanionPanelRect): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      COMPANION_PANEL_STORAGE_KEY,
      JSON.stringify(clampCompanionPanelRect(rect)),
    );
  } catch {
    // ignore quota / private mode
  }
}
