import { inferDueYmd, localYmd } from './voice-local-date.util';
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

  it('fills end-of-day deadline when the transcript names tomorrow without a time', () => {
    const result = normalizeVoiceParse(
      {
        understanding: 'complete',
        task: { name: 'Помити машину', eventType: 'admin' },
      },
      {
        validPhaseIds: new Set(),
        alreadyClarified: false,
        transcript: 'завтра треба помити машину',
        timeZone: 'Asia/Nicosia',
        nowIso: '2026-09-07T16:00:00.000Z',
      },
    );
    expect(result.task?.deadline).toBe('2026-09-08T23:59:00+03:00');
    expect(result.task?.eventType).toBe('admin');
    expect(result.task?.scheduledStartTime).toBeNull();
  });

  it('does not overwrite a deadline the model already set', () => {
    const result = normalizeVoiceParse(
      {
        understanding: 'complete',
        task: {
          name: 'Wash the car',
          eventType: 'admin',
          deadline: '2026-09-10T12:00:00+03:00',
        },
      },
      {
        validPhaseIds: new Set(),
        alreadyClarified: false,
        transcript: 'tomorrow wash the car',
        timeZone: 'Asia/Nicosia',
        nowIso: '2026-09-07T16:00:00.000Z',
      },
    );
    expect(result.task?.deadline).toBe('2026-09-10T12:00:00+03:00');
  });
});

describe('inferDueYmd', () => {
  const today = '2026-09-07';

  it('maps tomorrow in uk/en', () => {
    expect(inferDueYmd('завтра треба помити машину', today)).toBe('2026-09-08');
    expect(inferDueYmd('wash the car tomorrow', today)).toBe('2026-09-08');
  });

  it('maps the next named weekday', () => {
    expect(inferDueYmd("в п'ятницю в зал", today)).toBe('2026-09-11');
    expect(inferDueYmd('on Monday', today)).toBe('2026-09-07');
  });
});

describe('localYmd', () => {
  it('uses the client timezone', () => {
    expect(localYmd('2026-09-07T16:00:00.000Z', 'Asia/Nicosia')).toBe('2026-09-07');
  });
});
