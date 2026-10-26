import { intentsFromParseResult, commandNeedsConfirm } from './voice-agent.intents';

describe('voice-agent.intents', () => {
  it('maps create parse to create intent with spoken summary', () => {
    const mapped = intentsFromParseResult(
      {
        understanding: 'complete',
        clarifyingQuestion: null,
        task: {
          name: 'Milk',
          estimatedTimeInMinutes: 30,
          earliestStartTime: '2026-09-08T00:00:00+03:00',
          timeZone: 'Asia/Nicosia',
        } as any,
        command: null,
      },
      {
        language: 'uk',
        timeZone: 'Asia/Nicosia',
        nowIso: '2026-09-07T16:00:00.000Z',
        wakeTime: '08:00',
      },
    );
    expect(mapped.intents).toHaveLength(1);
    expect(mapped.intents[0].type).toBe('create');
    expect(mapped.intents[0].summary).toBe(
      'Створив задачу «Milk»: на завтра, 30 хв.',
    );
    expect(mapped.needsConfirm).toBe(true);
    expect(commandNeedsConfirm(mapped.intents[0])).toBe(true);
  });

  it('names a fixed seat, length, and priority', () => {
    const mapped = intentsFromParseResult(
      {
        understanding: 'complete',
        clarifyingQuestion: null,
        task: {
          name: 'Звіт',
          eventType: 'fixed',
          estimatedTimeInMinutes: 60,
          priority: 'urgent',
          scheduledStartTime: '2026-09-08T15:00:00+03:00',
          scheduledEndTime: '2026-09-08T16:00:00+03:00',
          timeZone: 'Asia/Nicosia',
        } as any,
        command: null,
      },
      {
        language: 'uk',
        timeZone: 'Asia/Nicosia',
        nowIso: '2026-09-07T16:00:00.000Z',
        wakeTime: '08:00',
      },
    );
    expect(mapped.intents[0].summary).toBe(
      'Створив задачу «Звіт»: на завтра, 15:00–16:00, 60 хв, терміновий пріоритет, фіксована.',
    );
  });

  it('names an unscheduled task without inventing a day', () => {
    const mapped = intentsFromParseResult(
      {
        understanding: 'complete',
        clarifyingQuestion: null,
        task: {
          name: 'Молоко',
          isUnscheduled: true,
          estimatedTimeInMinutes: 15,
          priority: 'medium',
        } as any,
        command: null,
      },
      { language: 'uk', timeZone: 'Europe/Kyiv', nowIso: '2026-09-07T16:00:00.000Z' },
    );
    expect(mapped.intents[0].summary).toBe(
      'Створив задачу «Молоко»: на потім, 15 хв.',
    );
  });

  it('always confirms delete', () => {
    const mapped = intentsFromParseResult({
      understanding: 'complete',
      clarifyingQuestion: null,
      task: null,
      command: {
        kind: 'delete',
        taskId: '1',
        taskName: 'X',
        summary: 'Delete X',
      } as any,
    });
    expect(mapped.needsConfirm).toBe(true);
    expect(commandNeedsConfirm(mapped.intents[0])).toBe(true);
  });

  it('maps refuse', () => {
    const mapped = intentsFromParseResult({
      understanding: 'complete',
      clarifyingQuestion: null,
      task: null,
      command: { kind: 'refuse', message: 'No' } as any,
    });
    expect(mapped.refuseMessage).toBe('No');
    expect(mapped.intents).toHaveLength(0);
  });
});
