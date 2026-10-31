/**
 * WP-B: one day of a series, or this day and the following ones, through PATCH /tasks/:id/occurrence.
 * The series scopes the model states map to the endpoint's scopes; what the domain cannot express is
 * refused before a preview (D-03), never approximated.
 */
import type { ProposalGroup } from '../contracts/proposal';
import { TaskStatus, type Task } from '../../../tasks/entities/task.entity';
import { TaskEventType } from '../../../scheduling/event-type.enum';
import type { ScheduledTask } from '../../../schedule/schedule.entity';
import { taskRecord } from '../production/catalog';
import { projectApply } from './project-apply';
import { applyProposalGroup, createStructuredState, sequenceAllocator, type KnownEntity } from './structured-state';

const TZ = 'Europe/Kyiv';
const gym: KnownEntity = {
  entityId: 'task-gym', entityType: 'task', revision: 5, calendarId: 'primary', writable: true, name: 'Gym', recurring: true, seriesEventId: 'master-gym',
  occurrences: [
    { start: '2026-10-21T15:00:00.000Z', end: '2026-10-21T16:00:00.000Z', googleEventId: 'master-gym_20261021T150000Z', slotId: 'slot-21' },
    { start: '2026-10-22T15:00:00.000Z', end: '2026-10-22T16:00:00.000Z', googleEventId: 'master-gym_20261022T150000Z', slotId: 'slot-22' },
  ],
};
const standup: KnownEntity = { ...gym, entityId: 'task-standup', name: 'Standup', seriesEventId: null, seriesCopies: true, occurrences: gym.occurrences!.map((row) => ({ ...row, googleEventId: null })) };
const ENTITIES = [gym, standup];

function operation(overrides: Record<string, unknown>) {
  return {
    localRef: 'a', action: 'update', entityType: 'task', scheduling: 'scheduled', changes: {}, constraints: [], dependsOn: [], known: [], missing: [],
    source: { text: 'test' }, ...overrides,
  };
}
function project(proposals: Record<string, unknown>[], language: 'uk' | 'en' = 'en') {
  const body = { version: '1', control: 'none', proposals, patches: [] } as unknown as ProposalGroup;
  const applied = applyProposalGroup({ state: createStructuredState('s'), group: body, entities: ENTITIES, ids: sequenceAllocator(), expectedSessionVersion: 0 });
  return projectApply({ state: applied.state, timeZone: TZ, catalogEntityIds: ENTITIES.map((row) => row.entityId), language });
}
function first(result: ReturnType<typeof project>) {
  if (!result.ok) throw new Error(`blocked: ${result.code} ${result.detail}`);
  const intent = result.intents[0];
  if (intent.type !== 'command') throw new Error(intent.type);
  return intent as { summary: string; command: Record<string, unknown> };
}
function blocked(result: ReturnType<typeof project>): string {
  if (result.ok) throw new Error(`projected: ${JSON.stringify(result.intents)}`);
  return result.code;
}
const target = (entityId: string) => ({ kind: 'entity', entityId });
const date = (value: string) => ({ localRef: `d-${value}`, kind: 'date', value });
const clock = (value: string, role: 'start' | 'end' = 'start') => ({ localRef: `c-${value}-${role}`, kind: 'clock', value, role });

describe('WP-B — one day of a series', () => {
  it('renames one day through the occurrence endpoint, naming the day and the scope', () => {
    const { summary, command } = first(project([operation({ target: target('task-gym'), seriesScope: 'occurrence', occurrenceDate: '2026-10-21', changes: { title: 'Yoga' } })]));
    expect(command).toEqual({
      kind: 'edit_occurrence', taskId: 'task-gym', taskName: 'Gym', summary, occurrenceStart: '2026-10-21T15:00:00.000Z', scope: 'occurrence',
      name: 'Yoga', googleEventId: 'master-gym_20261021T150000Z', googleEventCalendarId: 'primary', seriesScope: 'occurrence',
    });
    expect(summary).toBe('Rename “Gym” to “Yoga” on 2026-10-21 — this day only');
  });

  it('moves one day to a clock on the same day, with notes and a length', () => {
    const { command } = first(project([operation({
      target: target('task-gym'), seriesScope: 'occurrence', occurrenceDate: '2026-10-21', changes: { notes: 'bring towel' },
      constraints: [date('2026-10-21'), clock('19:00'), { localRef: 'dur', kind: 'duration', minutes: 45 }],
    })]));
    expect(command).toMatchObject({ kind: 'edit_occurrence', scope: 'occurrence', start: '2026-10-21T16:00:00.000Z', durationMinutes: 45, description: 'bring towel' });
    expect(command).not.toHaveProperty('name');
  });

  it('derives the length from a start and an end clock', () => {
    const { command } = first(project([operation({
      target: target('task-gym'), seriesScope: 'occurrence', occurrenceDate: '2026-10-21', constraints: [date('2026-10-21'), clock('19:00'), clock('19:30', 'end')],
    })]));
    expect(command).toMatchObject({ start: '2026-10-21T16:00:00.000Z', durationMinutes: 30 });
  });

  it('completes one day in place instead of clearing it', () => {
    const { summary, command } = first(project([operation({ action: 'complete', target: target('task-gym'), seriesScope: 'occurrence', occurrenceDate: '2026-10-22', changes: { status: 'completed' } })], 'uk'));
    expect(command).toMatchObject({ kind: 'edit_occurrence', scope: 'occurrence', occurrenceStart: '2026-10-22T15:00:00.000Z', status: 'completed' });
    expect(summary).toBe('Позначити виконаним «Gym» за 2026-10-22 — лише цей день');
  });

  it('refuses a day moved to another date, a change the endpoint cannot carry, and completion of the following days', () => {
    expect(blocked(project([operation({ target: target('task-gym'), seriesScope: 'occurrence', occurrenceDate: '2026-10-21', constraints: [date('2026-10-22'), clock('19:00')] })]))).toBe('cross_day_series_move');
    expect(blocked(project([operation({ target: target('task-gym'), seriesScope: 'occurrence', occurrenceDate: '2026-10-21', changes: { priority: 'high' } })]))).toBe('unrepresented_constraint');
    expect(blocked(project([operation({ action: 'complete', target: target('task-gym'), seriesScope: 'from_day', occurrenceDate: '2026-10-21', changes: { status: 'completed' } })]))).toBe('unsupported_series_scope');
    expect(blocked(project([operation({ target: target('task-gym'), seriesScope: 'occurrence', occurrenceDate: '2026-10-25', changes: { title: 'Yoga' } })]))).toBe('occurrence_not_found');
  });
});

describe('WP-B — this day and the following ones', () => {
  it('changes the series from a day on with the following scope', () => {
    const { summary, command } = first(project([operation({
      target: target('task-gym'), seriesScope: 'from_day', occurrenceDate: '2026-10-22', constraints: [date('2026-10-22'), clock('09:00')],
    })]));
    expect(command).toMatchObject({ kind: 'edit_occurrence', scope: 'following', occurrenceStart: '2026-10-22T15:00:00.000Z', start: '2026-10-22T06:00:00.000Z', seriesScope: 'series' });
    expect(summary).toBe('Change “Gym” from 2026-10-22 — this day and following');
  });

  it('a series-wide update still patches the series itself', () => {
    const { command } = first(project([operation({ target: target('task-gym'), seriesScope: 'all', changes: { title: 'Yoga' } })]));
    expect(command).toMatchObject({ kind: 'update', patch: { name: 'Yoga' }, seriesScope: 'all' });
  });
});

describe('WP-B — D-03: a series with detached or parked days', () => {
  it('refuses a series-wide rename, a delete and an end from a day, and says why', () => {
    expect(blocked(project([operation({ target: target('task-standup'), seriesScope: 'all', changes: { title: 'Daily' } })]))).toBe('series_has_copies');
    expect(blocked(project([operation({ action: 'delete', target: target('task-standup'), seriesScope: 'all' })]))).toBe('series_has_copies');
    expect(blocked(project([operation({ action: 'delete', target: target('task-standup'), seriesScope: 'from_day', occurrenceDate: '2026-10-21' })]))).toBe('series_has_copies');
  });

  it('still allows one-day changes, a skip and a per-day move on such a series', () => {
    expect(first(project([operation({ target: target('task-standup'), seriesScope: 'occurrence', occurrenceDate: '2026-10-21', changes: { title: 'Daily' } })])).command.kind).toBe('edit_occurrence');
    expect(first(project([operation({ action: 'skip', target: target('task-standup'), seriesScope: 'occurrence', occurrenceDate: '2026-10-21' })])).command.kind).toBe('skip');
    expect(first(project([operation({ action: 'move', target: target('task-standup'), seriesScope: 'occurrence', occurrenceDate: '2026-10-21', constraints: [date('2026-10-21'), clock('19:00')] })])).command).toMatchObject({ kind: 'move', slotId: 'slot-21' });
  });

  it('a series without copies is not refused', () => {
    expect(first(project([operation({ action: 'delete', target: target('task-gym'), seriesScope: 'all' })])).command.kind).toBe('delete');
  });
});

describe('WP-B — catalog lineage', () => {
  const task = (id: string, extra: Partial<Task> = {}): Task => ({
    id, userId: 'u1', name: id, status: TaskStatus.TODO, isRecurring: false, isUnscheduled: false, googleEventId: null, googleEventCalendarId: null,
    estimatedTimeInMinutes: 60, eventType: TaskEventType.ADMIN, createdAt: new Date('2026-10-01T00:00:00.000Z'), updatedAt: new Date('2026-10-10T00:00:00.000Z'),
    parentSeriesId: null, seriesGroupId: null, problematicOccurrenceYmds: null, ...extra,
  } as unknown as Task);
  const slot = (id: string, taskId: string, start: string): ScheduledTask => ({
    id, taskId, scheduledStartTime: new Date(start), scheduledEndTime: new Date(Date.parse(start) + 3_600_000), googleEventId: null, googleEventCalendarId: null, updatedAt: new Date('2026-10-10T00:00:00.000Z'),
  } as unknown as ScheduledTask);

  it('flags a series whose group holds a detached copy or a parked day; a clean series is not flagged', () => {
    const series = task('series', { isRecurring: true, seriesGroupId: 'grp' });
    const copy = task('copy', { seriesGroupId: 'grp', parentSeriesId: 'series' });
    const slots = [slot('s1', 'series', '2026-10-21T15:00:00.000Z')];
    expect(taskRecord(series, slots, [series, copy]).seriesCopies).toBe(true);
    expect(taskRecord(series, slots, [series])).not.toHaveProperty('seriesCopies');
    expect(taskRecord(task('parked', { isRecurring: true, problematicOccurrenceYmds: ['2026-10-23'] }), [], []).seriesCopies).toBe(true);
    expect(taskRecord(series, slots, [series]).occurrences).toEqual([{ start: '2026-10-21T15:00:00.000Z', end: '2026-10-21T16:00:00.000Z', googleEventId: null, slotId: 's1' }]);
  });
});
