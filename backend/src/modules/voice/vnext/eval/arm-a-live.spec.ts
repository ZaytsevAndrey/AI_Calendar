import type { SemanticEnvelopeV1 } from '../contracts/types';
import { gpt6LunaUsd } from '../llm/pricing';
import { armAEvaluationPlan, classifyArmAResult, reserveUsd, selectArmACases, wouldExceed, DISPUTED_IDS } from './arm-a-live';

describe('Phase 4.4 arm A plan', () => {
  it('makes no model calls while describing the dataset', () => {
    const plan = armAEvaluationPlan(new Date('2026-10-28T00:22:00.000Z'));
    const selected = selectArmACases();
    expect(plan.liveCalls).toBe(0);
    expect(plan.modelCalls).toBe(0);
    expect(plan.writes).toBe(0);
    expect(plan.dataset.edgeCases).toBe(39);
    expect(plan.dataset.originalFixtures).toBe(77);
    expect(plan.scoredEdges).toBe(39);
    expect(selected.excluded.map((row) => row.id)).toEqual(expect.arrayContaining([...DISPUTED_IDS]));
    expect(plan.eligible).toBe(selected.cases.length);
    expect(plan.costUsd.minimumOffPeak).toBeGreaterThan(0);
    expect(plan.costUsd.maximumPeak).toBeGreaterThan(plan.costUsd.minimumOffPeak);
  });

  it('stops before a call that would cross the budget', () => {
    expect(wouldExceed(0.2, 0.05, 0.24)).toBe('the next call reserve would exceed the budget');
    expect(wouldExceed(null, 0.01, 1)).toBe('usage split missing, so the next call is not started');
    expect(wouldExceed(0.2, 0.01, 0.24)).toBeNull();
    const reserve = reserveUsd(1000, new Date('2026-10-28T00:22:00.000Z'));
    expect(reserve.usd).toBeGreaterThan(0);
    expect(reserve.peak).toBe(false);
  });

  it('prices gpt-6-luna from the published short-context rates', () => {
    expect(gpt6LunaUsd({ cacheHit: 0, cacheMiss: 1_000_000, output: 1_000_000 })).toEqual({ usd: 0.6, peak: false });
    expect(gpt6LunaUsd({ cacheHit: 1_000_000, cacheMiss: 0, output: 0 }).usd).toBe(0.01);
  });

  it('does not call an unsupported block an interpreter failure when the authored shape matches', () => {
    const envelope = {
      version: '1',
      kind: 'operations',
      operations: [{
        opId: 'op-1',
        action: 'create',
        target: { kind: 'new', localId: 'local-1' },
        changes: { title: 'Standup' },
        constraints: [{ kind: 'recurrence', expression: 'daily' }],
        dependsOn: [],
        source: { text: 'daily' },
      }],
    } satisfies SemanticEnvelopeV1;
    const judged = classifyArmAResult({
      scored: true,
      rubric: 'fail',
      interpreterOk: true,
      live: envelope,
      authored: envelope,
      outcome: 'clarify',
      blocked: ['unrepresented_constraint'],
      serverWrites: 0,
      category: 'reminder',
    });
    expect(judged.classification).toBe('FAIL - unsupported capability');
  });
});
