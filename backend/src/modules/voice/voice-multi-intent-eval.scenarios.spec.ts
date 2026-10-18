import {
  matchMultiIntentTurn,
  MULTI_INTENT_EVAL_SCENARIOS,
} from './voice-multi-intent-eval.scenarios';
import type { VoiceTurnResponse } from './voice-agent.types';

function response(patch: Partial<VoiceTurnResponse>): VoiceTurnResponse {
  return {
    sessionId: 's',
    outcome: 'act',
    assistantMessage: '',
    intents: [],
    actions: [],
    plan: null,
    segments: [],
    clarifyCount: 0,
    legacyParse: null,
    ...patch,
  };
}

describe('multi-intent eval corpus', () => {
  it('has unique ids, both languages and at least 40 turns', () => {
    const ids = MULTI_INTENT_EVAL_SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const languages = new Set(MULTI_INTENT_EVAL_SCENARIOS.map((s) => s.language));
    expect([...languages].sort()).toEqual(['en', 'uk']);
    const turns = MULTI_INTENT_EVAL_SCENARIOS.reduce((sum, s) => sum + s.turns.length, 0);
    expect(turns).toBeGreaterThanOrEqual(40);
  });
});

describe('matchMultiIntentTurn', () => {
  const intents = [
    { type: 'create' as const, summary: 'a', task: { name: 'A' } },
    { type: 'command' as const, summary: 'b', command: { kind: 'complete' } },
  ];

  it('matches kinds as a multiset in any order', () => {
    expect(matchMultiIntentTurn({ outcome: 'act', kinds: ['complete', 'create'] }, response({ intents })).ok).toBe(true);
    const miss = matchMultiIntentTurn({ outcome: 'act', kinds: ['create', 'create'] }, response({ intents }));
    expect(miss.ok).toBe(false);
    expect(miss.failures[0]).toContain('missing create');
    expect(matchMultiIntentTurn({ outcome: 'act', kinds: ['skip|complete'] }, response({ intents })).ok).toBe(true);
  });

  it('checks outcome alternatives, counts and answers', () => {
    const res = response({ outcome: 'confirm', intents, assistantMessage: ' ' });
    expect(matchMultiIntentTurn({ outcome: ['act', 'confirm'], maxIntents: 2 }, res).ok).toBe(true);
    const bad = matchMultiIntentTurn({ outcome: 'act', maxIntents: 1, answer: true }, res);
    expect(bad.failures).toHaveLength(3);
  });

  it('checks plan stage and names', () => {
    const res = response({
      outcome: 'confirm',
      plan: {
        day: '2026-10-13',
        stage: 'review',
        revision: 1,
        items: [
          { itemId: 'a', taskId: 'a', source: 'unscheduled', name: 'Звіт', start: 'x', end: 'y', durationMinutes: 30 },
        ],
        unplaced: [],
        changedItemIds: [],
      },
    });
    expect(matchMultiIntentTurn({ outcome: 'confirm', plan: 'review', planNamesInclude: ['звіт'], planNamesExclude: ['Молоко'] }, res).ok).toBe(true);
    expect(matchMultiIntentTurn({ outcome: 'confirm', plan: 'interview' }, res).ok).toBe(false);
    expect(matchMultiIntentTurn({ outcome: 'confirm', plan: 'any' }, response({ outcome: 'confirm' })).ok).toBe(false);
  });
});
