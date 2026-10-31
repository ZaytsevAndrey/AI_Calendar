import { ENGLISH_SCENARIOS, englishWorld } from './english-set';
import { GENERALIZATION_SCENARIOS } from './phase47-generalization';
import { HARD_SCENARIOS, hardWorld } from './hard-set';

// Offline shape check of the English live set (KI-19). No model is called here.
describe('english live set', () => {
  it('has unique ids, English language, and worlds that exist', () => {
    const ids = ENGLISH_SCENARIOS.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const row of ENGLISH_SCENARIOS) {
      expect(row.language).toBe('en');
      expect(row.turns.length).toBeGreaterThan(0);
      expect(Array.isArray(englishWorld(row.world))).toBe(true);
    }
  });

  it('names only ids that exist in its world', () => {
    for (const row of ENGLISH_SCENARIOS) {
      const known = new Set(englishWorld(row.world).map((entity) => entity.id));
      for (const turn of row.turns) {
        for (const id of [turn.expect.taskId, turn.expect.forbidTaskId]) {
          if (id) expect(known.has(id)).toBe(true);
        }
      }
    }
  });

  it('mirrors Ukrainian scenarios that exist, with the same family and turn count', () => {
    const byId = new Map(GENERALIZATION_SCENARIOS.map((row) => [row.id, row]));
    const mirrored = ENGLISH_SCENARIOS.filter((row) => row.mirrors);
    expect(mirrored.length).toBeGreaterThanOrEqual(9);
    for (const row of mirrored) {
      const source = byId.get(row.mirrors!);
      expect(source).toBeDefined();
      expect(row.family).toBe(source!.family);
      expect(row.turns.length).toBe(source!.turns.length);
    }
  });
});

describe('V7 hard set', () => {
  it('has unique ids, a language, and names only ids that exist in its world', () => {
    const ids = HARD_SCENARIOS.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const row of HARD_SCENARIOS) {
      expect(['uk', 'en']).toContain(row.language);
      expect(row.turns.length).toBeGreaterThan(0);
      const known = new Set(hardWorld(row.world).map((entity) => entity.id));
      for (const turn of row.turns) {
        for (const id of [turn.expect.taskId, turn.expect.forbidTaskId]) {
          if (id) expect(known.has(id)).toBe(true);
        }
      }
    }
  });
});
