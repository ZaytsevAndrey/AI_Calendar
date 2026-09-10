import {
  inferClockHmRange,
  inferDueYmd,
  inferScheduleWindow,
  localDateTimeIso,
  localHm,
  localYmd,
  normalizeClockHm,
} from './voice-local-date.util';
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

  it('creates immediately from a name even when duration was not spoken', () => {
    const result = normalizeVoiceParse(
      {
        understanding: 'sufficient',
        clarifyingQuestion: null,
        task: {
          name: 'Buy milk',
          eventType: 'admin',
          estimatedTimeInMinutes: 30,
        },
      },
      { ...ctx, transcript: 'buy milk tomorrow' },
    );
    expect(result.understanding).toBe('complete');
    expect(result.task?.estimatedTimeInMinutes).toBe(30);
  });

  it('keeps complete when they spoke a duration in Ukrainian', () => {
    const result = normalizeVoiceParse(
      {
        understanding: 'complete',
        task: { name: 'Зал', eventType: 'admin', estimatedTimeInMinutes: 45 },
      },
      { ...ctx, transcript: 'завтра в зал на 45 хвилин' },
    );
    expect(result.understanding).toBe('complete');
  });

  it('keeps complete for a timed fixed event without a spoken duration', () => {
    const result = normalizeVoiceParse(
      {
        understanding: 'complete',
        task: {
          name: 'Dentist',
          eventType: 'fixed',
          scheduledStartTime: '2026-09-11T15:00:00+03:00',
          scheduledEndTime: '2026-09-11T16:00:00+03:00',
        },
      },
      { ...ctx, transcript: 'dentist tomorrow at 3pm' },
    );
    expect(result.understanding).toBe('complete');
  });

  it('creates a named fixed task without times as a flexible task', () => {
    const result = normalizeVoiceParse(
      {
        understanding: 'complete',
        task: { name: 'Dentist', eventType: 'fixed' },
      },
      ctx,
    );
    expect(result.understanding).toBe('complete');
    expect(result.task?.eventType).toBe('admin');
    expect(result.clarifyingQuestion).toBeNull();
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
    expect(result.understanding).toBe('complete');
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
    expect(result.understanding).toBe('complete');
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
    expect(result.task?.earliestStartTime).toBe('2026-09-08T00:00:00+03:00');
    expect(result.task?.scheduledStartTime).toBeNull();
  });

  it('maps Friday speech to that local day only', () => {
    const result = normalizeVoiceParse(
      {
        understanding: 'complete',
        task: { name: 'Зал', eventType: 'admin' },
      },
      {
        validPhaseIds: new Set(),
        alreadyClarified: false,
        transcript: "в п'ятницю в зал",
        timeZone: 'Asia/Nicosia',
        nowIso: '2026-09-07T16:00:00.000Z',
      },
    );
    expect(result.task?.earliestStartTime).toBe('2026-09-11T00:00:00+03:00');
    expect(result.task?.deadline).toBe('2026-09-11T23:59:00+03:00');
    expect(result.task?.scheduledStartTime).toBeNull();
  });

  it('maps a Friday–Sunday range without weekday filter', () => {
    const result = normalizeVoiceParse(
      {
        understanding: 'complete',
        task: { name: 'Trip prep', eventType: 'admin' },
      },
      {
        validPhaseIds: new Set(),
        alreadyClarified: false,
        transcript: "з п'ятниці по неділю зібрати речі",
        timeZone: 'Asia/Nicosia',
        nowIso: '2026-09-07T16:00:00.000Z',
      },
    );
    expect(result.task?.earliestStartTime).toBe('2026-09-11T00:00:00+03:00');
    expect(result.task?.deadline).toBe('2026-09-13T23:59:00+03:00');
    expect(result.task?.eligibleWeekDays).toBeNull();
  });

  it('maps Monday and Wednesday to those weekdays only', () => {
    const result = normalizeVoiceParse(
      {
        understanding: 'complete',
        task: { name: 'Review', eventType: 'admin' },
      },
      {
        validPhaseIds: new Set(),
        alreadyClarified: false,
        transcript: 'в понеділок і середу зробити ревʼю',
        timeZone: 'Asia/Nicosia',
        nowIso: '2026-09-07T16:00:00.000Z',
      },
    );
    expect(result.task?.earliestStartTime).toBe('2026-09-07T00:00:00+03:00');
    expect(result.task?.deadline).toBe('2026-09-09T23:59:00+03:00');
    expect(result.task?.eligibleWeekDays).toEqual([1, 3]);
  });

  it('moves a midnight preferred start from the model onto earliestStartTime', () => {
    const result = normalizeVoiceParse(
      {
        understanding: 'complete',
        task: {
          name: 'Wash the car',
          eventType: 'admin',
          scheduledStartTime: '2026-09-08T00:00:00+03:00',
          scheduledEndTime: '2026-09-08T00:30:00+03:00',
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
    expect(result.task?.earliestStartTime).toBe('2026-09-08T00:00:00+03:00');
    expect(result.task?.scheduledStartTime).toBeNull();
    expect(result.task?.scheduledEndTime).toBeNull();
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

describe('inferScheduleWindow', () => {
  const today = '2026-09-07';

  it('maps a contiguous spoken range', () => {
    expect(inferScheduleWindow("з п'ятниці по неділю", today)).toEqual({
      startYmd: '2026-09-11',
      endYmd: '2026-09-13',
    });
    expect(inferScheduleWindow('Friday to Sunday', today)).toEqual({
      startYmd: '2026-09-11',
      endYmd: '2026-09-13',
    });
  });

  it('keeps non-contiguous weekdays as a filter', () => {
    expect(inferScheduleWindow('в понеділок і середу', today)).toEqual({
      startYmd: '2026-09-07',
      endYmd: '2026-09-09',
      weekDays: [1, 3],
    });
  });
});

describe('inferClockHmRange', () => {
  it('reads stamped and loose hour ranges', () => {
    expect(inferClockHmRange('з 14:00 до 18:00')).toEqual({
      startHm: '14:00',
      endHm: '18:00',
    });
    expect(inferClockHmRange('from 9 to 11')).toEqual({
      startHm: '09:00',
      endHm: '11:00',
    });
  });
});

describe('localYmd', () => {
  it('uses the client timezone', () => {
    expect(localYmd('2026-09-07T16:00:00.000Z', 'Asia/Nicosia')).toBe('2026-09-07');
  });
});

describe('localHm', () => {
  it('maps a UTC evening instant to +03:00 midnight', () => {
    expect(localHm('2026-09-07T21:00:00.000Z', 'Asia/Nicosia')).toBe('00:00');
  });
});

describe('normalizeClockHm', () => {
  it('strips seconds from a Postgres time value', () => {
    expect(normalizeClockHm('08:00:00')).toBe('08:00');
    expect(normalizeClockHm('9:30:00')).toBe('09:30');
  });
});

describe('localDateTimeIso', () => {
  it('accepts a Postgres wakeTime with seconds', () => {
    expect(localDateTimeIso('2026-09-08', '09:00:00', 'Asia/Nicosia')).toBe(
      '2026-09-08T09:00:00+03:00',
    );
    expect(
      Number.isNaN(
        new Date(
          localDateTimeIso('2026-09-08', '09:00:00', 'Asia/Nicosia'),
        ).getTime(),
      ),
    ).toBe(false);
  });
});
