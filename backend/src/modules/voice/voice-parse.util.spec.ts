import {
  buildLocalCalendarContext,
  localDateTimeIso,
  localHm,
  localYmd,
  normalizeClockHm,
  scheduleTodayYmd,
} from './voice-local-date.util';
import {
  clarificationOnlyResult,
  extractJsonObject,
  normalizeVoiceParse,
} from './voice-parse.util';

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

  const dayWindow = {
    earliestStartTime: '2026-09-08T00:00:00+03:00',
    deadline: '2026-09-08T23:59:00+03:00',
  };

  it('marks a named flexible task with a day window complete', () => {
    const result = normalizeVoiceParse(
      {
        understanding: 'complete',
        clarifyingQuestion: null,
        task: {
          name: 'Buy milk',
          kind: 'flexible',
          eventType: 'admin',
          estimatedTimeInMinutes: 20,
          priority: 'medium',
          ...dayWindow,
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

  it('defaults to Unscheduled when only a name is present', () => {
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
      { ...ctx, transcript: 'buy milk', language: 'en' },
    );
    expect(result.understanding).toBe('complete');
    expect(result.clarifyingQuestion).toBeNull();
    expect(result.task?.name).toBe('Buy milk');
    expect(result.task?.isUnscheduled).toBe(true);
  });

  it('accepts recurring with a pattern and no clock', () => {
    const result = normalizeVoiceParse(
      {
        understanding: 'complete',
        task: {
          name: 'Job search',
          kind: 'recurring',
          isRecurring: true,
          recurrencePattern: 'WEEKLY',
          recurrenceWeekDays: [1, 2, 3, 4, 5],
          estimatedTimeInMinutes: 90,
        },
      },
      {
        ...ctx,
        transcript: 'повторювальна задача з понеділка по пʼятницю на ресерч',
        language: 'uk',
      },
    );
    expect(result.understanding).toBe('complete');
    expect(result.task?.isRecurring).toBe(true);
    expect(result.task?.recurrencePattern).toBe('WEEKLY');
    expect(result.task?.isUnscheduled).toBeFalsy();
  });

  it('accepts explicit unscheduled without a day', () => {
    const result = normalizeVoiceParse(
      {
        understanding: 'complete',
        task: {
          name: 'Buy milk',
          kind: 'unscheduled',
          isUnscheduled: true,
        },
      },
      { ...ctx, transcript: 'buy milk unscheduled', language: 'en' },
    );
    expect(result.understanding).toBe('complete');
    expect(result.task?.isUnscheduled).toBe(true);
    expect(result.task?.scheduledStartTime).toBeNull();
  });

  it('uses the settings default duration when the model omits a length', () => {
    const result = normalizeVoiceParse(
      {
        understanding: 'complete',
        task: {
          name: 'Buy milk',
          kind: 'flexible',
          ...dayWindow,
        },
      },
      {
        ...ctx,
        transcript: 'buy milk tomorrow',
        defaultTaskDurationMinutes: 45,
      },
    );
    expect(result.understanding).toBe('complete');
    expect(result.task?.estimatedTimeInMinutes).toBe(45);
  });

  it('creates immediately from a name when a day window is present', () => {
    const result = normalizeVoiceParse(
      {
        understanding: 'sufficient',
        clarifyingQuestion: null,
        task: {
          name: 'Buy milk',
          eventType: 'admin',
          estimatedTimeInMinutes: 30,
          ...dayWindow,
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
        task: {
          name: 'Зал',
          eventType: 'admin',
          estimatedTimeInMinutes: 45,
          ...dayWindow,
        },
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

  it('downgrades fixed without times to Unscheduled inbox', () => {
    const result = normalizeVoiceParse(
      {
        understanding: 'complete',
        task: { name: 'Dentist', eventType: 'fixed' },
      },
      { ...ctx, language: 'en' },
    );
    expect(result.task?.eventType).toBe('admin');
    expect(result.understanding).toBe('complete');
    expect(result.task?.isUnscheduled).toBe(true);
  });

  it('drops unknown phase ids', () => {
    const result = normalizeVoiceParse(
      {
        understanding: 'sufficient',
        task: { name: 'Gym', phaseId: 'not-a-phase', ...dayWindow },
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
        task: { name: 'Focus work', phaseId, ...dayWindow },
      },
      ctx,
    );
    expect(result.task?.phaseId).toBe(phaseId);
    expect(result.task?.phaseIds).toEqual([phaseId]);
  });

  it('keeps one duration question when the name and a when already exist', () => {
    const result = normalizeVoiceParse(
      {
        understanding: 'needs_clarification',
        clarifyingQuestion: 'Скільки це триватиме?',
        task: {
          name: 'Прибирання',
          kind: 'flexible',
          estimatedTimeInMinutes: null,
          earliestStartTime: '2026-09-08T00:00:00+03:00',
          deadline: '2026-09-08T23:59:00+03:00',
        },
      },
      { ...ctx, alreadyClarified: false, transcript: 'завтра прибрати квартиру' },
    );
    expect(result.understanding).toBe('needs_clarification');
    expect(result.clarifyingQuestion).toBe('Скільки це триватиме?');
    expect(result.task?.name).toBe('Прибирання');
  });

  it('after one clarification, does not ask again when a name and when exist', () => {
    const result = normalizeVoiceParse(
      {
        understanding: 'needs_clarification',
        clarifyingQuestion: 'When?',
        task: {
          name: 'Dentist',
          eventType: 'fixed',
          scheduledStartTime: '2026-09-11T15:00:00+03:00',
          scheduledEndTime: '2026-09-11T16:00:00+03:00',
        },
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
        task: { name: '', ...dayWindow },
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

  it('marks inbox when clarify answer left no schedule fields', () => {
    const result = normalizeVoiceParse(
      {
        understanding: 'complete',
        task: { name: 'Магазин', kind: 'flexible' },
      },
      {
        validPhaseIds: new Set(),
        alreadyClarified: true,
        transcript: 'незапланована',
        language: 'uk',
      },
    );
    expect(result.understanding).toBe('complete');
    expect(result.task?.isUnscheduled).toBe(true);
  });

  it('passes through future LLM schedule fields without rewriting from the transcript', () => {
    const result = normalizeVoiceParse(
      {
        understanding: 'complete',
        task: {
          name: 'Поїхати в магазин',
          eventType: 'fixed',
          estimatedTimeInMinutes: 30,
          scheduledStartTime: '2026-09-08T14:00:00+03:00',
          scheduledEndTime: '2026-09-08T14:30:00+03:00',
          earliestStartTime: '2026-09-08T00:00:00+03:00',
          deadline: '2026-09-08T23:59:00+03:00',
        },
      },
      {
        validPhaseIds: new Set(),
        alreadyClarified: false,
        transcript: 'завтра о другій дня треба поїхати в магазин',
        timeZone: 'Asia/Nicosia',
        nowIso: '2026-09-07T16:00:00.000Z',
        wakeTime: '08:00',
      },
    );
    expect(result.task?.eventType).toBe('fixed');
    expect(result.task?.scheduledStartTime).toBe('2026-09-08T14:00:00+03:00');
    expect(result.task?.scheduledEndTime).toBe('2026-09-08T14:30:00+03:00');
    expect(result.task?.earliestStartTime).toBe('2026-09-08T00:00:00+03:00');
    expect(result.task?.deadline).toBe('2026-09-08T23:59:00+03:00');
  });

  it('rejects a past preferred/fixed slot from the model', () => {
    const nowIso = '2026-09-07T18:00:00.000Z';
    const result = normalizeVoiceParse(
      {
        understanding: 'complete',
        task: {
          name: 'Магазин',
          eventType: 'fixed',
          scheduledStartTime: '2026-09-07T14:00:00+03:00',
          scheduledEndTime: '2026-09-07T14:30:00+03:00',
          earliestStartTime: '2026-09-07T00:00:00+03:00',
          deadline: '2026-09-07T23:59:00+03:00',
        },
      },
      {
        validPhaseIds: new Set(),
        alreadyClarified: false,
        transcript: 'о другій дня магазин',
        timeZone: 'Asia/Nicosia',
        nowIso,
      },
    );
    expect(result.task?.scheduledStartTime).toBeNull();
    expect(result.task?.scheduledEndTime).toBeNull();
    expect(result.task?.eventType).toBe('admin');
    expect(result.task?.earliestStartTime).toBe(nowIso);
    expect(result.task?.deadline).toBe('2026-09-07T23:59:00+03:00');
    expect(result.scheduleNotice).toContain('14:00');
  });

  it('keeps the rest of today when the model emitted only a past one-off clock', () => {
    const nowIso = '2026-10-13T10:00:00.000Z';
    const result = normalizeVoiceParse(
      {
        understanding: 'complete',
        task: {
          name: 'здати аналізи',
          kind: 'fixed',
          eventType: 'fixed',
          scheduledStartTime: '2026-10-13T11:00:00+03:00',
          scheduledEndTime: '2026-10-13T11:30:00+03:00',
        },
      },
      {
        validPhaseIds: new Set(),
        alreadyClarified: false,
        transcript: 'сьогодні о 11 ранку здати аналізи',
        timeZone: 'Europe/Kyiv',
        nowIso,
        language: 'uk',
      },
    );
    expect(result.understanding).toBe('complete');
    expect(result.task?.eventType).toBe('admin');
    expect(result.task?.isUnscheduled).toBeFalsy();
    expect(result.task?.scheduledStartTime).toBeNull();
    expect(result.task?.earliestStartTime).toBe(nowIso);
    expect(result.task?.deadline).toBe('2026-10-13T23:59:00+03:00');
    expect(result.scheduleNotice).toBe('11:00 вже минув. Лишаю на сьогодні.');
  });

  it('keeps the rest of today when a deadline-only bound is already past', () => {
    const nowIso = '2026-10-13T10:00:00.000Z';
    const result = normalizeVoiceParse(
      {
        understanding: 'complete',
        task: {
          name: 'відправити правки',
          kind: 'flexible',
          deadline: '2026-10-13T12:00:00+03:00',
        },
      },
      {
        validPhaseIds: new Set(),
        alreadyClarified: false,
        transcript: 'сьогодні до 12 відправити правки',
        timeZone: 'Europe/Kyiv',
        nowIso,
        language: 'uk',
      },
    );
    expect(result.understanding).toBe('complete');
    expect(result.task?.eventType).toBe('admin');
    expect(result.task?.isUnscheduled).toBeFalsy();
    expect(result.task?.earliestStartTime).toBe(nowIso);
    expect(result.task?.deadline).toBe('2026-10-13T23:59:00+03:00');
    expect(result.scheduleNotice).toBe('12:00 вже минув. Лишаю на сьогодні.');
  });

  it('keeps a recurring series clock even when that hour today is already past', () => {
    const result = normalizeVoiceParse(
      {
        understanding: 'complete',
        task: {
          name: 'зарядка',
          kind: 'recurring',
          isRecurring: true,
          recurrencePattern: 'DAILY',
          scheduledStartTime: '2026-10-13T07:00:00+03:00',
          scheduledEndTime: '2026-10-13T07:30:00+03:00',
        },
      },
      {
        validPhaseIds: new Set(),
        alreadyClarified: false,
        transcript: 'щоранку зарядка о 7',
        timeZone: 'Europe/Kyiv',
        nowIso: '2026-10-13T10:00:00.000Z',
        language: 'uk',
      },
    );
    expect(result.task?.isRecurring).toBe(true);
    expect(result.task?.scheduledStartTime).toBe('2026-10-13T07:00:00+03:00');
    expect(result.task?.scheduledEndTime).toBe('2026-10-13T07:30:00+03:00');
  });

  it('keeps WEEKLY weekdays from the model (no transcript rewrite)', () => {
    const result = normalizeVoiceParse(
      {
        understanding: 'complete',
        task: {
          name: 'ретро',
          kind: 'recurring',
          isRecurring: true,
          recurrencePattern: 'WEEKLY',
          recurrenceWeekDays: [5],
          scheduledStartTime: '2026-10-13T16:00:00+03:00',
          scheduledEndTime: '2026-10-13T16:30:00+03:00',
        },
      },
      {
        validPhaseIds: new Set(),
        alreadyClarified: false,
        transcript: "кожну пʼятницю ретро о 16",
        timeZone: 'Europe/Kyiv',
        nowIso: '2026-10-13T10:00:00.000Z',
        language: 'uk',
      },
    );
    expect(result.task?.recurrenceWeekDays).toEqual([5]);
  });

  it('does not force fixed from the transcript when the model chose flexible', () => {
    const result = normalizeVoiceParse(
      {
        understanding: 'complete',
        task: {
          name: 'зустріч з клієнтом',
          kind: 'flexible',
          scheduledStartTime: '2026-10-13T10:00:00+03:00',
          scheduledEndTime: '2026-10-13T10:30:00+03:00',
        },
      },
      {
        validPhaseIds: new Set(),
        alreadyClarified: false,
        transcript: 'зустріч з клієнтом о 10',
        timeZone: 'Europe/Kyiv',
        nowIso: '2026-10-13T06:00:00.000Z',
        language: 'uk',
      },
    );
    expect(result.task?.eventType).toBe('admin');
    expect(result.task?.scheduledStartTime).toBe('2026-10-13T10:00:00+03:00');
  });

  it('keeps clarify when the model asks again even with a title (no lexical drop)', () => {
    const result = normalizeVoiceParse(
      {
        understanding: 'needs_clarification',
        clarifyingQuestion: 'How long will this take?',
        task: {
          name: 'Полагодити кран',
          kind: 'unscheduled',
          isUnscheduled: true,
        },
      },
      {
        validPhaseIds: new Set(),
        alreadyClarified: false,
        transcript: 'полагодити кран якщо можна',
        timeZone: 'Europe/Kyiv',
        nowIso: '2026-10-13T10:00:00.000Z',
        language: 'uk',
      },
    );
    expect(result.understanding).toBe('needs_clarification');
    expect(result.clarifyingQuestion).toBe('How long will this take?');
  });

  it('drops clarifyingQuestion only when it exactly equals the title', () => {
    const result = normalizeVoiceParse(
      {
        understanding: 'needs_clarification',
        clarifyingQuestion: 'Полагодити кран',
        task: {
          name: 'Полагодити кран',
          kind: 'unscheduled',
          isUnscheduled: true,
        },
      },
      {
        validPhaseIds: new Set(),
        alreadyClarified: false,
        transcript: 'полагодити кран',
        language: 'uk',
      },
    );
    expect(result.understanding).toBe('complete');
    expect(result.clarifyingQuestion).toBeNull();
  });

  it('moves a past soft preferred to tomorrow at the same clock', () => {
    const nowIso = '2026-10-13T10:00:00.000Z'; // 13:00 Kyiv — noon already past
    const result = normalizeVoiceParse(
      {
        understanding: 'complete',
        task: {
          name: 'Prepare lunch',
          kind: 'flexible',
          estimatedTimeInMinutes: 30,
          scheduledStartTime: '2026-10-13T12:00:00+03:00',
          scheduledEndTime: '2026-10-13T12:30:00+03:00',
          earliestStartTime: '2026-10-13T12:00:00+03:00',
        },
      },
      {
        validPhaseIds: new Set(),
        alreadyClarified: false,
        transcript: 'about noon prepare lunch',
        timeZone: 'Europe/Kyiv',
        nowIso,
        language: 'en',
      },
    );
    expect(result.understanding).toBe('complete');
    expect(result.task?.scheduledStartTime).toBe('2026-10-14T12:00:00+03:00');
    expect(result.task?.scheduledEndTime).toBe('2026-10-14T12:30:00+03:00');
    expect(result.task?.earliestStartTime).toBeNull();
    expect(result.task?.deadline).toBeNull();
    expect(result.scheduleNotice).toBeNull();
  });

  it('drops a past preferred inside a window that is still open', () => {
    const nowIso = '2026-10-13T10:00:00.000Z';
    const result = normalizeVoiceParse(
      {
        understanding: 'complete',
        task: {
          name: 'написати статтю',
          kind: 'flexible',
          estimatedTimeInMinutes: 30,
          earliestStartTime: '2026-10-13T10:00:00+03:00',
          deadline: '2026-10-13T14:00:00+03:00',
          scheduledStartTime: '2026-10-13T12:00:00+03:00',
          scheduledEndTime: '2026-10-13T12:30:00+03:00',
        },
      },
      {
        validPhaseIds: new Set(),
        alreadyClarified: false,
        transcript: 'між 10 і 14 написати статтю десь о дванадцятій',
        timeZone: 'Europe/Kyiv',
        nowIso,
        language: 'uk',
      },
    );
    expect(result.task?.scheduledStartTime).toBeNull();
    expect(result.task?.earliestStartTime).toBe(nowIso);
    expect(result.task?.deadline).toBe('2026-10-13T14:00:00+03:00');
    expect(result.scheduleNotice).toBeNull();
  });

  it('passes through a preferred clock the model set inside a window', () => {
    const result = normalizeVoiceParse(
      {
        understanding: 'complete',
        task: {
          name: 'Купити продукти',
          kind: 'flexible',
          estimatedTimeInMinutes: 30,
          earliestStartTime: '2026-10-13T14:00:00+03:00',
          deadline: '2026-10-13T18:00:00+03:00',
          scheduledStartTime: '2026-10-13T15:00:00+03:00',
          scheduledEndTime: '2026-10-13T15:30:00+03:00',
        },
      },
      {
        validPhaseIds: new Set(),
        alreadyClarified: false,
        transcript: 'між 14 і 18 купити продукти краще о 15',
        timeZone: 'Europe/Kyiv',
        nowIso: '2026-10-13T10:00:00.000Z',
        language: 'uk',
      },
    );
    expect(result.understanding).toBe('complete');
    expect(result.task?.earliestStartTime).toBe('2026-10-13T14:00:00+03:00');
    expect(result.task?.deadline).toBe('2026-10-13T18:00:00+03:00');
    expect(result.task?.scheduledStartTime).toBe('2026-10-13T15:00:00+03:00');
  });

  it('passes through a wide from–until the model already treated as a window', () => {
    const result = normalizeVoiceParse(
      {
        understanding: 'complete',
        task: {
          name: 'Сходити в магазин',
          kind: 'flexible',
          estimatedTimeInMinutes: 30,
          earliestStartTime: '2026-10-13T14:00:00+03:00',
          deadline: '2026-10-13T18:00:00+03:00',
          scheduledStartTime: null,
          scheduledEndTime: null,
        },
      },
      {
        validPhaseIds: new Set(),
        alreadyClarified: false,
        transcript: 'з 14 до 18 сходити в магазин',
        timeZone: 'Europe/Kyiv',
        nowIso: '2026-10-13T10:00:00.000Z',
        language: 'uk',
      },
    );
    expect(result.understanding).toBe('complete');
    expect(result.task?.eventType).toBe('admin');
    expect(result.task?.scheduledStartTime).toBeNull();
    expect(result.task?.earliestStartTime).toBe('2026-10-13T14:00:00+03:00');
    expect(result.task?.deadline).toBe('2026-10-13T18:00:00+03:00');
  });

  it('ignores clarifyingQuestion that duplicates the task name', () => {
    const result = normalizeVoiceParse(
      {
        understanding: 'needs_clarification',
        clarifyingQuestion: 'Plan the week',
        task: {
          name: 'Plan the week',
          kind: 'flexible',
          earliestStartTime: '2026-10-19T00:00:00+03:00',
          deadline: '2026-10-19T23:59:00+03:00',
        },
      },
      {
        validPhaseIds: new Set(),
        alreadyClarified: false,
        transcript: 'on Monday plan the week',
        timeZone: 'Europe/Kyiv',
        nowIso: '2026-10-13T10:00:00.000Z',
        language: 'en',
      },
    );
    expect(result.understanding).toBe('complete');
    expect(result.clarifyingQuestion).toBeNull();
  });

  it('completes a partial day envelope without reading the transcript', () => {
    const result = normalizeVoiceParse(
      {
        understanding: 'complete',
        task: {
          name: 'Прибирання квартири',
          kind: 'flexible',
          earliestStartTime: '2026-10-17T00:00:00+03:00',
          deadline: null,
        },
      },
      {
        validPhaseIds: new Set(),
        alreadyClarified: false,
        transcript: 'у суботу прибрати квартиру',
        timeZone: 'Europe/Kyiv',
        nowIso: '2026-10-13T10:00:00.000Z',
        language: 'uk',
      },
    );
    expect(result.understanding).toBe('complete');
    expect(result.task?.earliestStartTime).toBe('2026-10-17T00:00:00+03:00');
    expect(result.task?.deadline).toBe('2026-10-17T23:59:00+03:00');
  });

  it('keeps an after-hour earliest instead of expanding it to the whole day', () => {
    const result = normalizeVoiceParse(
      {
        understanding: 'complete',
        task: {
          name: 'заїхати в спортзал',
          kind: 'flexible',
          earliestStartTime: '2026-10-13T18:00:00+03:00',
          deadline: null,
        },
      },
      {
        validPhaseIds: new Set(),
        alreadyClarified: false,
        transcript: 'після 18 заїхати в спортзал',
        timeZone: 'Europe/Kyiv',
        nowIso: '2026-10-13T10:00:00.000Z',
        language: 'uk',
      },
    );
    expect(result.task?.earliestStartTime).toBe('2026-10-13T18:00:00+03:00');
    expect(result.task?.deadline).toBeNull();
    expect(result.task?.scheduledStartTime).toBeNull();
  });

  it('asks for a name when the model left it empty', () => {
    const result = normalizeVoiceParse(
      {
        understanding: 'needs_clarification',
        clarifyingQuestion: 'What should I call this task?',
        task: {
          name: '',
          eventType: 'fixed',
          scheduledStartTime: '2026-09-08T14:00:00+03:00',
          scheduledEndTime: '2026-09-08T14:30:00+03:00',
        },
      },
      {
        validPhaseIds: new Set(),
        alreadyClarified: false,
        transcript:
          "Створи задачу на завтра. З'їздити в магазин на другу дня.",
        timeZone: 'Asia/Nicosia',
        nowIso: '2026-09-07T16:00:00.000Z',
        wakeTime: '08:00',
      },
    );
    expect(result.understanding).toBe('needs_clarification');
    expect(result.task).toBeNull();
  });

  it('trusts a non-empty model name (LLM decides weak/boilerplate titles)', () => {
    const result = normalizeVoiceParse(
      {
        understanding: 'complete',
        task: { name: 'Задача', kind: 'unscheduled', isUnscheduled: true },
      },
      {
        validPhaseIds: new Set(),
        alreadyClarified: false,
        transcript: 'Створи задачу на завтра.',
        timeZone: 'Asia/Nicosia',
        nowIso: '2026-09-07T16:00:00.000Z',
      },
    );
    expect(result.understanding).toBe('complete');
    expect(result.task?.name).toBe('Задача');
    expect(result.task?.isUnscheduled).toBe(true);
  });

  it('keeps the model clarify when name is present and understanding asks', () => {
    const result = normalizeVoiceParse(
      {
        understanding: 'needs_clarification',
        clarifyingQuestion: 'How long will this take?',
        task: {
          name: 'Прибирання',
          kind: 'flexible',
          earliestStartTime: '2026-09-08T00:00:00+03:00',
          deadline: '2026-09-08T23:59:00+03:00',
        },
      },
      {
        validPhaseIds: new Set(),
        alreadyClarified: false,
        transcript: 'tomorrow clean the flat',
        language: 'en',
      },
    );
    expect(result.understanding).toBe('needs_clarification');
    expect(result.clarifyingQuestion).toBe('How long will this take?');
  });

  it('uses the clarification answer as the title when name is empty', () => {
    const result = normalizeVoiceParse(
      {
        understanding: 'complete',
        task: {
          name: '',
          eventType: 'admin',
        },
      },
      {
        validPhaseIds: new Set(),
        alreadyClarified: true,
        transcript: 'Треба створити задачу.',
        clarificationAnswer: 'Купити молоко',
        timeZone: 'Europe/Kyiv',
        nowIso: '2026-09-07T16:00:00.000Z',
        language: 'uk',
      },
    );
    expect(result.understanding).toBe('complete');
    expect(result.task?.name).toBe('Купити молоко');
    expect(result.task?.isUnscheduled).toBe(true);
  });

  it('keeps needs_clarification when the model rejects a when-only answer as a title', () => {
    const result = normalizeVoiceParse(
      {
        understanding: 'needs_clarification',
        clarifyingQuestion: 'Як назвати задачу?',
        task: {
          name: '',
          kind: 'fixed',
          scheduledStartTime: '2026-10-14T15:00:00+03:00',
          scheduledEndTime: '2026-10-14T15:30:00+03:00',
          estimatedTimeInMinutes: 30,
        },
      },
      {
        validPhaseIds: new Set(),
        alreadyClarified: true,
        transcript: 'додай задачу завтра о 15',
        clarificationAnswer: 'завтра о 15',
        timeZone: 'Europe/Kyiv',
        nowIso: '2026-10-13T10:00:00.000Z',
        language: 'uk',
      },
    );
    expect(result.understanding).toBe('needs_clarification');
    expect(result.clarifyingQuestion).toMatch(/назв/i);
    expect(result.task).toBeNull();
  });

  it('after clarification, does not invent schedule from the transcript', () => {
    const result = normalizeVoiceParse(
      {
        understanding: 'complete',
        task: { name: "З'їздити в магазин", eventType: 'admin' },
      },
      {
        validPhaseIds: new Set(),
        alreadyClarified: true,
        transcript:
          "Створи задачу на завтра. З'їздити в магазин на другу дня.",
        timeZone: 'Asia/Nicosia',
        nowIso: '2026-09-07T16:00:00.000Z',
        language: 'uk',
      },
    );
    expect(result.task?.name).toBe("З'їздити в магазин");
    expect(result.understanding).toBe('complete');
    expect(result.task?.isUnscheduled).toBe(true);
    expect(result.task?.scheduledStartTime).toBeNull();
  });

  it('rezones wrong offsets and does not invent relative hours from speech', () => {
    const relative = normalizeVoiceParse(
      {
        understanding: 'complete',
        task: {
          name: 'коротка перерва',
          kind: 'fixed',
          eventType: 'fixed',
          scheduledStartTime: '2026-10-13T15:00:00+03:00',
          scheduledEndTime: '2026-10-13T15:30:00+03:00',
        },
      },
      {
        validPhaseIds: new Set(),
        alreadyClarified: false,
        transcript: 'через дві години коротка перерва',
        timeZone: 'Europe/Kyiv',
        nowIso: '2026-10-13T10:00:00.000Z',
        language: 'uk',
      },
    );
    expect(relative.task?.eventType).toBe('fixed');
    expect(relative.task?.scheduledStartTime).toContain('T15:00:00+03:00');

    const zulu = normalizeVoiceParse(
      {
        understanding: 'complete',
        task: {
          name: 'коротка перерва',
          kind: 'fixed',
          scheduledStartTime: '2026-10-13T12:00:00.000Z',
          scheduledEndTime: '2026-10-13T12:30:00.000Z',
        },
      },
      {
        validPhaseIds: new Set(),
        alreadyClarified: false,
        transcript: 'через дві години коротка перерва',
        timeZone: 'Europe/Kyiv',
        nowIso: '2026-10-13T10:00:00.000Z',
        language: 'uk',
      },
    );
    expect(zulu.task?.eventType).toBe('fixed');
    expect(zulu.task?.scheduledStartTime).toContain('T15:00:00+03:00');
    expect(zulu.task?.scheduledEndTime).toContain('T15:30:00+03:00');

    const day = normalizeVoiceParse(
      {
        understanding: 'complete',
        task: {
          name: 'clean the desk',
          kind: 'flexible',
          earliestStartTime: '2026-10-13T00:00:00+02:00',
          deadline: '2026-10-13T23:59:00+02:00',
        },
      },
      {
        validPhaseIds: new Set(),
        alreadyClarified: false,
        transcript: 'clean the desk today',
        timeZone: 'Europe/Kyiv',
        nowIso: '2026-10-13T10:00:00.000Z',
        language: 'en',
      },
    );
    expect(day.task?.deadline).toBe('2026-10-13T23:59:00+03:00');
  });

  it('keeps model needs_clarification when a title and question are both present', () => {
    const result = normalizeVoiceParse(
      {
        understanding: 'needs_clarification',
        clarifyingQuestion: 'What should this task be called?',
        task: {
          name: 'buy milk',
          kind: 'unscheduled',
          isUnscheduled: true,
        },
      },
      {
        validPhaseIds: new Set(),
        alreadyClarified: false,
        transcript: 'buy milk',
        language: 'en',
      },
    );
    expect(result.understanding).toBe('needs_clarification');
    expect(result.clarifyingQuestion).toBe('What should this task be called?');
    expect(result.task?.name).toBe('buy milk');
  });
});

describe('clarificationOnlyResult', () => {
  it('keeps the model question and does not build a task', () => {
    const result = clarificationOnlyResult(
      {
        understanding: 'needs_clarification',
        clarifyingQuestion: 'Яку задачу?',
        task: { name: 'Молоко' },
      },
      'uk',
    );
    expect(result.understanding).toBe('needs_clarification');
    expect(result.clarifyingQuestion).toBe('Яку задачу?');
    expect(result.task).toBeNull();
    expect(result.command).toBeNull();
  });

  it('asks what to do when the model omitted the question', () => {
    const result = clarificationOnlyResult({}, 'en');
    expect(result.clarifyingQuestion).toBe('I did not understand. What should I do?');
    expect(result.task).toBeNull();
  });
});

describe('scheduleTodayYmd', () => {
  it('rolls back before wake after midnight', () => {
    expect(
      scheduleTodayYmd(
        '2026-09-07T22:30:00.000Z', // 01:30 Asia/Nicosia Sep 8
        'Asia/Nicosia',
        '10:00',
      ),
    ).toBe('2026-09-07');
  });

  it('keeps civil day after wake', () => {
    expect(
      scheduleTodayYmd(
        '2026-09-07T16:00:00.000Z', // 19:00 +03 Sep 7
        'Asia/Nicosia',
        '08:00',
      ),
    ).toBe('2026-09-07');
  });

  it('keeps civil today after sleep and before wake', () => {
    expect(
      scheduleTodayYmd(
        '2026-09-08T00:00:00.000Z', // 03:00 +03 Sep 8
        'Asia/Nicosia',
        '08:00',
        '02:00',
      ),
    ).toBe('2026-09-08');
    expect(
      scheduleTodayYmd(
        '2026-09-08T00:00:00.000Z',
        'Asia/Nicosia',
        '08:00',
        '22:00',
      ),
    ).toBe('2026-09-08');
  });

  it('rolls back only before an overnight sleep', () => {
    expect(
      scheduleTodayYmd(
        '2026-09-07T22:30:00.000Z', // 01:30 +03 Sep 8
        'Asia/Nicosia',
        '08:00',
        '02:00',
      ),
    ).toBe('2026-09-07');
  });
});

describe('buildLocalCalendarContext', () => {
  it('includes wake-day anchors and relative-time rules for the LLM', () => {
    const text = buildLocalCalendarContext(
      '2026-09-07T16:00:00.000Z',
      'Asia/Nicosia',
      '08:00',
    );
    expect(text).toContain('schedule today: 2026-09-07');
    expect(text).toContain('schedule tomorrow: 2026-09-08');
    expect(text).toContain('schedule +3 days: 2026-09-10');
    expect(text).toContain('even when already past now');
    expect(text).toContain('in N hours');
    expect(text).toContain('After sleep');
  });

  it('maps tomorrow to the next civil day after sleep and before wake', () => {
    const text = buildLocalCalendarContext(
      '2026-09-08T00:00:00.000Z', // 03:00 +03 Sep 8
      'Asia/Nicosia',
      '08:00',
      '22:00',
    );
    expect(text).toContain('schedule today: 2026-09-08');
    expect(text).toContain('schedule tomorrow: 2026-09-09');
    expect(text).not.toContain('before wake = still previous');
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
  });
});
