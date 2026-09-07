import { extractJsonObject, normalizeVoiceParse } from './voice-parse.util';

describe('extractJsonObject', () => {
  it('parses a raw object', () => {
    expect(extractJsonObject('{"understanding":"complete"}')).toEqual({
      understanding: 'complete',
    });
  });

  it('parses fenced JSON', () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
});

describe('normalizeVoiceParse', () => {
  const phaseId = '11111111-1111-4111-8111-111111111111';
  const ctx = {
    validPhaseIds: new Set([phaseId]),
    alreadyClarified: false,
    transcript: 'buy milk for 20 minutes',
  };

  it('marks a named flexible task complete', () => {
    const result = normalizeVoiceParse(
      {
        understanding: 'complete',
        clarifyingQuestion: null,
        task: {
          name: 'Buy milk',
          eventType: 'admin',
          estimatedTimeInMinutes: 20,
          priority: 'medium',
        },
      },
      ctx,
    );
    expect(result.understanding).toBe('complete');
    expect(result.task?.name).toBe('Buy milk');
    expect(result.task?.estimatedTimeInMinutes).toBe(20);
    expect(result.task?.allowSplit).toBe(true);
    expect(result.clarifyingQuestion).toBeNull();
  });

  it('downgrades complete fixed tasks without times', () => {
    const result = normalizeVoiceParse(
      {
        understanding: 'complete',
        task: { name: 'Dentist', eventType: 'fixed' },
      },
      ctx,
    );
    expect(result.understanding).toBe('needs_clarification');
    expect(result.clarifyingQuestion).toMatch(/time/i);
  });

  it('drops unknown phase ids', () => {
    const result = normalizeVoiceParse(
      {
        understanding: 'sufficient',
        task: { name: 'Gym', phaseId: 'not-a-phase' },
      },
      ctx,
    );
    expect(result.task?.phaseId).toBeNull();
    expect(result.task?.phaseIds).toBeUndefined();
  });

  it('keeps a valid phase id', () => {
    const result = normalizeVoiceParse(
      {
        understanding: 'sufficient',
        task: { name: 'Focus work', phaseId },
      },
      ctx,
    );
    expect(result.task?.phaseId).toBe(phaseId);
    expect(result.task?.phaseIds).toEqual([phaseId]);
  });

  it('after one clarification, does not ask again when a name exists', () => {
    const result = normalizeVoiceParse(
      {
        understanding: 'needs_clarification',
        clarifyingQuestion: 'When?',
        task: { name: 'Dentist', eventType: 'fixed' },
      },
      { ...ctx, alreadyClarified: true },
    );
    expect(result.understanding).toBe('sufficient');
    expect(result.clarifyingQuestion).toBeNull();
    expect(result.task?.name).toBe('Dentist');
  });

  it('uses the transcript as a name fallback after clarification', () => {
    const result = normalizeVoiceParse(
      {
        understanding: 'needs_clarification',
        task: { name: '' },
      },
      {
        validPhaseIds: new Set(),
        alreadyClarified: true,
        transcript: 'call the bank about the card',
      },
    );
    expect(result.understanding).toBe('sufficient');
    expect(result.task?.name).toBe('call the bank about the card');
  });
});
