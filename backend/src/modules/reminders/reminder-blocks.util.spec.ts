import { buildTimedReminderBlocks } from './reminder-blocks.util';

const NOW = Date.parse('2026-09-22T09:40:00.000Z');
const START = Date.parse('2026-09-22T10:00:00.000Z');

describe('buildTimedReminderBlocks', () => {
  it('includes a timed Google event that starts within 30 minutes', () => {
    const blocks = buildTimedReminderBlocks({
      nowMs: NOW,
      events: [
        {
          id: 'evt-1',
          summary: 'Standup',
          start: { dateTime: new Date(START).toISOString() },
        },
      ],
      tasks: [],
    });
    expect(blocks).toEqual([{ key: 'event:evt-1', title: 'Standup', startMs: START }]);
  });

  it('skips all-day, cancelled, and far-away events', () => {
    const blocks = buildTimedReminderBlocks({
      nowMs: NOW,
      events: [
        { id: 'all', summary: 'Holiday', start: { date: '2026-09-22' } },
        {
          id: 'gone',
          summary: 'Cancelled',
          status: 'cancelled',
          start: { dateTime: new Date(START).toISOString() },
        },
        {
          id: 'later',
          summary: 'Later',
          start: { dateTime: new Date(NOW + 31 * 60_000).toISOString() },
        },
      ],
      tasks: [],
    });
    expect(blocks).toEqual([]);
  });

  it('skips a local task already covered by its Google event', () => {
    const blocks = buildTimedReminderBlocks({
      nowMs: NOW,
      events: [
        {
          id: 'instance',
          recurringEventId: 'series',
          summary: 'Focus',
          start: { dateTime: new Date(START).toISOString() },
        },
      ],
      tasks: [
        {
          id: 'task-1',
          name: 'Focus',
          status: 'todo',
          googleEventId: 'series',
          scheduledStartTime: new Date(START),
          scheduledEndTime: new Date(START + 30 * 60_000),
        },
      ],
    });
    expect(blocks.map((block) => block.key)).toEqual(['event:instance']);
  });

  it('keeps a local timed task that is not on Google', () => {
    const blocks = buildTimedReminderBlocks({
      nowMs: NOW,
      events: [],
      tasks: [
        {
          id: 'task-1',
          name: 'Write',
          status: 'todo',
          scheduledStartTime: new Date(START),
          scheduledEndTime: new Date(START + 30 * 60_000),
        },
        {
          id: 'inbox',
          name: 'Inbox',
          status: 'todo',
          isUnscheduled: true,
          scheduledStartTime: new Date(START),
          scheduledEndTime: new Date(START + 30 * 60_000),
        },
        {
          id: 'done',
          name: 'Done',
          status: 'completed',
          scheduledStartTime: new Date(START),
          scheduledEndTime: new Date(START + 30 * 60_000),
        },
        {
          id: 'span',
          name: 'Series',
          status: 'todo',
          scheduledStartTime: new Date(START),
          scheduledEndTime: new Date(START + 37 * 60 * 60 * 1000),
        },
      ],
    });
    expect(blocks).toEqual([{ key: 'task:task-1', title: 'Write', startMs: START }]);
  });
});
