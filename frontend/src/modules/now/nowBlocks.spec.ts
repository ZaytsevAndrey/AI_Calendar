import type { GoogleCalendarEvent } from '../../api/google-calendar.api';
import type { TaskDTO } from '../../api/tasks.api';
import {
  buildNowBlocks,
  canCompleteNowBlock,
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
    expect(next?.title).toBe('Doctor');
    expect(canCompleteNowBlock(next!)).toBe(false);
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
});
