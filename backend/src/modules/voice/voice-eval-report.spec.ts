import { dialogueEvalCase } from './voice-eval-report';

describe('dialogueEvalCase', () => {
  it('keeps pace calls and attaches one trace id with the step sequence', () => {
    const row = dialogueEvalCase({
      id: 'plan.multi',
      failures: ['plan lacks taxes'],
      outcome: 'confirm',
      kinds: ['create', 'command'],
      names: ['Milk', 'Report'],
      plan: null,
      message: 'I left that out.',
      ms: 40,
      calls: [{ label: 'planner.r0', model: 'openai/gpt-oss-120b', tokens: 12, keyIndex: 0 }],
      traceId: 'turn-1',
      steps: [
        {
          kind: 'llm',
          component: 'planner',
          name: 'planner.r0',
          via: 'groq:openai/gpt-oss-120b',
          ms: 10,
          tokens: 12,
          decision: 'steps',
          ok: true,
          valid: true,
        },
        {
          kind: 'llm',
          component: 'router',
          name: 'router',
          segment: 0,
          via: 'groq:openai/gpt-oss-20b',
          ms: 8,
          ok: true,
        },
        {
          kind: 'llm',
          component: 'specialist',
          name: 'specialist.create',
          segment: 0,
          via: 'groq:openai/gpt-oss-20b',
          ms: 9,
          ok: true,
        },
        {
          kind: 'other',
          component: 'normalizer',
          name: 'normalizer',
          segment: 2,
          via: '',
          ms: 1,
          reason: 'duration_clamped',
          ok: true,
        },
        {
          kind: 'other',
          component: 'orchestrator',
          name: 'segment',
          segment: 2,
          via: '',
          ms: 0,
          ok: true,
          outcome: 'accepted',
        },
      ],
    });

    expect(row).toMatchObject({
      id: 'plan.multi',
      ok: false,
      traceId: 'turn-1',
      calls: [{ label: 'planner.r0', tokens: 12 }],
    });
    expect(row.steps).toEqual([
      expect.objectContaining({ component: 'planner', decision: 'steps' }),
      expect.objectContaining({ component: 'router', segment: 0 }),
      expect.objectContaining({ component: 'specialist', segment: 0 }),
      expect.objectContaining({ component: 'normalizer', segment: 2, reason: 'duration_clamped' }),
      expect.objectContaining({ component: 'orchestrator', name: 'segment', segment: 2, outcome: 'accepted' }),
    ]);
    const encoded = JSON.stringify(row.steps);
    expect(encoded).not.toContain('transcript');
    expect(encoded).not.toContain('Milk');
    expect(row.steps).not.toHaveProperty('traceId');
  });
});
