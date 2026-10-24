import {
  resolveDayReminderVoice,
  routeReminderIntent,
  utteranceAsksForReminder,
} from './voice-day-reminder';

const unsubscribe = {
  id: 'r1',
  name: 'Unsubscribe',
  dueYmd: '2026-11-03',
  notificationTime: null,
  description: null,
  recurrencePattern: null,
  recurrenceWeekDays: null,
};

describe('voice day reminders', () => {
  it('treats an explicit remind phrase as a reminder', () => {
    expect(utteranceAsksForReminder('нагадай завтра відписатись')).toBe(true);
    expect(utteranceAsksForReminder('remind me to pay rent')).toBe(true);
    expect(utteranceAsksForReminder('завтра в магазин')).toBe(false);
    expect(
      routeReminderIntent({
        transcript: 'tomorrow to the shop',
        reminders: [unsubscribe],
        taskNames: [],
      }).kind,
    ).toBe('keep');
  });

  it('routes done to the open reminder, and asks when a task has the same name', () => {
    expect(
      routeReminderIntent({
        transcript: 'done with Unsubscribe',
        reminders: [unsubscribe],
        taskNames: ['Milk'],
      }).kind,
    ).toBe('remind');
    expect(
      routeReminderIntent({
        transcript: 'done with Unsubscribe',
        reminders: [unsubscribe],
        taskNames: ['Unsubscribe'],
      }).kind,
    ).toBe('clarify');
  });

  it('creates a reminder from a day and an optional clock', () => {
    const created = resolveDayReminderVoice({
      raw: {
        action: 'create',
        name: 'Pay rent',
        dueYmd: '2026-11-01',
        notificationTime: '18:30',
        recurrencePattern: 'MONTHLY',
      },
      reminders: [],
      taskNames: [],
      language: 'en',
    });
    expect(created).toEqual({
      type: 'command',
      command: expect.objectContaining({
        kind: 'remind_create',
        name: 'Pay rent',
        dueYmd: '2026-11-01',
        notificationTime: '18:30',
        recurrencePattern: 'MONTHLY',
      }),
    });
  });

  it('asks for a day instead of inventing one', () => {
    const missing = resolveDayReminderVoice({
      raw: { action: 'create', name: 'Pay rent' },
      reminders: [],
      taskNames: [],
      language: 'uk',
    });
    expect(missing).toEqual({
      type: 'clarify',
      question: 'На який день це нагадування?',
    });
  });

  it('resolves one matching reminder', () => {
    const done = resolveDayReminderVoice({
      raw: { action: 'resolve', targetName: 'Unsubscribe' },
      reminders: [unsubscribe],
      taskNames: [],
      language: 'en',
    });
    expect(done).toEqual({
      type: 'command',
      command: expect.objectContaining({
        kind: 'remind_resolve',
        reminderId: 'r1',
        name: 'Unsubscribe',
      }),
    });
  });
});
