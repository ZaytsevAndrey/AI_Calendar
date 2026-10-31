import type { GoogleCalendarEvent } from '../../../api/google-calendar.api';
import type { TaskDTO } from '../../../api/tasks.api';
import { motionDestination, motionKeysForEvent, overlayPendingPlacements } from './calendarMotionData';
import { resetMotionForTests, trackMotion, pendingPlacements } from './cardMotion';

const task = (patch: Partial<TaskDTO>): TaskDTO =>
  ({
    id: 't-1',
    name: 'Report',
    status: 'todo',
    priority: 'medium',
    estimatedTimeInMinutes: 60,
    isRecurring: false,
    isUnscheduled: false,
    scheduleState: 'none',
    ...patch,
  }) as TaskDTO;

const event = (patch: Partial<GoogleCalendarEvent>): GoogleCalendarEvent =>
  ({
    id: 'ge-1',
    summary: 'Report',
    start: { dateTime: '2026-10-29T08:00:00.000Z' },
    end: { dateTime: '2026-10-29T09:00:00.000Z' },
    status: 'confirmed',
    ...patch,
  }) as GoogleCalendarEvent;

describe('motionKeysForEvent', () => {
  it('knows a one-off task card by its event and task ids', () => {
    const tasks = [task({ googleEventId: 'ge-1' })];
    expect(motionKeysForEvent(tasks, event({}))).toEqual(['ge-1', 't-1']);
  });

  it('knows a series day by its own id and the series id only', () => {
    const tasks = [task({ googleEventId: 'ge-series', isRecurring: true })];
    const day = event({ id: 'ge-series-3', recurringEventId: 'ge-series' });
    expect(motionKeysForEvent(tasks, day)).toEqual(['ge-series-3', 'ge-series']);
  });

  it('knows a placeholder by the action behind it', () => {
    resetMotionForTests();
    trackMotion({ keys: ['t-7'], kind: 'place', targetMs: 1 });
    const [placement] = pendingPlacements();
    expect(motionKeysForEvent([], event({ id: placement.id }))).toEqual([placement.id, 't-7']);
    resetMotionForTests();
  });
});

describe('motionDestination', () => {
  it('says where the task went', () => {
    const start = '2026-11-03T08:00:00.000Z';
    expect(motionDestination([task({ scheduledStartTime: start })], ['t-1'])).toEqual({
      type: 'date',
      startMs: Date.parse(start),
    });
    expect(motionDestination([task({ scheduleState: 'problematic' })], ['t-1'])).toEqual({ type: 'parked' });
    expect(motionDestination([task({ isUnscheduled: true })], ['t-1'])).toEqual({ type: 'later' });
    expect(motionDestination([task({ status: 'completed' })], ['t-1'])).toEqual({ type: 'gone' });
    expect(motionDestination([], ['t-1'])).toEqual({ type: 'gone' });
  });

  it('finds the task by its Google event id too', () => {
    const tasks = [task({ googleEventId: 'ge-1', scheduleState: 'problematic' })];
    expect(motionDestination(tasks, ['ge-1'])).toEqual({ type: 'parked' });
  });

  it('waits while the scheduler has not picked a slot yet', () => {
    expect(motionDestination([task({})], ['t-1'])).toBeNull();
  });
});

describe('overlayPendingPlacements', () => {
  const slot = Date.parse('2026-10-29T10:00:00.000Z');
  const placement = { id: 'local-motion:1', keys: ['local-motion:1', 't-1'], title: 'Report', startMs: slot, durationMs: 3_600_000 };

  it('stands the task at the picked slot right away', () => {
    const out = overlayPendingPlacements([], [task({ isUnscheduled: true })], [placement]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'local-motion:1', summary: 'Report' });
    expect(out[0].end.dateTime).toBe('2026-10-29T11:00:00.000Z');
  });

  it('moves to where the server seated the task', () => {
    const seated = task({
      scheduledStartTime: '2026-10-29T12:00:00.000Z',
      scheduledEndTime: '2026-10-29T13:00:00.000Z',
    });
    const [card] = overlayPendingPlacements([], [seated], [placement]);
    expect(card.start.dateTime).toBe('2026-10-29T12:00:00.000Z');
  });

  it('steps aside once the real event is there', () => {
    const linked = task({ googleEventId: 'ge-new' });
    expect(overlayPendingPlacements([event({ id: 'ge-new' })], [linked], [placement])).toHaveLength(1);
  });

  it('draws nothing without a slot', () => {
    expect(overlayPendingPlacements([], [task({})], [{ ...placement, startMs: undefined }])).toHaveLength(0);
  });
});
