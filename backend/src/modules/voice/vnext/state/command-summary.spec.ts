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
