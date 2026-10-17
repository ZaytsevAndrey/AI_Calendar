import {
  INTENT_EVAL_BLOCK_SIZE,
  INTENT_EVAL_SCENARIOS,
  intentEvalBlockCount,
  selectIntentEvalBlock,
} from './voice-intent-eval.scenarios';
import { CLARIFY_EVAL_SCENARIOS } from './voice-clarify-eval.scenarios';

describe('INTENT_EVAL_SCENARIOS', () => {
  it('covers every non-create router intent with unique constructions', () => {
    expect(INTENT_EVAL_SCENARIOS.length).toBeGreaterThanOrEqual(100);
    expect(INTENT_EVAL_SCENARIOS.every((s) => s.language === 'uk')).toBe(true);
    const intents = new Set(INTENT_EVAL_SCENARIOS.map((s) => s.intent));
    for (const intent of [
      'update',
      'delete',
      'complete',
      'skip',
      'reschedule',
      'needs_clarification',
    ]) {
      expect(intents.has(intent as never)).toBe(true);
    }
    const ids = INTENT_EVAL_SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const constructions = INTENT_EVAL_SCENARIOS.map((s) => s.construction);
    expect(new Set(constructions).size).toBe(constructions.length);
  });

  it('splits into blocks', () => {
    const count = intentEvalBlockCount();
    expect(count).toBeGreaterThanOrEqual(1);
    const first = selectIntentEvalBlock(0);
    expect(first.length).toBeLessThanOrEqual(INTENT_EVAL_BLOCK_SIZE);
    expect(first.length).toBeGreaterThan(0);
  });
});

describe('CLARIFY_EVAL_SCENARIOS', () => {
  it('has unique UK clarify-continue constructions', () => {
    expect(CLARIFY_EVAL_SCENARIOS).toHaveLength(50);
    expect(CLARIFY_EVAL_SCENARIOS.every((s) => s.language === 'uk')).toBe(true);
    const ids = CLARIFY_EVAL_SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const constructions = CLARIFY_EVAL_SCENARIOS.map((s) => s.construction);
    expect(new Set(constructions).size).toBe(constructions.length);
  });
});
