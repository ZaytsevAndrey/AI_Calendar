import { corpusCounts, DIALOGUE_CORPUS } from './index';

describe('voice dialogue corpus', () => {
  it('gives every specialist and the dialogue its own scenarios', () => {
    const counts = corpusCounts();
    expect(counts).toEqual({
      create: 53,
      update: 18,
      delete: 8,
      complete: 7,
      skip: 6,
      reschedule: 16,
      dialogue: 44,
      'fast-create': 11,
    });
    expect(DIALOGUE_CORPUS).toHaveLength(163);
  });

  it('uses one construction per scenario', () => {
    const ids = DIALOGUE_CORPUS.map((scenario) => scenario.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
