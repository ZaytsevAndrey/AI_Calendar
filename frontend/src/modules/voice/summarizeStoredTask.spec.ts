import i18n from 'i18n';
import { describeStoredTask, summarizeCreatedTask } from './summarizeStoredTask';

describe('summarizeStoredTask', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('uk');
  });

  it('names the task, the day, and the stored length', () => {
    const line = summarizeCreatedTask(
      {
        name: 'Milk',
        estimatedTimeInMinutes: 30,
        earliestStartTime: '2026-09-08T00:00:00+03:00',
      },
      {
        timeZone: 'Europe/Kyiv',
        nowIso: '2026-09-07T12:00:00.000Z',
      },
    );
    expect(line).toBe('Створив задачу «Milk»: на завтра, 30 хв.');
  });

  it('names a fixed seat and skips the default priority', () => {
    const line = summarizeCreatedTask(
      {
        name: 'Звіт',
        eventType: 'fixed',
        priority: 'medium',
        estimatedTimeInMinutes: 60,
        scheduledStartTime: '2026-09-08T15:00:00+03:00',
        scheduledEndTime: '2026-09-08T16:00:00+03:00',
      },
      {
        timeZone: 'Europe/Kyiv',
        nowIso: '2026-09-07T12:00:00.000Z',
      },
    );
    expect(line).toBe('Створив задачу «Звіт»: на завтра, 15:00–16:00, 60 хв, фіксована.');
  });

  it('lists only the fields an update stored', () => {
    const line = describeStoredTask(
      { estimatedTimeInMinutes: 45, deadline: null },
      { mentionDefaults: true, mentionClears: true },
    );
    expect(line).toBe('45 хв, прибрано дедлайн');
  });
});
