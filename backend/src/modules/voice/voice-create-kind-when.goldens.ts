/**
 * Baseline create kind/when goldens (roadmap §23.2).
 * Each case freezes: transcript → specialist JSON → expected normalize outcome.
 * No live LLM. Seeded from CREATE_KIND_WHEN_MODULE examples / branches.
 */

export type CreateKindWhenGolden = {
  /** Stable id for harvest / CI failures. */
  id: string;
  /** Branch number in CREATE_KIND_WHEN_MODULE (1–6). */
  branch: 1 | 2 | 3 | 4 | 5 | 6;
  transcript: string;
  language: 'uk' | 'en';
  /** Frozen specialist JSON (what a correct LLM reply looks like). */
  llm: Record<string, unknown>;
  expect: {
    understanding: 'complete' | 'needs_clarification';
    /** Inferred kind after normalize (same rules as voice.parse.result). */
    kind: 'recurring' | 'fixed' | 'flexible' | 'unscheduled';
    taskName: string;
    isUnscheduled?: boolean;
    isRecurring?: boolean;
    recurrencePattern?: string | null;
    recurrenceWeekDays?: number[] | null;
    eventType?: 'fixed' | 'admin';
    estimatedTimeInMinutes?: number;
    scheduledStartTime?: string | null;
    scheduledEndTime?: string | null;
    earliestStartTime?: string | null;
    deadline?: string | null;
  };
};

/** Shared anchors for baseline goldens (Europe/Kyiv afternoon). */
export const CREATE_KIND_WHEN_GOLDEN_ANCHORS = {
  timeZone: 'Europe/Kyiv',
  nowIso: '2026-10-13T10:00:00.000Z',
  wakeTime: '08:00',
  defaultTaskDurationMinutes: 30,
} as const;

/**
 * Six first-match branches + the documented event-span fixed example (still branch 2).
 * Dates match "schedule tomorrow" = 2026-10-14 in Kyiv for the frozen nowIso.
 */
export const CREATE_KIND_WHEN_GOLDENS: CreateKindWhenGolden[] = [
  {
    id: 'kw-1-recurring-weekly-preferred-clock',
    branch: 1,
    transcript: 'щовівторка о 15:00 до стоматолога',
    language: 'uk',
    llm: {
      understanding: 'complete',
      clarifyingQuestion: null,
      task: {
        name: 'Стоматолог',
        kind: 'recurring',
        isRecurring: true,
        recurrencePattern: 'WEEKLY',
        recurrenceWeekDays: [2],
        estimatedTimeInMinutes: 30,
        scheduledStartTime: '2026-10-14T15:00:00+03:00',
        scheduledEndTime: '2026-10-14T15:30:00+03:00',
        earliestStartTime: null,
        deadline: null,
      },
    },
    expect: {
      understanding: 'complete',
      kind: 'recurring',
      taskName: 'Стоматолог',
      isRecurring: true,
      recurrencePattern: 'WEEKLY',
      recurrenceWeekDays: [2],
      eventType: 'admin',
      estimatedTimeInMinutes: 30,
      scheduledStartTime: '2026-10-14T15:00:00+03:00',
      scheduledEndTime: '2026-10-14T15:30:00+03:00',
      earliestStartTime: null,
      deadline: null,
    },
  },
  {
    id: 'kw-2-fixed-tomorrow-clock',
    branch: 2,
    transcript: 'завтра о 15:00 до стоматолога',
    language: 'uk',
    llm: {
      understanding: 'complete',
      clarifyingQuestion: null,
      task: {
        name: 'Стоматолог',
        kind: 'fixed',
        eventType: 'fixed',
        estimatedTimeInMinutes: 30,
        scheduledStartTime: '2026-10-14T15:00:00+03:00',
        scheduledEndTime: '2026-10-14T15:30:00+03:00',
        earliestStartTime: null,
        deadline: null,
      },
    },
    expect: {
      understanding: 'complete',
      kind: 'fixed',
      taskName: 'Стоматолог',
      eventType: 'fixed',
      estimatedTimeInMinutes: 30,
      scheduledStartTime: '2026-10-14T15:00:00+03:00',
      scheduledEndTime: '2026-10-14T15:30:00+03:00',
      earliestStartTime: null,
      deadline: null,
      isRecurring: false,
      isUnscheduled: false,
    },
  },
  {
    id: 'kw-2b-fixed-event-span-is-duration',
    branch: 2,
    transcript: 'зустріч з 15 до 16',
    language: 'uk',
    llm: {
      understanding: 'complete',
      clarifyingQuestion: null,
      task: {
        name: 'Зустріч',
        kind: 'fixed',
        eventType: 'fixed',
        estimatedTimeInMinutes: 60,
        scheduledStartTime: '2026-10-13T15:00:00+03:00',
        scheduledEndTime: '2026-10-13T16:00:00+03:00',
        earliestStartTime: null,
        deadline: null,
      },
    },
    expect: {
      understanding: 'complete',
      kind: 'fixed',
      taskName: 'Зустріч',
      eventType: 'fixed',
      estimatedTimeInMinutes: 60,
      scheduledStartTime: '2026-10-13T15:00:00+03:00',
      scheduledEndTime: '2026-10-13T16:00:00+03:00',
    },
  },
  {
    id: 'kw-3-flexible-preferred-soft-clock',
    branch: 3,
    transcript: 'десь о третій зайти в магазин',
    language: 'uk',
    llm: {
      understanding: 'complete',
      clarifyingQuestion: null,
      task: {
        name: 'Зайти в магазин',
        kind: 'flexible',
        eventType: 'admin',
        estimatedTimeInMinutes: 30,
        scheduledStartTime: '2026-10-13T15:00:00+03:00',
        scheduledEndTime: '2026-10-13T15:30:00+03:00',
        earliestStartTime: null,
        deadline: null,
      },
    },
    expect: {
      understanding: 'complete',
      kind: 'flexible',
      taskName: 'Зайти в магазин',
      eventType: 'admin',
      estimatedTimeInMinutes: 30,
      scheduledStartTime: '2026-10-13T15:00:00+03:00',
      scheduledEndTime: '2026-10-13T15:30:00+03:00',
      isUnscheduled: false,
    },
  },
  {
    id: 'kw-4-flexible-placement-window',
    branch: 4,
    transcript: 'між 14 і 18 купити продукти',
    language: 'uk',
    llm: {
      understanding: 'complete',
      clarifyingQuestion: null,
      task: {
        name: 'Купити продукти',
        kind: 'flexible',
        eventType: 'admin',
        estimatedTimeInMinutes: 30,
        earliestStartTime: '2026-10-13T14:00:00+03:00',
        deadline: '2026-10-13T18:00:00+03:00',
        scheduledStartTime: null,
        scheduledEndTime: null,
      },
    },
    expect: {
      understanding: 'complete',
      kind: 'flexible',
      taskName: 'Купити продукти',
      eventType: 'admin',
      estimatedTimeInMinutes: 30,
      earliestStartTime: '2026-10-13T14:00:00+03:00',
      deadline: '2026-10-13T18:00:00+03:00',
      scheduledStartTime: null,
      scheduledEndTime: null,
      isUnscheduled: false,
    },
  },
  {
    id: 'kw-5-day-only-flexible-window',
    branch: 5,
    transcript: 'завтра купити молоко',
    language: 'uk',
    llm: {
      understanding: 'complete',
      clarifyingQuestion: null,
      task: {
        name: 'Купити молоко',
        kind: 'flexible',
        eventType: 'admin',
        estimatedTimeInMinutes: 30,
        earliestStartTime: '2026-10-14T00:00:00+03:00',
        deadline: '2026-10-14T23:59:00+03:00',
        scheduledStartTime: null,
        scheduledEndTime: null,
      },
    },
    expect: {
      understanding: 'complete',
      kind: 'flexible',
      taskName: 'Купити молоко',
      eventType: 'admin',
      estimatedTimeInMinutes: 30,
      earliestStartTime: '2026-10-14T00:00:00+03:00',
      deadline: '2026-10-14T23:59:00+03:00',
      scheduledStartTime: null,
      scheduledEndTime: null,
      isUnscheduled: false,
    },
  },
  {
    id: 'kw-6-no-when-unscheduled',
    branch: 6,
    transcript: 'треба купити молоко',
    language: 'uk',
    llm: {
      understanding: 'complete',
      clarifyingQuestion: null,
      task: {
        name: 'Купити молоко',
        kind: 'unscheduled',
        isUnscheduled: true,
        eventType: 'admin',
        estimatedTimeInMinutes: 30,
        scheduledStartTime: null,
        scheduledEndTime: null,
        earliestStartTime: null,
        deadline: null,
      },
    },
    expect: {
      understanding: 'complete',
      kind: 'unscheduled',
      taskName: 'Купити молоко',
      isUnscheduled: true,
      eventType: 'admin',
      estimatedTimeInMinutes: 30,
      scheduledStartTime: null,
      scheduledEndTime: null,
      earliestStartTime: null,
      deadline: null,
      isRecurring: false,
    },
  },
];
