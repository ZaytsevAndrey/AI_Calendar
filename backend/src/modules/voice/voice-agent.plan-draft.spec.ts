import { TaskEventType } from '../scheduling/event-type.enum';
import type { ScheduledTask } from '../schedule/schedule.entity';
import { ScheduleState, type Task, TaskStatus } from '../tasks/entities/task.entity';
import {
  applyPlanEdits,
  initialPlanDraft,
  parsePlanEdits,
  planToIntents,
  type PlanDraftContext,
} from './voice-agent.plan-draft';
import type { DayPlanProposal } from './voice-agent.types';

const TZ = 'Europe/Kyiv';
const DAY = '2026-10-18';

function task(id: string, patch: Partial<Task> = {}): Task {
  return {
    id,
    name: id,
    status: TaskStatus.TODO,
    eventType: TaskEventType.ADMIN,
    isUnscheduled: false,
    isRecurring: false,
    isFixedExternal: false,
    scheduleState: ScheduleState.NONE,
    estimatedTimeInMinutes: 30,
    deadline: null,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    ...patch,
  } as Task;
}

function slot(id: string, taskId: string, startIso: string, minutes = 30): ScheduledTask {
  const start = new Date(startIso);
  return {
    id,
    taskId,
    scheduledStartTime: start,
    scheduledEndTime: new Date(start.getTime() + minutes * 60_000),
  } as ScheduledTask;
}

function ctx(tasks: Task[], slots: ScheduledTask[] = []): PlanDraftContext {
  return {
    tasks,
    slots,
    timeZone: TZ,
    nowIso: '2026-10-18T06:00:00.000Z',
    defaultDurationMinutes: 45,
  };
}

describe('initialPlanDraft', () => {
  it('takes Later tasks oldest first, then flexible one-offs on that day', () => {
    const tasks = [
      task('u-late', { isUnscheduled: true, deadline: new Date('2026-10-30T00:00:00Z') }),
      task('u-soon', { isUnscheduled: true, deadline: new Date('2026-10-20T00:00:00Z') }),
      task('u-none', { isUnscheduled: true }),
      task('flex', {}),
      task('fixed', { eventType: TaskEventType.FIXED }),
      task('series', { isRecurring: true }),
      task('done', { isUnscheduled: true, status: TaskStatus.COMPLETED }),
      task('other-day', {}),
    ];
    const slots = [
      slot('s1', 'flex', '2026-10-18T10:00:00.000Z'),
      slot('s2', 'fixed', '2026-10-18T12:00:00.000Z'),
      slot('s3', 'other-day', '2026-10-19T10:00:00.000Z'),
    ];
    const draft = initialPlanDraft(DAY, ctx(tasks, slots));
    expect(draft.items.map((item) => item.id)).toEqual(['u-late', 'u-soon', 'u-none', 'flex']);
    const flex = draft.items.find((item) => item.id === 'flex');
    expect(flex).toMatchObject({ source: 'flexible', preferredHm: '13:00' });
    expect(draft.stage).toBe('review');
  });

  it('skips flexible tasks whose slot already started', () => {
    const tasks = [task('past')];
    const slots = [slot('s1', 'past', '2026-10-18T05:00:00.000Z')];
    expect(initialPlanDraft(DAY, ctx(tasks, slots)).items).toEqual([]);
  });
});

describe('parsePlanEdits', () => {
  it('validates clocks, durations and ids', () => {
    expect(
      parsePlanEdits([
        { op: 'add_task', name: ' Gym ', durationMinutes: 2, earliestHm: '9:30' },
        { op: 'set_duration', itemId: 'a', minutes: 3 },
        { op: 'set_window', itemId: 'a', deadlineHm: '18:00' },
        { op: 'set_order', itemIds: ['b', '', 'a'] },
        { op: 'include_task' },
        null,
      ]),
    ).toEqual([
      {
        op: 'add_task',
        name: 'Gym',
        durationMinutes: null,
        preferredHm: null,
        earliestHm: '09:30',
        deadlineHm: null,
      },
      { op: 'set_window', itemId: 'a', deadlineHm: '18:00' },
      { op: 'set_order', itemIds: ['b', 'a'] },
    ]);
    expect(parsePlanEdits('nope')).toEqual([]);
  });
});

describe('applyPlanEdits', () => {
  const base = () =>
    initialPlanDraft(DAY, ctx([task('a', { isUnscheduled: true }), task('b', { isUnscheduled: true })]));

  it('adds new tasks with sequential ids and the default duration', () => {
    const c = ctx([]);
    const next = applyPlanEdits(
      base(),
      [
        { op: 'add_task', name: 'Gym', durationMinutes: null, preferredHm: '18:00', earliestHm: null, deadlineHm: null },
        { op: 'add_task', name: 'Call', durationMinutes: 15, preferredHm: null, earliestHm: null, deadlineHm: null },
      ],
      c,
    );
    expect(next.items.slice(-2)).toMatchObject([
      { id: 'new:1', source: 'new', taskId: null, durationMinutes: 45, preferredHm: '18:00' },
      { id: 'new:2', durationMinutes: 15 },
    ]);
    expect(next.nextNewId).toBe(3);
  });

  it('removes, reorders, resizes and does not mutate the input', () => {
    const draft = base();
    const next = applyPlanEdits(
      draft,
      [
        { op: 'set_order', itemIds: ['b'] },
        { op: 'set_duration', itemId: 'a', minutes: 90 },
        { op: 'remove_item', itemId: 'missing' },
      ],
      ctx([]),
    );
    expect(next.items.map((item) => item.id)).toEqual(['b', 'a']);
    expect(next.items[1].durationMinutes).toBe(90);
    expect(draft.items[0].durationMinutes).toBe(30);
    expect(applyPlanEdits(next, [{ op: 'remove_item', itemId: 'a' }], ctx([])).items.map((i) => i.id)).toEqual(['b']);
  });

  it('drops a preferred start outside a new window', () => {
    const draft = applyPlanEdits(base(), [{ op: 'set_preferred_start', itemId: 'a', hm: '09:00' }], ctx([]));
    const next = applyPlanEdits(draft, [{ op: 'set_window', itemId: 'a', earliestHm: '14:00' }], ctx([]));
    expect(next.items[0]).toMatchObject({ earliestHm: '14:00', preferredHm: null });
  });

  it('includes an existing task once and ignores fixed ones', () => {
    const tasks = [task('a', { isUnscheduled: true }), task('x', { isUnscheduled: true }), task('f', { eventType: TaskEventType.FIXED })];
    const draft = initialPlanDraft(DAY, { ...ctx(tasks), tasks: [tasks[0]] });
    const next = applyPlanEdits(
      draft,
      [
        { op: 'include_task', taskId: 'x' },
        { op: 'include_task', taskId: 'x' },
        { op: 'include_task', taskId: 'f' },
      ],
      ctx(tasks),
    );
    expect(next.items.map((item) => item.id)).toEqual(['a', 'x']);
  });
});

describe('planToIntents', () => {
  const proposal = (items: DayPlanProposal['items']): DayPlanProposal => ({
    day: DAY,
    stage: 'review',
    revision: 1,
    items,
    unplaced: [],
    changedItemIds: [],
  });

  it('maps sources to create / window / shift and skips unchanged flexible slots', () => {
    const slots = [
      slot('s-flex', 'flex', '2026-10-18T10:00:00.000Z'),
      slot('s-same', 'same', '2026-10-18T12:00:00.000Z'),
    ];
    const intents = planToIntents(
      proposal([
        { itemId: 'new:1', taskId: null, source: 'new', name: 'Gym', start: '2026-10-18T15:00:00.000Z', end: '2026-10-18T16:00:00.000Z', durationMinutes: 60 },
        { itemId: 'u', taskId: 'u', source: 'unscheduled', name: 'Taxes', start: '2026-10-18T07:00:00.000Z', end: '2026-10-18T07:30:00.000Z', durationMinutes: 30 },
        { itemId: 'flex', taskId: 'flex', source: 'flexible', name: 'Email', start: '2026-10-18T11:00:00.000Z', end: '2026-10-18T11:30:00.000Z', durationMinutes: 30 },
        { itemId: 'same', taskId: 'same', source: 'flexible', name: 'Read', start: '2026-10-18T12:00:00.000Z', end: '2026-10-18T12:30:00.000Z', durationMinutes: 30 },
      ]),
      { slots, timeZone: TZ, nowIso: '2026-10-18T06:00:00.000Z', language: 'en' },
    );
    expect(intents).toHaveLength(3);
    const [create, window, shift] = intents as Array<Record<string, unknown>>;
    expect(create.type).toBe('create');
    expect(create.task).toMatchObject({
      name: 'Gym',
      scheduledStartTime: '2026-10-18T15:00:00.000Z',
      scheduledEndTime: '2026-10-18T16:00:00.000Z',
      estimatedTimeInMinutes: 60,
    });
    expect(create.summary).toContain('18:00');
    expect(window.command).toMatchObject({
      kind: 'window',
      taskId: 'u',
      clearUnscheduled: true,
      scheduledStartTime: '2026-10-18T07:00:00.000Z',
    });
    expect(shift.command).toMatchObject({
      kind: 'shift',
      taskId: 'flex',
      slotId: 's-flex',
      start: '2026-10-18T11:00:00.000Z',
    });
  });
});
