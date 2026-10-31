import type { PendingOperation } from '../contracts/proposal';
import { planStatusCopy } from '../day-plan/structured-day-plan';
import type { PlanDraft } from '../../voice-agent.types';
import { commandSummary } from './project-apply';

const TZ = 'Europe/Kyiv';

function operation(changes: PendingOperation['changes'] = {}, name = 'Report'): PendingOperation {
  return {
    pendingId: 'p-1',
    action: 'update',
    target: { kind: 'entity', entityId: 't-1', entityType: 'task', revision: 1, calendarId: null, writable: true, name },
    changes,
    sourceText: 'the thing I said',
  } as unknown as PendingOperation;
}

describe('commandSummary', () => {
  it('uses the stored title, not the transcript', () => {
    expect(commandSummary('uk', 'delete', operation(), { timeZone: TZ })).toBe('Видалити «Report»');
    expect(commandSummary('en', 'complete', operation(), { timeZone: TZ })).toBe('Mark done “Report”');
  });

  it('names both titles for a rename', () => {
    expect(commandSummary('uk', 'update', operation({ title: 'Annual report' }), { timeZone: TZ })).toBe('Перейменувати «Report» на «Annual report»');
  });

  it('gives the new local start of a move and the day of an occurrence', () => {
    expect(commandSummary('uk', 'move', operation(), { timeZone: TZ }, { start: '2026-10-19T15:00:00.000Z' })).toBe('Перенести «Report» на 2026-10-19 18:00');
    expect(commandSummary('en', 'skip', operation(), { timeZone: TZ }, { occurrence: '2026-10-20T06:00:00.000Z' })).toBe('Skip “Report” on 2026-10-20');
  });

  // VC-06: the scope of a write on a repeating task is part of the preview text.
  describe('series scope', () => {
    const series = (scope: 'occurrence' | 'from_day' | 'all', changes: PendingOperation['changes'] = {}): PendingOperation => ({
      ...operation(changes, 'Gym'),
      target: { kind: 'entity', entityId: 't-2', entityType: 'task', revision: 1, calendarId: null, writable: true, name: 'Gym', recurring: true },
      seriesScope: scope,
    } as unknown as PendingOperation);

    it('says the whole series for a series-wide delete, done, cancel, or field change', () => {
      expect(commandSummary('en', 'delete', series('all'), { timeZone: TZ })).toBe('Delete “Gym” — the whole series');
      expect(commandSummary('uk', 'delete', series('all'), { timeZone: TZ })).toBe('Видалити «Gym» — усю серію');
      expect(commandSummary('uk', 'complete', series('all'), { timeZone: TZ })).toBe('Позначити виконаною «Gym» — усю серію');
      expect(commandSummary('en', 'update', series('all'), { timeZone: TZ })).toBe('Change “Gym” — the whole series');
      expect(commandSummary('en', 'update', series('all', { title: 'Yoga' }), { timeZone: TZ })).toBe('Rename “Gym” to “Yoga” — the whole series');
    });

    it('says this day only, this day and following, or every open day', () => {
      expect(commandSummary('en', 'skip', series('occurrence'), { timeZone: TZ }, { occurrence: '2026-10-20T06:00:00.000Z' })).toBe('Skip “Gym” on 2026-10-20 — this day only');
      // WP-B: one day is completed in place through the occurrence endpoint, no longer cleared from the calendar.
      expect(commandSummary('uk', 'complete_occurrence', series('occurrence'), { timeZone: TZ }, { occurrence: '2026-10-20T06:00:00.000Z' })).toBe('Позначити виконаним «Gym» за 2026-10-20 — лише цей день');
      expect(commandSummary('en', 'edit_occurrence', series('occurrence', { title: 'Yoga' }), { timeZone: TZ }, { occurrence: '2026-10-20T06:00:00.000Z' })).toBe('Rename “Gym” to “Yoga” on 2026-10-20 — this day only');
      expect(commandSummary('uk', 'edit_occurrence', series('from_day'), { timeZone: TZ }, { occurrence: '2026-10-20T06:00:00.000Z' })).toBe('Змінити «Gym» з 2026-10-20 — цей день і наступні');
      expect(commandSummary('en', 'end_series', series('from_day'), { timeZone: TZ }, { occurrence: '2026-10-20T06:00:00.000Z' })).toBe('End the series “Gym” from 2026-10-20 — this day and following');
      expect(commandSummary('uk', 'move', series('from_day'), { timeZone: TZ }, { start: '2026-10-20T12:00:00.000Z' })).toBe('Перенести «Gym» на 2026-10-20 15:00 — цей день і наступні');
      expect(commandSummary('en', 'move', series('all'), { timeZone: TZ }, { start: '2026-10-20T12:00:00.000Z' })).toBe('Move “Gym” to 2026-10-20 15:00 — every open day');
    });

    it('leaves a one-off and a provider instance alone', () => {
      expect(commandSummary('en', 'delete', operation(), { timeZone: TZ })).toBe('Delete “Report”');
      const instance = { ...series('occurrence'), target: { ...series('occurrence').target, entityType: 'external_event' } } as unknown as PendingOperation;
      expect(commandSummary('en', 'delete', instance, { timeZone: TZ })).toBe('Delete “Gym”');
    });
  });
});

describe('planStatusCopy', () => {
  const draft = (items: Array<{ id: string; name: string; preferredHm?: string }>): PlanDraft => ({
    day: '2026-10-19',
    stage: 'interview',
    interviewAsked: 0,
    revision: 0,
    nextNewId: 1,
    lastProposal: null,
    items: items.map((item) => ({
      id: item.id,
      taskId: null,
      source: 'new',
      name: item.name,
      durationMinutes: 30,
      preferredHm: item.preferredHm ?? null,
      earliestHm: null,
      deadlineHm: null,
    })),
  });

  it('says what was added and removed and what the plan holds', () => {
    const before = draft([{ id: 'a', name: 'Walk' }, { id: 'b', name: 'Gym' }]);
    const after = draft([{ id: 'a', name: 'Walk', preferredHm: '18:00' }, { id: 'c', name: 'Read' }]);
    expect(planStatusCopy('uk', before, after)).toBe('Додав: Read. Прибрав: Gym. У плані: Walk (18:00), Read. Додати ще щось чи складати план?');
  });

  it('says the plan is empty on a fresh start', () => {
    expect(planStatusCopy('en', null, draft([]))).toBe('The plan is empty so far. Add anything else, or build the plan?');
  });
});
