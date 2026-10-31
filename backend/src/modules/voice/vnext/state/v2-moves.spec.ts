/**
 * V2: moves and edits against the integrated Scheduling APIs (VC-02, VC-03, VC-04, VC-09, VC-10).
 * Projection only: the server never writes; the client applies the intents.
 */
import type { ProposalGroup } from '../contracts/proposal';
import { projectApply } from './project-apply';
import { fingerprintsForOperations } from './revalidate-preview';
import {
  applyProposalGroup,
  createStructuredState,
  sequenceAllocator,
  type KnownEntity,
} from './structured-state';

const TZ = 'Europe/Kyiv';
// 2026-10-21 is after the DST end (25 Oct is the switch): Kyiv is UTC+3 on 21 Oct, UTC+2 on 27 Oct.
const later: KnownEntity = { entityId: 'task-later', entityType: 'task', revision: 1, calendarId: null, writable: true, name: 'Call bank', unscheduled: true };
const flexible: KnownEntity = {
  entityId: 'task-flex', entityType: 'task', revision: 2, calendarId: null, writable: true, name: 'Report',
  scheduledStart: '2026-10-21T07:00:00.000Z', scheduledEnd: '2026-10-21T07:15:00.000Z', slotId: 'slot-flex',
};
const fixed: KnownEntity = {
  entityId: 'task-fixed', entityType: 'task', revision: 3, calendarId: 'primary', writable: true, name: 'Dentist', fixed: true,
  scheduledStart: '2026-10-21T09:00:00.000Z', scheduledEnd: '2026-10-21T09:45:00.000Z', slotId: 'slot-fixed', googleEventId: 'g-fixed',
};
const fixedNoSlot: KnownEntity = { entityId: 'task-fixed-noslot', entityType: 'task', revision: 1, calendarId: null, writable: true, name: 'Ghost', fixed: true };
const series: KnownEntity = {
  entityId: 'task-gym', entityType: 'task', revision: 5, calendarId: null, writable: true, name: 'Gym', recurring: true, seriesEventId: null,
  occurrences: [
    { start: '2026-10-21T15:00:00.000Z', end: '2026-10-21T16:00:00.000Z', googleEventId: null, slotId: 'slot-gym-21' },
    { start: '2026-10-22T15:00:00.000Z', end: '2026-10-22T16:00:00.000Z', googleEventId: null, slotId: 'slot-gym-22' },
  ],
};
const ENTITIES = [later, flexible, fixed, fixedNoSlot, series];

function operation(overrides: Record<string, unknown>) {
  return {
    localRef: 'a',
    action: 'move',
    entityType: 'task',
    scheduling: 'scheduled',
    changes: {},
    constraints: [],
    dependsOn: [],
    known: [],
    missing: [],
    source: { text: 'test' },
    ...overrides,
  };
}

function project(proposals: Record<string, unknown>[], defaultDurationMinutes = 30) {
  const body = { version: '1', control: 'none', proposals, patches: [] } as unknown as ProposalGroup;
  const applied = applyProposalGroup({ state: createStructuredState('s'), group: body, entities: ENTITIES, ids: sequenceAllocator(), expectedSessionVersion: 0 });
  return projectApply({ state: applied.state, timeZone: TZ, catalogEntityIds: ENTITIES.map((row) => row.entityId), defaultDurationMinutes, language: 'en' });
}

function command(result: ReturnType<typeof project>) {
  if (!result.ok) throw new Error(`blocked: ${result.code} ${result.detail}`);
  const intent = result.intents[0];
  if (intent.type !== 'command') throw new Error(intent.type);
  return intent.command as Record<string, unknown>;
}

const target = (entityId: string) => ({ kind: 'entity', entityId });
const date = (value: string) => ({ localRef: `d-${value}`, kind: 'date', value });
const clock = (value: string, role: 'start' | 'end' = 'start') => ({ localRef: `c-${value}-${role}`, kind: 'clock', value, role });

describe('V2 — VC-02: scheduling a Later task by voice', () => {
  it('a Later task moved to a day becomes a window patch that leaves the inbox', () => {
    const patch = command(project([operation({ target: target('task-later'), constraints: [date('2026-10-22')] })]));
    expect(patch.kind).toBe('update');
    expect(patch.patch).toMatchObject({ isUnscheduled: false, earliestStartTime: expect.any(String), deadline: expect.any(String) });
  });

  it('a Later task moved to a clock becomes a scheduled patch, not a slot move', () => {
    const patch = command(project([operation({ target: target('task-later'), constraints: [date('2026-10-22'), clock('15:00')] })]));
    expect(patch.kind).toBe('update');
    expect(patch.patch).toEqual({ isUnscheduled: false, scheduledStartTime: '2026-10-22T12:00:00.000Z' });
  });

  it('an update of a Later task with a day leaves the inbox; a rename alone does not', () => {
    const dated = command(project([operation({ action: 'update', target: target('task-later'), constraints: [date('2026-10-22')] })]));
    expect(dated.patch).toMatchObject({ isUnscheduled: false });
    const renamed = command(project([operation({ action: 'update', target: target('task-later'), changes: { title: 'Call the bank' } })]));
    expect(renamed.patch).toEqual({ name: 'Call the bank' });
  });

  it('a scheduled task keeps no isUnscheduled key in its patch', () => {
    const patch = command(project([operation({ action: 'update', target: target('task-flex'), constraints: [date('2026-10-22')] })]));
    expect(patch.patch).not.toHaveProperty('isUnscheduled');
  });
});

describe('V2 — VC-03: moves without a Google identity', () => {
  it('a one-off slot without a calendar event moves through its slot id', () => {
    const move = command(project([operation({ target: target('task-flex'), constraints: [date('2026-10-21'), clock('12:00')] })]));
    expect(move).toMatchObject({
      kind: 'move',
      slotId: 'slot-flex',
      googleEventId: null,
      originalStart: '2026-10-21T07:00:00.000Z',
      originalEnd: '2026-10-21T07:15:00.000Z',
      start: '2026-10-21T09:00:00.000Z',
    });
  });

  it('a fixed task with a calendar event still carries both ids', () => {
    const move = command(project([operation({ target: target('task-fixed'), constraints: [date('2026-10-21'), clock('12:00')] })]));
    expect(move).toMatchObject({ kind: 'move', slotId: 'slot-fixed', googleEventId: 'g-fixed' });
  });

  it('a series occurrence without calendar ids moves through its slot id with the occurrence scope', () => {
    const move = command(project([operation({
      target: target('task-gym'), seriesScope: 'occurrence', occurrenceDate: '2026-10-21', constraints: [date('2026-10-21'), clock('19:00')],
    })]));
    expect(move).toMatchObject({ kind: 'move', slotId: 'slot-gym-21', googleEventId: null, recurringEventId: null, seriesScope: 'occurrence', originalStart: '2026-10-21T15:00:00.000Z' });
  });

  it('a task with neither a slot nor a calendar event cannot be moved to a clock', () => {
    const result = project([operation({ target: target('task-fixed-noslot'), constraints: [date('2026-10-21'), clock('12:00')] })]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('unrepresentable_move');
  });

  it('confirm revalidation of a slot move does not demand a calendar event id', () => {
    const body = { version: '1', control: 'none', proposals: [operation({ target: target('task-flex'), constraints: [date('2026-10-21'), clock('12:00')] })], patches: [] } as unknown as ProposalGroup;
    const applied = applyProposalGroup({ state: createStructuredState('s'), group: body, entities: ENTITIES, ids: sequenceAllocator(), expectedSessionVersion: 0 });
    const fingerprints = fingerprintsForOperations(applied.state.operations, [{ entityId: 'task-flex', revision: 2, calendarId: null, writable: true, userId: 'u1' }]);
    expect(fingerprints['task-flex'].requiresMoveIdentity).toBe(false);
    const withEvent = fingerprintsForOperations(
      applyProposalGroup({
        state: createStructuredState('s2'),
        group: { ...body, proposals: [operation({ target: target('task-fixed'), constraints: [date('2026-10-21'), clock('12:00')] })] } as unknown as ProposalGroup,
        entities: ENTITIES, ids: sequenceAllocator(), expectedSessionVersion: 0,
      }).state.operations,
      [{ entityId: 'task-fixed', revision: 3, calendarId: 'primary', writable: true, userId: 'u1', googleEventId: 'g-fixed' }],
    );
    expect(withEvent['task-fixed'].requiresMoveIdentity).toBe(true);
  });
});

describe('V2 — VC-04: a series occurrence stays on its day', () => {
  it('refuses a move of one occurrence to another day before any preview', () => {
    const result = project([operation({
      target: target('task-gym'), seriesScope: 'occurrence', occurrenceDate: '2026-10-21', constraints: [date('2026-10-22'), clock('19:00')],
    })]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('cross_day_series_move');
  });

  it('allows a same-day clock change of the occurrence', () => {
    const move = command(project([operation({
      target: target('task-gym'), seriesScope: 'from_day', occurrenceDate: '2026-10-22', constraints: [date('2026-10-22'), clock('19:00')],
    })]));
    expect(move).toMatchObject({ kind: 'move', slotId: 'slot-gym-22', seriesScope: 'series', start: '2026-10-22T16:00:00.000Z' });
  });
});

describe('V2 — VC-09: skip of a one-off task', () => {
  it('skips the one slot of a flexible task', () => {
    const skip = command(project([operation({ action: 'skip', target: target('task-flex') })]));
    expect(skip).toEqual({
      kind: 'skip', taskId: 'task-flex', taskName: 'Report', summary: expect.any(String),
      occurrenceStart: '2026-10-21T07:00:00.000Z', googleEventId: null, googleEventCalendarId: null,
    });
  });

  it('refuses to skip a fixed one-off and a task without a slot', () => {
    const fixedSkip = project([operation({ action: 'skip', target: target('task-fixed') })]);
    expect(fixedSkip.ok).toBe(false);
    if (!fixedSkip.ok) expect(fixedSkip.code).toBe('fixed_skip');
    const laterSkip = project([operation({ action: 'skip', target: target('task-later') })]);
    expect(laterSkip.ok).toBe(false);
    if (!laterSkip.ok) expect(laterSkip.code).toBe('nothing_to_skip');
  });
});

describe('V2 — VC-10: fixed-task edge cases', () => {
  it('a date-only update of a fixed task keeps its stored clock and length', () => {
    const patch = command(project([operation({ action: 'update', target: target('task-fixed'), constraints: [date('2026-10-22')] })]));
    // 09:00Z on 21 Oct is 12:00 Kyiv; the same local clock on 22 Oct, 45 minutes long.
    expect(patch.patch).toEqual({ scheduledStartTime: '2026-10-22T09:00:00.000Z', scheduledEndTime: '2026-10-22T09:45:00.000Z' });
  });

  it('a start without an end on a fixed task derives the end from the stored length', () => {
    const patch = command(project([operation({ action: 'update', target: target('task-fixed'), constraints: [date('2026-10-21'), clock('14:00')] })]));
    expect(patch.patch).toEqual({ scheduledStartTime: '2026-10-21T11:00:00.000Z', scheduledEndTime: '2026-10-21T11:45:00.000Z' });
  });

  it('a move never grows a task to the default duration', () => {
    const move = command(project([operation({ target: target('task-flex'), constraints: [date('2026-10-21'), clock('12:00')] })], 30));
    expect(move.end).toBe('2026-10-21T09:15:00.000Z');
  });

  it('clearing notes reaches the patch as description null', () => {
    const patch = command(project([operation({ action: 'update', target: target('task-flex'), changes: { notes: null } })]));
    expect(patch.patch).toEqual({ description: null });
  });
});
