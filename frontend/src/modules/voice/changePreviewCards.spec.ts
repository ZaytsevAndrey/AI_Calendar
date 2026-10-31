import { buildChangePreviewCards, formatPreviewWhen } from './changePreviewCards';
import type { VoiceWriteIntent } from 'api/voice.api';
import i18n from 'i18n';

describe('buildChangePreviewCards', () => {
  it('shows behavior and repeating independently (all four combinations)', () => {
    const create = (eventType: 'fixed' | 'admin', isRecurring: boolean): VoiceWriteIntent => ({
      type: 'create',
      summary: 'Created',
      task: {
        name: `${eventType}-${isRecurring}`,
        eventType,
        estimatedTimeInMinutes: 60,
        isRecurring,
        ...(isRecurring ? { recurrencePattern: 'WEEKLY' } : {}),
        allowSplit: false,
        priority: 'medium',
        scheduledStartTime: '2026-10-19T07:00:00.000Z',
        scheduledEndTime: '2026-10-19T08:00:00.000Z',
      },
    });
    const cards = buildChangePreviewCards({
      intents: [
        create('fixed', false),
        create('fixed', true),
        create('admin', false),
        create('admin', true),
      ],
    });
    expect(cards.map((card) => [card.taskType, !!card.repeats])).toEqual([
      ['fixed', false],
      ['fixed', true],
      ['flexible', false],
      ['flexible', true],
    ]);
  });

  it('maps create intent to a create card with duration', () => {
    const intents: VoiceWriteIntent[] = [
      {
        type: 'create',
        summary: 'Created Milk',
        task: {
          name: 'Milk',
          eventType: 'admin',
          estimatedTimeInMinutes: 45,
          isRecurring: false,
          allowSplit: false,
          priority: 'medium',
          earliestStartTime: '2026-10-18T10:00:00.000Z',
          scheduledStartTime: '2026-10-18T10:00:00.000Z',
          scheduledEndTime: '2026-10-18T10:45:00.000Z',
        },
      },
    ];
    const cards = buildChangePreviewCards({ intents });
    expect(cards).toHaveLength(1);
    expect(cards[0].kind).toBe('create');
    expect(cards[0].taskType).toBe('flexible');
    expect(cards[0].name).toBe('Milk');
    expect(cards[0].durationMinutes).toBe(45);
    expect(cards[0].startIso).toBe('2026-10-18T10:00:00.000Z');
  });

  it('maps delete command to a delete card', () => {
    const intents: VoiceWriteIntent[] = [
      {
        type: 'command',
        summary: 'Delete report',
        command: {
          kind: 'delete',
          taskId: 't1',
          taskName: 'Report',
          summary: 'Delete report',
        },
      },
    ];
    const cards = buildChangePreviewCards({ intents });
    expect(cards).toHaveLength(1);
    expect(cards[0].kind).toBe('delete');
    expect(cards[0].taskType).toBeNull();
    expect(cards[0].name).toBe('Report');
  });

  // VC-13: a repeat with no clock is a series the engine seats, not a Later task.
  it('shows a recurring create with no clock as a flexible series, not Later', () => {
    const cards = buildChangePreviewCards({
      intents: [{
        type: 'create',
        summary: 'Exercise',
        task: {
          name: 'Exercise',
          eventType: 'admin',
          estimatedTimeInMinutes: 60,
          isRecurring: true,
          recurrencePattern: 'WEEKLY',
          recurrenceWeekDays: [1],
          isUnscheduled: false,
          allowSplit: false,
          priority: 'medium',
        },
      }],
    });
    expect(cards[0]).toMatchObject({ kind: 'create', taskType: 'flexible', repeats: true, startIso: null });
  });

  // VC-06: a card on a repeating task says which part of the series it touches.
  it('carries the series scope of a command onto its card', () => {
    const command = (c: Extract<VoiceWriteIntent, { type: 'command' }>['command']): VoiceWriteIntent => ({ type: 'command', summary: c.summary, command: c });
    const cards = buildChangePreviewCards({
      intents: [
        command({ kind: 'skip', taskId: 'g', taskName: 'Gym', summary: 'Skip', occurrenceStart: '2026-10-21T07:00:00.000Z', googleEventId: null, googleEventCalendarId: null }),
        command({ kind: 'end_series', taskId: 'g', taskName: 'Gym', summary: 'End', occurrenceStart: '2026-10-21T07:00:00.000Z', googleEventId: null, googleEventCalendarId: null }),
        command({ kind: 'delete', taskId: 'g', taskName: 'Gym', summary: 'Delete', seriesScope: 'all' }),
        command({ kind: 'complete', taskId: 'g', taskName: 'Gym', summary: 'Done', seriesScope: 'all' }),
        command({ kind: 'update', taskId: 'g', taskName: 'Gym', summary: 'Rename', patch: { name: 'Yoga' }, seriesScope: 'all' }),
        command({ kind: 'move', taskId: 'g', taskName: 'Gym', summary: 'Move', googleEventId: 'e', calendarId: null, recurringEventId: 'm', originalStart: '2026-10-21T07:00:00.000Z', originalEnd: '2026-10-21T08:00:00.000Z', start: '2026-10-21T12:00:00.000Z', end: '2026-10-21T13:00:00.000Z', seriesScope: 'series' }),
        command({ kind: 'delete', taskId: 'r', taskName: 'Report', summary: 'Delete one-off' }),
      ],
    });
    expect(cards.map((card) => card.scope ?? null)).toEqual(['occurrence', 'series', 'all', 'all', 'all', 'series', null]);
    expect(cards.slice(0, 6).every((card) => card.repeats)).toBe(true);
    expect(cards[6].repeats).toBeFalsy();
  });

  // WP-B: a per-day edit shows the day it touches and its scope; a per-day completion is a done card.
  it('shows an occurrence edit as an edit of that day, and a per-day completion as done', () => {
    const cards = buildChangePreviewCards({
      intents: [
        { type: 'command', summary: 'Rename', command: { kind: 'edit_occurrence', taskId: 'g', taskName: 'Gym', summary: 'Rename', occurrenceStart: '2026-10-21T15:00:00.000Z', scope: 'occurrence', name: 'Yoga', start: '2026-10-21T16:00:00.000Z', durationMinutes: 45, googleEventId: null, googleEventCalendarId: null, seriesScope: 'occurrence' } },
        { type: 'command', summary: 'Done', command: { kind: 'edit_occurrence', taskId: 'g', taskName: 'Gym', summary: 'Done', occurrenceStart: '2026-10-22T15:00:00.000Z', scope: 'occurrence', status: 'completed', googleEventId: null, googleEventCalendarId: null, seriesScope: 'occurrence' } },
        { type: 'command', summary: 'From', command: { kind: 'edit_occurrence', taskId: 'g', taskName: 'Gym', summary: 'From', occurrenceStart: '2026-10-22T15:00:00.000Z', scope: 'following', start: '2026-10-22T06:00:00.000Z', googleEventId: null, googleEventCalendarId: null, seriesScope: 'series' } },
      ],
    });
    expect(cards.map((card) => [card.kind, card.scope, card.startIso, card.durationMinutes, card.name])).toEqual([
      ['edit', 'occurrence', '2026-10-21T16:00:00.000Z', 45, 'Yoga'],
      ['complete', 'occurrence', '2026-10-22T15:00:00.000Z', null, 'Gym'],
      ['edit', 'series', '2026-10-22T06:00:00.000Z', null, 'Gym'],
    ]);
    expect(cards.every((card) => card.repeats)).toBe(true);
  });

  it('maps a reminder create to a reminder card without a duration', () => {
    const intents: VoiceWriteIntent[] = [
      {
        type: 'command',
        summary: 'Reminder Pay rent on 2026-11-01 at 18:30.',
        command: {
          kind: 'remind_create',
          name: 'Pay rent',
          summary: 'Reminder Pay rent on 2026-11-01 at 18:30.',
          dueYmd: '2026-11-01',
          notificationTime: '18:30',
          description: null,
          recurrencePattern: 'MONTHLY',
          recurrenceWeekDays: null,
        },
      },
    ];
    const cards = buildChangePreviewCards({ intents });
    expect(cards[0].kind).toBe('remind');
    expect(cards[0].name).toBe('Pay rent');
    expect(cards[0].durationMinutes).toBeNull();
    expect(cards[0].taskType).toBeNull();
    expect(cards[0].startIso).toBe('2026-11-01T18:30:00');
  });

  it('prefers day-plan proposal items when present', () => {
    const cards = buildChangePreviewCards({
      intents: [
        {
          type: 'create',
          summary: 'ignored',
          task: {
            name: 'Ignored',
            eventType: 'admin',
            estimatedTimeInMinutes: 30,
            isRecurring: false,
            allowSplit: false,
            priority: 'medium',
          },
        },
      ],
      plan: {
        day: '2026-10-18',
        stage: 'review',
        revision: 2,
        items: [
          {
            itemId: 'a',
            taskId: 'a',
            source: 'unscheduled',
            name: 'Deep work',
            start: '2026-10-18T09:00:00.000Z',
            end: '2026-10-18T10:00:00.000Z',
            durationMinutes: 60,
          },
          {
            itemId: 'new:1',
            taskId: null,
            source: 'new',
            name: 'Gym',
            start: '2026-10-18T18:00:00.000Z',
            end: '2026-10-18T19:00:00.000Z',
            durationMinutes: 60,
          },
          {
            itemId: 'b',
            taskId: 'b',
            source: 'flexible',
            name: 'Email',
            start: '2026-10-18T11:00:00.000Z',
            end: '2026-10-18T11:30:00.000Z',
            durationMinutes: 30,
          },
        ],
        unplaced: [],
        changedItemIds: ['new:1'],
      },
    });
    expect(cards.map((card) => card.name)).toEqual(['Deep work', 'Gym', 'Email']);
    expect(cards.map((card) => card.kind)).toEqual(['window', 'create', 'shift']);
    expect(cards.map((card) => card.taskType)).toEqual(['unscheduled', 'flexible', 'flexible']);
    expect(cards.map((card) => Boolean(card.changed))).toEqual([false, true, false]);
    expect(cards[0].durationMinutes).toBe(60);
  });

  it('attaches execution statuses to intent cards', () => {
    const cards = buildChangePreviewCards({
      intents: [
        {
          type: 'command',
          summary: 'Done report',
          command: { kind: 'complete', taskId: 't1', taskName: 'Report', summary: 'Done report' },
        },
        {
          type: 'command',
          summary: 'Delete draft',
          command: { kind: 'delete', taskId: 't2', taskName: 'Draft', summary: 'Delete draft' },
        },
      ],
      statuses: ['applied', 'conflict'],
    });
    expect(cards.map((card) => card.status)).toEqual(['applied', 'conflict']);
  });

  it('returns empty when nothing to preview', () => {
    expect(buildChangePreviewCards({})).toEqual([]);
    expect(buildChangePreviewCards({ intents: [] })).toEqual([]);
  });

  it('puts the date and task type on a create draft', async () => {
    await i18n.changeLanguage('uk');
    const intents: VoiceWriteIntent[] = [
      {
        type: 'create',
        summary: 'Звіт',
        task: {
          name: 'Звіт',
          eventType: 'fixed',
          estimatedTimeInMinutes: 60,
          isRecurring: false,
          allowSplit: false,
          priority: 'urgent',
          scheduledStartTime: '2026-10-18T12:00:00.000Z',
          scheduledEndTime: '2026-10-18T13:00:00.000Z',
        },
      },
    ];
    const cards = buildChangePreviewCards({ intents });
    expect(cards[0].taskType).toBe('fixed');
    expect(formatPreviewWhen(cards[0], 'Europe/Kyiv', 'Без часу')).toBe(
      '18 жовт. 2026, 15:00–16:00',
    );
  });

  it('shows a day without a midnight clock, and a deadline on that day', async () => {
    await i18n.changeLanguage('uk');
    const intents: VoiceWriteIntent[] = [
      {
        type: 'create',
        summary: 'Молоко',
        task: {
          name: 'Молоко',
          eventType: 'admin',
          isUnscheduled: false,
          estimatedTimeInMinutes: 30,
          isRecurring: false,
          allowSplit: false,
          priority: 'medium',
          earliestStartTime: '2026-10-18T00:00:00+03:00',
          deadline: '2026-10-18T20:00:00+03:00',
        },
      },
    ];
    const cards = buildChangePreviewCards({ intents });
    expect(cards[0].taskType).toBe('flexible');
    expect(formatPreviewWhen(cards[0], 'Europe/Kyiv', 'Без часу')).toBe(
      '18 жовт. 2026, до 20:00',
    );
  });
});
