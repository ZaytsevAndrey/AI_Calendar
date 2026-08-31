/** Google Calendar API event colorId → RGB (approximate brand colors). */
const GOOGLE_EVENT_COLOR_RGB: Record<string, [number, number, number]> = {
  '1': [121, 134, 203], // Lavender
  '2': [51, 182, 121], // Sage
  '3': [142, 36, 170], // Grape
  '4': [230, 124, 115], // Flamingo
  '5': [246, 191, 38], // Banana
  '6': [244, 81, 30], // Tangerine
  '7': [3, 155, 229], // Peacock
  '8': [97, 97, 97], // Graphite
  '9': [63, 81, 181], // Blueberry
  '10': [11, 128, 67], // Basil
  '11': [213, 0, 0], // Tomato
};

function parseHexRgb(hex: string): [number, number, number] | null {
  const t = hex.trim();
  const m6 = t.match(/^#?([0-9a-f]{6})$/i);
  if (m6) {
    const n = parseInt(m6[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m3 = t.match(/^#?([0-9a-f]{3})$/i);
  if (m3) {
    const s = m3[1];
    const r = parseInt(s[0] + s[0], 16);
    const g = parseInt(s[1] + s[1], 16);
    const b = parseInt(s[2] + s[2], 16);
    return [r, g, b];
  }
  return null;
}

function colorDistance(
  a: [number, number, number],
  b: [number, number, number],
): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

/** Maps a phase UI hex color to the closest Google Calendar `colorId` (1–11). */
export function phaseHexToGoogleColorId(
  hex: string | null | undefined,
): string | undefined {
  const rgb = parseHexRgb(hex ?? '');
  if (!rgb) return undefined;
  let bestId = '1';
  let best = Infinity;
  for (const [id, g] of Object.entries(GOOGLE_EVENT_COLOR_RGB)) {
    const d = colorDistance(rgb, g);
    if (d < best) {
      best = d;
      bestId = id;
    }
  }
  return bestId;
}
