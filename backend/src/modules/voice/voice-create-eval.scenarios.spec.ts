import {
  CREATE_EVAL_BLOCK_SIZE,
  CREATE_EVAL_SCENARIOS,
  createEvalBlockCount,
  selectCreateEvalBlock,
} from './voice-create-eval.scenarios';

describe('CREATE_EVAL_SCENARIOS', () => {
  it('has Ukrainian first-message cases covering every branch', () => {
    expect(CREATE_EVAL_SCENARIOS.length).toBeGreaterThanOrEqual(300);
    expect(CREATE_EVAL_SCENARIOS.length % CREATE_EVAL_BLOCK_SIZE).toBe(0);
    expect(CREATE_EVAL_SCENARIOS.every((s) => s.language === 'uk')).toBe(true);
    const branches = new Set(CREATE_EVAL_SCENARIOS.map((s) => s.branch));
    expect(branches.has(1)).toBe(true);
    expect(branches.has(2)).toBe(true);
    expect(branches.has(3)).toBe(true);
    expect(branches.has(4)).toBe(true);
    expect(branches.has(5)).toBe(true);
    expect(branches.has(6)).toBe(true);
    expect(branches.has('clarify')).toBe(true);
  });

  it('uses unique ids and unique constructions', () => {
    const ids = CREATE_EVAL_SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const constructions = CREATE_EVAL_SCENARIOS.map((s) => s.construction);
    expect(constructions.every((c) => typeof c === 'string' && c.length > 0)).toBe(
      true,
    );
    expect(new Set(constructions).size).toBe(constructions.length);
  });

  it('splits the corpus into blocks of 50', () => {
    const count = createEvalBlockCount();
    expect(count).toBe(CREATE_EVAL_SCENARIOS.length / CREATE_EVAL_BLOCK_SIZE);

    const first = selectCreateEvalBlock(0);
    const latest = selectCreateEvalBlock('latest');
    expect(first).toHaveLength(CREATE_EVAL_BLOCK_SIZE);
    expect(latest).toHaveLength(CREATE_EVAL_BLOCK_SIZE);
    expect(first[0].id).toBe(CREATE_EVAL_SCENARIOS[0].id);
    expect(latest[0].id).toBe(
      CREATE_EVAL_SCENARIOS[CREATE_EVAL_SCENARIOS.length - CREATE_EVAL_BLOCK_SIZE]
        .id,
    );

    const seen = new Set<string>();
    for (let i = 0; i < count; i++) {
      const block = selectCreateEvalBlock(i);
      expect(block).toHaveLength(CREATE_EVAL_BLOCK_SIZE);
      for (const scenario of block) {
        expect(seen.has(scenario.id)).toBe(false);
        seen.add(scenario.id);
      }
    }
    expect(seen.size).toBe(CREATE_EVAL_SCENARIOS.length);
  });
});
