import type { PlacementStepService } from '../schedule/placement-step.service';
import type { PlacementPlan } from '../schedule/placement-step.util';
import type { Task } from '../tasks/entities/task.entity';
import { VoiceDayPlanner } from './voice-agent.day-plan';
import type { PlanDraft, PlanItem } from './voice-agent.types';

const TZ = 'Europe/Kyiv';
const DAY = '2026-10-18';

function item(id: string, patch: Partial<PlanItem> = {}): PlanItem {
  return {
    id,
    taskId: id.startsWith('new:') ? null : id,
    source: id.startsWith('new:') ? 'new' : 'unscheduled',
    name: id,
    durationMinutes: 30,
    preferredHm: null,
    earliestHm: null,
    deadlineHm: null,
    ...patch,
  };
}

function draft(items: PlanItem[], patch: Partial<PlanDraft> = {}): PlanDraft {
  return {
    day: DAY,
    stage: 'review',
    interviewAsked: 0,
    items,
    revision: 0,
    nextNewId: 1,
    lastProposal: null,
    ...patch,
  };
}

function seated(startIso: string, minutes = 30): PlacementPlan {
  const start = new Date(startIso);
  return {
    outcome: 'seated',
    start,
    end: new Date(start.getTime() + minutes * 60_000),
    moves: [],
  } as unknown as PlacementPlan;
}

function build(plans: PlacementPlan[] | Error, stored: Partial<Task>[] = []) {
  const previewSequence = jest.fn(async () => {
    if (plans instanceof Error) throw plans;
    return plans;
  });
  const placement = { previewSequence } as unknown as PlacementStepService;
  const repo = { find: jest.fn(async () => stored as Task[]) };
  const planner = new VoiceDayPlanner(placement, repo as never);
  return { planner, previewSequence, repo };
}

describe('VoiceDayPlanner.propose', () => {
  it('seats items in draft order with plan constraints and sorts by start', async () => {
    const { planner, previewSequence } = build(
      [seated('2026-10-18T12:00:00.000Z'), seated('2026-10-18T07:00:00.000Z', 60)],
      [{ id: 'a', name: 'A', userId: 'u1', deadline: null }],
    );
    const proposal = await planner.propose(
      'u1',
      draft([
        item('a', { preferredHm: '15:00', deadlineHm: '18:00' }),
        item('new:1', { name: 'Gym', durationMinutes: 60 }),
      ]),
      TZ,
    );

    const call = (previewSequence.mock.calls[0] as unknown[])[1] as {
      windowYmd: string;
      entries: Array<{ task: Task; preferredStart: Date | null }>;
      ignoreTaskIds: string[];
    };
    expect(call.windowYmd).toBe(DAY);
    expect(call.ignoreTaskIds).toEqual(['a']);
    expect(call.entries[0].preferredStart?.toISOString()).toBe('2026-10-18T12:00:00.000Z');
    expect(new Date(call.entries[0].task.deadline as Date).toISOString()).toBe('2026-10-18T15:00:00.000Z');
    expect(call.entries[1].task).toMatchObject({ id: 'new:1', name: 'Gym', estimatedTimeInMinutes: 60 });

    expect(proposal.items.map((row) => row.itemId)).toEqual(['new:1', 'a']);
    expect(proposal.revision).toBe(1);
    expect(proposal.changedItemIds).toEqual([]);
  });

  it('reports unplaced reasons and drops items whose task vanished', async () => {
    const { planner } = build(
      [
        { outcome: 'unscheduled', reason: 'deadline' } as unknown as PlacementPlan,
        { outcome: 'problematic', reason: 'full' } as unknown as PlacementPlan,
      ],
      [{ id: 'a', name: 'A' }],
    );
    const proposal = await planner.propose('u1', draft([item('a'), item('gone'), item('new:1')]), TZ);
    expect(proposal.items).toEqual([]);
    expect(proposal.unplaced).toEqual([
      { itemId: 'a', name: 'a', reason: 'deadline_passed' },
      { itemId: 'new:1', name: 'new:1', reason: 'no_room' },
    ]);
  });

  it('marks moved, new and newly unplaced items as changed', async () => {
    const previous = {
      day: DAY,
      stage: 'review' as const,
      revision: 1,
      items: [
        { itemId: 'a', taskId: 'a', source: 'unscheduled' as const, name: 'a', start: '2026-10-18T07:00:00.000Z', end: '2026-10-18T07:30:00.000Z', durationMinutes: 30 },
        { itemId: 'b', taskId: 'b', source: 'unscheduled' as const, name: 'b', start: '2026-10-18T08:00:00.000Z', end: '2026-10-18T08:30:00.000Z', durationMinutes: 30 },
        { itemId: 'c', taskId: 'c', source: 'unscheduled' as const, name: 'c', start: '2026-10-18T09:00:00.000Z', end: '2026-10-18T09:30:00.000Z', durationMinutes: 30 },
      ],
      unplaced: [],
      changedItemIds: [],
    };
    const { planner } = build(
      [
        seated('2026-10-18T07:00:00.000Z'),
        seated('2026-10-18T10:00:00.000Z'),
        { outcome: 'problematic' } as unknown as PlacementPlan,
        seated('2026-10-18T11:00:00.000Z'),
      ],
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    );
    const proposal = await planner.propose(
      'u1',
      draft([item('a'), item('b'), item('c'), item('new:1')], { lastProposal: previous, revision: 1 }),
      TZ,
    );
    expect(proposal.revision).toBe(2);
    expect(proposal.changedItemIds.sort()).toEqual(['b', 'c', 'new:1']);
  });

  it('treats a failed preview as nothing placed', async () => {
    const { planner } = build(new Error('db down'));
    const proposal = await planner.propose('u1', draft([item('new:1')]), TZ);
    expect(proposal.items).toEqual([]);
    expect(proposal.unplaced).toEqual([{ itemId: 'new:1', name: 'new:1', reason: 'no_room' }]);
  });
});
