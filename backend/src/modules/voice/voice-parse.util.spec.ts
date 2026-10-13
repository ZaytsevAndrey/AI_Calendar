import {
  buildLocalCalendarContext,
  inferClockHmRange,
  inferDueYmd,
  inferPreferredClockHm,
  inferScheduleWindow,
  localDateTimeIso,
  localHm,
  localYmd,
  normalizeClockHm,
  scheduleTodayYmd,
} from './voice-local-date.util';
import {
  clarificationOnlyResult,
  extractJsonObject,
  inferTaskNameFromTranscript,
  isBareCreateRequest,
  nameFromClarification,
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

  it('treats unscheduled clarify answer as inbox create', () => {
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
    // 14:00+03 = 11:00Z, before 18:00Z now → drop slot; fixed without times → admin
    expect(result.task?.scheduledStartTime).toBeNull();
    expect(result.task?.scheduledEndTime).toBeNull();
    expect(result.task?.eventType).toBe('admin');
    expect(result.task?.earliestStartTime).toBe(nowIso);
    expect(result.task?.deadline).toBe('2026-09-07T23:59:00+03:00');
  });

  it('infers a task name from uk create speech when the model left name empty', () => {
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
    expect(result.understanding).toBe('complete');
    expect(result.task?.name).toBe("З'їздити в магазин");
    expect(result.task?.timeZone).toBe('Asia/Nicosia');
    expect(result.task?.scheduledStartTime).toBe('2026-09-08T14:00:00+03:00');
  });

  it('clarifies incomplete create and ignores a model-invented boilerplate name', () => {
    const result = normalizeVoiceParse(
      {
        understanding: 'complete',
        task: { name: 'Задача', eventType: 'admin' },
      },
      {
        validPhaseIds: new Set(),
        alreadyClarified: false,
        transcript: 'Створи задачу на завтра.',
        timeZone: 'Asia/Nicosia',
        nowIso: '2026-09-07T16:00:00.000Z',
      },
    );
    expect(result.understanding).toBe('needs_clarification');
    expect(result.task?.name).toBeFalsy();
  });

  it('asks for a name when the utterance only asks to create a task', () => {
    const result = normalizeVoiceParse(
      {
        understanding: 'complete',
        task: { name: 'Треба задачу створити', eventType: 'admin' },
      },
      {
        validPhaseIds: new Set(),
        alreadyClarified: false,
        transcript: 'Треба задачу створити.',
        timeZone: 'Europe/Kyiv',
        nowIso: '2026-09-07T16:00:00.000Z',
        language: 'uk',
      },
    );
    expect(result.understanding).toBe('needs_clarification');
    expect(result.clarifyingQuestion).toBe('Як назвати цю задачу?');
    expect(result.task).toBeNull();
  });

  it('uses only the clarification answer as the title', () => {
    const result = normalizeVoiceParse(
      {
        understanding: 'complete',
        task: {
          name: 'Треба створити задачу Назви її задачу',
          eventType: 'admin',
        },
      },
      {
        validPhaseIds: new Set(),
        alreadyClarified: true,
        transcript: 'Треба створити задачу. Назви її задачу.',
        clarificationAnswer: 'Назви її задачу.',
        timeZone: 'Europe/Kyiv',
        nowIso: '2026-09-07T16:00:00.000Z',
        language: 'uk',
      },
    );
    expect(result.understanding).toBe('complete');
    expect(result.task?.name).toBe('Задача');
    expect(result.task?.isUnscheduled).toBe(true);
  });

  it('salvages a title and defaults to Unscheduled when model omitted when', () => {
    const result = normalizeVoiceParse(
      {
        understanding: 'complete',
        task: { name: '', eventType: 'admin' },
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

describe('inferPreferredClockHm', () => {
  it('maps на другу дня to 14:00', () => {
    expect(inferPreferredClockHm('на другу дня')).toBe('14:00');
    expect(inferPreferredClockHm("З'їздити в магазин на другу дня")).toBe(
      '14:00',
    );
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
    expect(text).toContain('must be >= now ISO');
    expect(text).toContain('через N годин');
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

describe('isBareCreateRequest', () => {
  it('treats a create request with no errand as unnamed', () => {
    expect(isBareCreateRequest('Треба задачу створити.')).toBe(true);
    expect(isBareCreateRequest('Хочу створити задачу')).toBe(true);
    expect(isBareCreateRequest('create a task')).toBe(true);
    expect(isBareCreateRequest('треба купити молоко')).toBe(false);
  });

  it('reads a title out of a naming answer', () => {
    expect(nameFromClarification('Назви її задачу.')).toBe('Задача');
    expect(nameFromClarification('Назви її купити молоко')).toBe('Купити молоко');
  });
});

describe('inferTaskNameFromTranscript', () => {
  it('strips create / day / time boilerplate in uk', () => {
    expect(
      inferTaskNameFromTranscript(
        "Створи задачу на завтра. З'їздити в магазин на другу дня.",
      ),
    ).toBe("З'їздити в магазин");
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
