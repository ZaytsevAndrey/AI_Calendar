import type { GoogleCalendarEvent } from '../../api/google-calendar.api';
import type { HabitDTO } from '../../api/habits.api';
import type { TaskDTO } from '../../api/tasks.api';
import {
  buildNowBlocks,
  canCompleteNowBlock,
  canSkipNowBlock,
  pickNowAndNext,
  todayNowContext,
  unscheduledTasksForToday,
} from './nowBlocks';

const TZ = 'Asia/Nicosia';
const TODAY = '2026-09-10';

function task(partial: Partial<TaskDTO> & Pick<TaskDTO, 'id' | 'name'>): TaskDTO {
  return {
    estimatedTimeInMinutes: 30,
    isRecurring: false,
    allowSplit: true,
    priority: 'medium',
    status: 'todo',
    createdAt: '2026-09-10T06:00:00.000Z',
    updatedAt: '2026-09-10T06:00:00.000Z',
    ...partial,
  };
}

function timed(
  id: string,
  summary: string,
  startIso: string,
  endIso: string,
  extra: Partial<GoogleCalendarEvent> = {},
): GoogleCalendarEvent {
  return {
    id,
    summary,
    start: { dateTime: startIso },
    end: { dateTime: endIso },
    status: 'confirmed',
    isAppGenerated: extra.isAppGenerated,
    recurringEventId: extra.recurringEventId,
    ...extra,
  };
}

describe('todayNowContext', () => {
  it('uses Settings TZ civil days for the Google fetch window', () => {
    const ctx = todayNowContext('2026-09-10T10:00:00+03:00', TZ);
    expect(ctx.todayYmd).toBe(TODAY);
    expect(ctx.fetchTimeMin).toBe('2026-09-09T00:00:00+03:00');
    expect(ctx.fetchTimeMax).toBe('2026-09-11T00:00:00+03:00');
  });
});

describe('pickNowAndNext', () => {
  const nowMs = new Date('2026-09-10T10:15:00+03:00').getTime();
  const todayEndMs = new Date('2026-09-11T00:00:00+03:00').getTime();
  const yesterdayStartMs = new Date('2026-09-09T00:00:00+03:00').getTime();

  it('picks the overlapping timed block as now and the next start as next', () => {
    const blocks = buildNowBlocks(
      [
        timed('a', 'Standup', '2026-09-10T10:00:00+03:00', '2026-09-10T10:30:00+03:00'),
        timed('b', 'Review', '2026-09-10T14:00:00+03:00', '2026-09-10T15:00:00+03:00'),
      ],
      [],
      TODAY,
      TZ,
    );
    const { now, next } = pickNowAndNext(blocks, nowMs, todayEndMs);
    expect(now?.title).toBe('Standup');
    expect(next?.title).toBe('Review');
  });

  it('does not treat a week-old spanning event as Now', () => {
    const blocks = buildNowBlocks(
      [
        timed(
          'stale',
          'Old series',
          '2026-09-01T08:00:00+03:00',
          '2026-09-20T18:00:00+03:00',
        ),
        timed('fresh', 'Focus', '2026-09-10T10:00:00+03:00', '2026-09-10T10:45:00+03:00'),
      ],
      [],
      TODAY,
      TZ,
    );
    const { now } = pickNowAndNext(blocks, nowMs, todayEndMs, yesterdayStartMs);
    expect(now?.title).toBe('Focus');
  });

  it('does not use a recurring task first-occurrence span as Now', () => {
    const gym = task({
      id: 'r1',
      name: 'Gym',
      isRecurring: true,
      scheduledStartTime: '2026-09-01T10:00:00+03:00',
      scheduledEndTime: '2026-09-30T10:45:00+03:00',
    });
    const blocks = buildNowBlocks([], [gym], TODAY, TZ);
    const { now } = pickNowAndNext(blocks, nowMs, todayEndMs, yesterdayStartMs);
    expect(now).toBeNull();
  });

  it('shows a same-day recurring occurrence from task times', () => {
    const gym = task({
      id: 'r1',
      name: 'Gym',
      isRecurring: true,
      scheduledStartTime: '2026-09-10T10:00:00+03:00',
      scheduledEndTime: '2026-09-10T10:45:00+03:00',
    });
    const blocks = buildNowBlocks([], [gym], TODAY, TZ);
    const { now } = pickNowAndNext(blocks, nowMs, todayEndMs, yesterdayStartMs);
    expect(now?.title).toBe('Gym');
    expect(canSkipNowBlock(now!)).toBe(true);
  });

  it('hides a recurring task fallback when that civil day was skipped', () => {
    const gym = task({
      id: 'r1',
      name: 'Gym',
      isRecurring: true,
      scheduledStartTime: '2026-09-10T10:00:00+03:00',
      scheduledEndTime: '2026-09-10T10:45:00+03:00',
      skippedOccurrenceYmds: [TODAY],
    });
    const blocks = buildNowBlocks([], [gym], TODAY, TZ);
    const { now, next } = pickNowAndNext(blocks, nowMs, todayEndMs, yesterdayStartMs);
    expect(now).toBeNull();
    expect(next).toBeNull();
  });

  it('prefers a timed overlap over an all-day event', () => {
    const blocks = buildNowBlocks(
      [
        {
          id: 'off',
          summary: 'Holiday',
          start: { date: TODAY },
          end: { date: '2026-09-11' },
          status: 'confirmed',
        },
        timed('meet', 'Call', '2026-09-10T10:00:00+03:00', '2026-09-10T10:45:00+03:00'),
      ],
      [],
      TODAY,
      TZ,
    );
    const { now } = pickNowAndNext(blocks, nowMs, todayEndMs);
    expect(now?.title).toBe('Call');
    expect(now?.allDay).toBe(false);
  });

  it('does not offer Done on recurring or unmatched Google events', () => {
    const recurring = task({
      id: 'r1',
      name: 'Gym',
      isRecurring: true,
      googleEventId: 'series-1',
    });
    const blocks = buildNowBlocks(
      [
        timed('inst-1', 'Gym', '2026-09-10T10:00:00+03:00', '2026-09-10T10:45:00+03:00', {
          recurringEventId: 'series-1',
          isAppGenerated: true,
        }),
        timed('g-ext', 'Doctor', '2026-09-10T16:00:00+03:00', '2026-09-10T17:00:00+03:00'),
      ],
      [recurring],
      TODAY,
      TZ,
    );
    const { now, next } = pickNowAndNext(blocks, nowMs, todayEndMs);
    expect(now?.task?.id).toBe('r1');
    expect(canCompleteNowBlock(now!)).toBe(false);
    expect(canSkipNowBlock(now!)).toBe(true);
    expect(next?.title).toBe('Doctor');
    expect(canCompleteNowBlock(next!)).toBe(false);
    expect(canSkipNowBlock(next!)).toBe(false);
  });

  it('offers Skip and Done on a movable one-off app block', () => {
    const oneOff = task({
      id: 't1',
      name: 'Write brief',
      googleEventId: 'ev-1',
    });
    const blocks = buildNowBlocks(
      [
        timed('ev-1', 'Write brief', '2026-09-10T10:00:00+03:00', '2026-09-10T10:45:00+03:00', {
          isAppGenerated: true,
        }),
      ],
      [oneOff],
      TODAY,
      TZ,
    );
    const { now } = pickNowAndNext(blocks, nowMs, todayEndMs);
    expect(canCompleteNowBlock(now!)).toBe(true);
    expect(canSkipNowBlock(now!)).toBe(true);
  });

  it('includes slotted habits in Next and offers Done as check-in', () => {
    const habit: HabitDTO = {
      id: 'h1',
      name: 'Run',
      color: '#112233',
      description: null,
      checkedToday: false,
      currentStreak: 0,
      points: 0,
      totalCheckIns: 0,
      checkInDates: [],
      achievements: {},
      newlyUnlocked: [],
      streakTip: null,
      blockStartTime: '14:00',
      blockMinutes: 30,
      googleEventId: null,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    };
    const blocks = buildNowBlocks([], [], TODAY, TZ, [habit]);
    const { next } = pickNowAndNext(blocks, nowMs, todayEndMs);
    expect(next?.title).toBe('Run');
    expect(next?.habit?.habitId).toBe('h1');
    expect(canCompleteNowBlock(next!)).toBe(true);
    expect(canSkipNowBlock(next!)).toBe(false);
  });
});

describe('unscheduledTasksForToday', () => {
  it('lists inbox todos for today by priority and skips placed or out-of-window tasks', () => {
    const inboxHigh = task({ id: 'h', name: 'Write brief', priority: 'high' });
    const inboxLow = task({ id: 'l', name: 'Tidy desk', priority: 'low', createdAt: '2026-09-09T06:00:00.000Z' });
    const placed = task({
      id: 'p',
      name: 'Placed',
      scheduledStartTime: '2026-09-10T11:00:00+03:00',
      scheduledEndTime: '2026-09-10T12:00:00+03:00',
    });
    const laterWindow = task({
      id: 'w',
      name: 'Friday only',
      earliestStartTime: '2026-09-11T00:00:00+03:00',
      deadline: '2026-09-11T23:59:00+03:00',
    });
    const list = unscheduledTasksForToday(
      [inboxLow, laterWindow, placed, inboxHigh],
      new Set(['p']),
      TODAY,
      TZ,
    );
    expect(list.map((item) => item.id)).toEqual(['h', 'l']);
  });

  it('lists inbox unscheduled tasks with flexible tasks still waiting for a slot', () => {
    const waiting = task({ id: 'h', name: 'Write brief', priority: 'high' });
    const inbox = task({ id: 'u', name: 'Buy milk', isUnscheduled: true, priority: 'urgent' });
    const later = task({
      id: 'later',
      name: 'Next month',
      isUnscheduled: true,
      deadline: '2026-10-01T12:00:00+03:00',
    });
    const overdue = task({
      id: 'over',
      name: 'Yesterday',
      isUnscheduled: true,
      priority: 'low',
      deadline: '2026-09-09T12:00:00+03:00',
    });
    const done = task({
      id: 'done',
      name: 'Finished',
      isUnscheduled: true,
      status: 'completed',
    });
    const list = unscheduledTasksForToday(
      [waiting, inbox, later, overdue, done],
      new Set(),
      TODAY,
      TZ,
    );
    expect(list.map((item) => item.id)).toEqual(['u', 'h', 'later', 'over']);
  });

  it('never lists recurring or problematic tasks in the Unscheduled strip', () => {
    const recurring = task({
      id: 'r',
      name: 'Morning series',
      isRecurring: true,
      scheduleState: 'problematic',
      problematicReason: 'no_slot',
    });
    const problematicFlex = task({
      id: 'p',
      name: 'Parked',
      scheduleState: 'problematic',
      problematicReason: 'no_slot',
    });
    const inbox = task({ id: 'u', name: 'Buy milk', isUnscheduled: true, priority: 'urgent' });
    const list = unscheduledTasksForToday([recurring, problematicFlex, inbox], new Set(), TODAY, TZ);
    expect(list.map((item) => item.id)).toEqual(['u']);
  });
});
