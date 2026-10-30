import type { GoogleCalendarEvent } from '../../../api/google-calendar.api';
import type { TaskDTO } from '../../../api/tasks.api';
import { motionDestination, motionKeysForEvent, overlayPendingCreates } from './calendarMotionData';

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

  it('knows a placeholder by the task it stands for', () => {
    expect(motionKeysForEvent([], event({ id: 'local-task:t-7' }))).toEqual(['local-task:t-7', 't-7']);
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

describe('overlayPendingCreates', () => {
  const fixed = task({
    id: 'temp-1',
    scheduledStartTime: '2026-10-29T10:00:00.000Z',
    scheduledEndTime: '2026-10-29T11:00:00.000Z',
  });

  it('stands a fixed task being created on the grid', () => {
    const out = overlayPendingCreates([], [fixed], () => true);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('local-task:temp-1');
  });

  it('steps aside once the real event is there or the create is over', () => {
    const real = task({ ...fixed, googleEventId: 'ge-new' });
    expect(overlayPendingCreates([event({ id: 'ge-new' })], [real], () => true)).toHaveLength(1);
    expect(overlayPendingCreates([], [fixed], () => false)).toHaveLength(0);
  });

  it('skips tasks without a clock', () => {
    expect(overlayPendingCreates([], [task({ id: 'temp-2' })], () => true)).toHaveLength(0);
  });
});
