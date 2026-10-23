import { buildChangePreviewCards, formatPreviewWhen } from './changePreviewCards';
import type { VoiceWriteIntent } from 'api/voice.api';
import i18n from 'i18n';

describe('buildChangePreviewCards', () => {
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
