import { matchCreateEvalScenario } from './voice-create-eval.match';
import type { CreateEvalScenario } from './voice-create-eval.scenarios';
import type { VoiceParseResult } from './voice-parse.types';

const baseScenario = (
  partial: Partial<CreateEvalScenario> & Pick<CreateEvalScenario, 'id' | 'expect'>,
): CreateEvalScenario => ({
  branch: 6,
  transcript: 'buy milk',
  language: 'en',
  ...partial,
});

describe('matchCreateEvalScenario', () => {
  it('passes unscheduled create', () => {
    const result: VoiceParseResult = {
      understanding: 'complete',
      clarifyingQuestion: null,
      task: {
        name: 'Buy milk',
        eventType: 'admin',
        estimatedTimeInMinutes: 30,
        isRecurring: false,
        isUnscheduled: true,
        allowSplit: true,
        priority: 'medium',
      },
      command: null,
    };
    const match = matchCreateEvalScenario(
      baseScenario({
        id: 'u',
        expect: {
          understanding: 'complete',
          kind: 'unscheduled',
          nameIncludes: 'milk',
          isUnscheduled: true,
          noScheduleFields: true,
        },
      }),
      result,
    );
    expect(match.ok).toBe(true);
  });

  it('fails on wrong kind and reports details', () => {
    const result: VoiceParseResult = {
      understanding: 'complete',
      clarifyingQuestion: null,
      task: {
        name: 'Dentist',
        eventType: 'fixed',
        estimatedTimeInMinutes: 30,
        isRecurring: false,
        allowSplit: false,
        priority: 'medium',
        scheduledStartTime: '2026-10-14T15:00:00+03:00',
        scheduledEndTime: '2026-10-14T15:30:00+03:00',
      },
      command: null,
    };
    const match = matchCreateEvalScenario(
      baseScenario({
        id: 'f',
        branch: 2,
        expect: {
          understanding: 'complete',
          kind: 'flexible',
          nameIncludes: 'dentist',
        },
      }),
      result,
    );
    expect(match.ok).toBe(false);
    expect(match.failures.some((f) => f.includes('kind'))).toBe(true);
    expect(match.actual.scheduledHour).toBe(15);
    expect(match.actual.scheduledYmd).toBe('2026-10-14');
  });

  it('requires a clarify question', () => {
    const match = matchCreateEvalScenario(
      baseScenario({
        id: 'c',
        branch: 'clarify',
        expect: { understanding: 'needs_clarification' },
      }),
      {
        understanding: 'needs_clarification',
        clarifyingQuestion: null,
        task: null,
        command: null,
      },
    );
    expect(match.ok).toBe(false);
  });
});
