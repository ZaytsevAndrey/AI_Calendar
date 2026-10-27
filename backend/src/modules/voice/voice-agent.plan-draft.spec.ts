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
import type { DayPlanProposal, PlanDraft } from './voice-agent.types';

function draftAfter(
  draft: PlanDraft,
  edits: Parameters<typeof applyPlanEdits>[1],
  context: PlanDraftContext,
): PlanDraft {
  return applyPlanEdits(draft, edits, context).draft;
}

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
  it('drops unknown rows and rejects an unusable length instead of defaulting it', () => {
    expect(
      parsePlanEdits([
        { op: 'add_task', name: ' Gym ', durationMinutes: 2, earliestHm: '9:30' },
        { op: 'set_duration', itemId: 'a', minutes: 3 },
        { op: 'set_window', itemId: 'a', deadlineHm: '18:00' },
        { op: 'set_order', itemIds: ['b', '', 'a'] },
        { op: 'include_task' },
        null,
      ]),
    ).toEqual({
      edits: [
        { op: 'set_window', itemId: 'a', deadlineHm: '18:00' },
        { op: 'set_order', itemIds: ['b', 'a'] },
      ],
      skipped: [
        { reason: 'invalid_duration' },
        { reason: 'invalid_duration' },
        { reason: 'invalid_edit', cause: 'missing_task_id' },
        { reason: 'invalid_edit', cause: 'not_an_object' },
      ],
    });
    expect(parsePlanEdits(undefined)).toEqual({ edits: [], skipped: [] });
    expect(parsePlanEdits('nope')).toEqual({
      edits: [],
      skipped: [{ reason: 'invalid_edit', cause: 'not_an_array' }],
    });
  });

  it('keeps a cause for each row that is not an applicable edit', () => {
    const parsed = parsePlanEdits([
      { op: 'bogus' },
      {},
      { op: 'add_task', name: '   ' },
      { op: 'include_task', taskId: '' },
      { op: 'remove_item' },
      { op: 'set_preferred_start', itemId: 'a' },
      { op: 'set_preferred_start', itemId: 'a', hm: null },
      { op: 'set_window', itemId: 'a' },
      { op: 'set_duration', itemId: 'a' },
      { op: 'set_order' },
      { op: 'set_order', itemIds: ['', '  '] },
      { op: 'remove_item', itemId: 'a' },
    ]);
    expect(parsed.edits).toEqual([
      { op: 'set_preferred_start', itemId: 'a', hm: null },
      { op: 'remove_item', itemId: 'a' },
    ]);
    expect(parsed.skipped).toEqual([
      { reason: 'invalid_edit', cause: 'unknown_op' },
      { reason: 'invalid_edit', cause: 'unknown_op' },
      { reason: 'invalid_edit', cause: 'missing_name' },
      { reason: 'invalid_edit', cause: 'missing_task_id' },
      { reason: 'invalid_edit', cause: 'missing_item_id' },
      { reason: 'invalid_edit', cause: 'missing_item_ids' },
      { reason: 'invalid_edit', cause: 'missing_item_ids' },
    ]);
  });

  it('keeps the four states of a preferred start apart', () => {
    expect(
      parsePlanEdits([
        { op: 'set_preferred_start', itemId: 'a' },
        { op: 'set_preferred_start', itemId: 'b', hm: '9:30' },
        { op: 'set_preferred_start', itemId: 'c', hm: null },
        { op: 'set_preferred_start', itemId: 'd', hm: '25:00' },
        { op: 'set_preferred_start', itemId: 'd', hm: '24:00' },
        { op: 'set_preferred_start', itemId: 'd', hm: '23:60' },
        { op: 'set_preferred_start', itemId: 'd', hm: '18:00:00' },
        { op: 'set_preferred_start', itemId: 'e', hm: '00:00' },
        { op: 'set_preferred_start', itemId: 'f', hm: '23:59' },
      ]),
    ).toEqual({
      edits: [
        { op: 'set_preferred_start', itemId: 'b', hm: '09:30' },
        { op: 'set_preferred_start', itemId: 'c', hm: null },
        { op: 'set_preferred_start', itemId: 'e', hm: '00:00' },
        { op: 'set_preferred_start', itemId: 'f', hm: '23:59' },
      ],
      skipped: [
        { reason: 'invalid_time' },
        { reason: 'invalid_time' },
        { reason: 'invalid_time' },
        { reason: 'invalid_time' },
      ],
    });
  });

  it('keeps the four states of a window bound apart', () => {
    expect(
      parsePlanEdits([
        { op: 'set_window', itemId: 'missing-bound', deadlineHm: '17:00' },
        { op: 'set_window', itemId: 'clear', earliestHm: null, deadlineHm: '18:00' },
        { op: 'set_window', itemId: 'valid', earliestHm: '8:00', deadlineHm: '12:00' },
        { op: 'set_window', itemId: 'bad', earliestHm: '25:00', deadlineHm: '18:00' },
      ]),
    ).toEqual({
      edits: [
        { op: 'set_window', itemId: 'missing-bound', deadlineHm: '17:00' },
        { op: 'set_window', itemId: 'clear', earliestHm: null, deadlineHm: '18:00' },
        { op: 'set_window', itemId: 'valid', earliestHm: '08:00', deadlineHm: '12:00' },
        { op: 'set_window', itemId: 'bad', deadlineHm: '18:00' },
      ],
      skipped: [{ reason: 'invalid_time' }],
    });
  });

  it('uses the default length only when add_task omits it', () => {
    const omitted = parsePlanEdits([{ op: 'add_task', name: 'Gym' }]);
    const cleared = parsePlanEdits([{ op: 'add_task', name: 'Call', durationMinutes: null }]);
    const given = parsePlanEdits([{ op: 'add_task', name: 'Read', durationMinutes: 15 }]);
    const bad = parsePlanEdits([
      { op: 'add_task', name: 'Nope', durationMinutes: 2 },
      { op: 'add_task', name: 'Text', durationMinutes: 'nope' },
      { op: 'add_task', name: 'Zero', durationMinutes: 0 },
    ]);
    expect(omitted).toMatchObject({
      edits: [{ durationMinutes: null }],
      skipped: [],
    });
    expect(cleared.edits[0]).toMatchObject({ durationMinutes: null });
    expect(cleared.skipped).toEqual([]);
    expect(given.edits[0]).toMatchObject({ durationMinutes: 15 });
    expect(bad.edits).toEqual([]);
    expect(bad.skipped).toEqual([
      { reason: 'invalid_duration' },
      { reason: 'invalid_duration' },
      { reason: 'invalid_duration' },
    ]);
  });

  it('keeps the four states of set_duration apart', () => {
    expect(
      parsePlanEdits([
        { op: 'set_duration', itemId: 'a' },
        { op: 'set_duration', itemId: 'a', minutes: 20 },
        { op: 'set_duration', itemId: 'a', minutes: null },
        { op: 'set_duration', itemId: 'a', minutes: 'nope' },
      ]),
    ).toEqual({
      edits: [{ op: 'set_duration', itemId: 'a', minutes: 20 }],
      skipped: [{ reason: 'invalid_duration' }, { reason: 'invalid_duration' }],
    });
  });

  it('skips a new task whose clock is not a real time', () => {
    const parsed = parsePlanEdits([
      { op: 'add_task', name: 'Gym', preferredHm: '25:00', durationMinutes: 60 },
      { op: 'add_task', name: 'Call', preferredHm: null, earliestHm: '10:00' },
      { op: 'add_task', name: 'Mail' },
      { op: 'add_task', name: 'Both', preferredHm: '09:00', deadlineHm: '18:00:00' },
    ]);
    expect(parsed.edits.map((edit) => (edit.op === 'add_task' ? edit.name : edit.op))).toEqual([
      'Call',
      'Mail',
    ]);
    expect(parsed.edits[0]).toMatchObject({ preferredHm: null, earliestHm: '10:00' });
    expect(parsed.edits[1]).toMatchObject({
      preferredHm: null,
      earliestHm: null,
      deadlineHm: null,
      durationMinutes: null,
    });
    expect(parsed.skipped).toEqual([{ reason: 'invalid_time' }, { reason: 'invalid_time' }]);
  });
});

describe('applyPlanEdits', () => {
  const base = () =>
    initialPlanDraft(DAY, ctx([task('a', { isUnscheduled: true }), task('b', { isUnscheduled: true })]));

  it('adds new tasks with sequential ids and the default duration', () => {
    const c = ctx([]);
    const next = draftAfter(
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
    const next = draftAfter(
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
    expect(draftAfter(next, [{ op: 'remove_item', itemId: 'a' }], ctx([])).items.map((i) => i.id)).toEqual(['b']);
  });

  it('applies the valid edits and leaves previous clocks when a sibling is rejected', () => {
    const c = ctx([]);
    const draft = draftAfter(
      base(),
      [
        { op: 'set_preferred_start', itemId: 'a', hm: '09:00' },
        { op: 'set_window', itemId: 'a', earliestHm: '08:00', deadlineHm: '12:00' },
      ],
      c,
    );
    const parsed = parsePlanEdits([
      { op: 'set_preferred_start', itemId: 'a', hm: '25:00' },
      { op: 'set_window', itemId: 'a', earliestHm: '24:00', deadlineHm: '18:00' },
      { op: 'add_task', name: 'Gym', preferredHm: '18:00:00' },
      { op: 'add_task', name: 'Call', preferredHm: '10:00' },
      { op: 'remove_item', itemId: 'b' },
      { op: 'set_duration', itemId: 'a', minutes: 2 },
    ]);
    const next = draftAfter(draft, parsed.edits, c);
    expect(parsed.skipped).toEqual([
      { reason: 'invalid_time' },
      { reason: 'invalid_time' },
      { reason: 'invalid_time' },
      { reason: 'invalid_duration' },
    ]);
    expect(next.items.map((item) => item.id)).toEqual(['a', 'new:1']);
    expect(next.items[0]).toMatchObject({
      preferredHm: '09:00',
      earliestHm: '08:00',
      deadlineHm: '18:00',
      durationMinutes: 30,
    });
    expect(next.items[1]).toMatchObject({ name: 'Call', durationMinutes: 45, preferredHm: '10:00' });
    expect(draft.items[0]).toMatchObject({ preferredHm: '09:00', earliestHm: '08:00', deadlineHm: '12:00' });
  });

  it('uses the default length for an omitted add_task duration and not for a bad one', () => {
    const c = ctx([]);
    const omitted = draftAfter(base(), parsePlanEdits([{ op: 'add_task', name: 'Gym' }]).edits, c);
    const bad = draftAfter(
      base(),
      parsePlanEdits([{ op: 'add_task', name: 'Nope', durationMinutes: 2 }]).edits,
      c,
    );
    expect(omitted.items.at(-1)).toMatchObject({ name: 'Gym', durationMinutes: 45 });
    expect(bad.items.map((item) => item.name)).toEqual(['a', 'b']);
  });

  it('drops a preferred start outside a new window', () => {
    const draft = draftAfter(base(), [{ op: 'set_preferred_start', itemId: 'a', hm: '09:00' }], ctx([]));
    const next = draftAfter(draft, [{ op: 'set_window', itemId: 'a', earliestHm: '14:00' }], ctx([]));
    expect(next.items[0]).toMatchObject({ earliestHm: '14:00', preferredHm: null });
  });

  it('includes an existing task once and ignores fixed ones', () => {
    const tasks = [task('a', { isUnscheduled: true }), task('x', { isUnscheduled: true }), task('f', { eventType: TaskEventType.FIXED })];
    const draft = initialPlanDraft(DAY, { ...ctx(tasks), tasks: [tasks[0]] });
    const next = draftAfter(
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

  it('fits an add that follows a remove and rejects an add that comes first', () => {
    const c = ctx([]);
    const full = fillDraft(16);
    const removedFirst = applyPlanEdits(
      full,
      [
        { op: 'remove_item', itemId: 'b' },
        {
          op: 'add_task',
          name: 'Gym',
          durationMinutes: 30,
          preferredHm: null,
          earliestHm: null,
          deadlineHm: null,
        },
      ],
      c,
    );
    expect(removedFirst.skipped).toEqual([]);
    expect(removedFirst.draft.items).toHaveLength(16);
    expect(removedFirst.draft.items.some((item) => item.name === 'Gym')).toBe(true);
    expect(removedFirst.draft.items.some((item) => item.id === 'b')).toBe(false);

    const addedFirst = applyPlanEdits(
      full,
      [
        {
          op: 'add_task',
          name: 'Gym',
          durationMinutes: 30,
          preferredHm: null,
          earliestHm: null,
          deadlineHm: null,
        },
        { op: 'remove_item', itemId: 'b' },
      ],
      c,
    );
    expect(addedFirst.skipped).toEqual([{ reason: 'plan_full' }]);
    expect(addedFirst.draft.items).toHaveLength(15);
    expect(addedFirst.draft.items.some((item) => item.name === 'Gym')).toBe(false);
    expect(addedFirst.draft.items.some((item) => item.id === 'b')).toBe(false);
  });

  it('rejects a new add on a draft that already started past 16 and ignores a repeat include', () => {
    const tasks = Array.from({ length: 17 }, (_, index) => task(`f${index}`));
    const slots = tasks.map((row, index) => slot(`s${index}`, row.id, '2026-10-18T10:00:00.000Z'));
    const draft = initialPlanDraft(DAY, ctx(tasks, slots));
    expect(draft.items).toHaveLength(17);
    const extra = task('extra');
    const fixed = task('fixed', { eventType: TaskEventType.FIXED });
    const applied = applyPlanEdits(
      draft,
      [
        {
          op: 'add_task',
          name: 'Gym',
          durationMinutes: 30,
          preferredHm: null,
          earliestHm: null,
          deadlineHm: null,
        },
        { op: 'include_task', taskId: 'extra' },
        { op: 'include_task', taskId: 'f0' },
        { op: 'include_task', taskId: 'fixed' },
      ],
      ctx([...tasks, extra, fixed], slots),
    );
    expect(applied.draft.items).toHaveLength(17);
    expect(applied.skipped).toEqual([{ reason: 'plan_full' }, { reason: 'plan_full' }]);
  });
});

function fillDraft(count: number): PlanDraft {
  const start = initialPlanDraft(
    DAY,
    ctx([task('a', { isUnscheduled: true }), task('b', { isUnscheduled: true })]),
  );
  const adds = Array.from({ length: count - start.items.length }, (_, index) => ({
    op: 'add_task' as const,
    name: `n${index}`,
    durationMinutes: 30,
    preferredHm: null,
    earliestHm: null,
    deadlineHm: null,
  }));
  return applyPlanEdits(start, adds, ctx([])).draft;
}

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
