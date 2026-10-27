import { intentsFromParseResult } from './voice-agent.intents';
import type { VoiceWriteIntent } from './voice-agent.types';
import { summarizeCreatedTask, summarizeUpdatedTask } from './voice-stored-summary';
import { unappliedIntentLine } from './voice-unapplied';

function command(kind: string, fields: Record<string, unknown>, summary: string): VoiceWriteIntent {
  return { type: 'command', summary, command: { kind, summary, ...fields } };
}

describe('unapplied batch lines', () => {
  it('says a create will not happen and leaves the success summary in the past', () => {
    const mapped = intentsFromParseResult(
      {
        understanding: 'complete',
        clarifyingQuestion: null,
        task: {
          name: 'Молоко',
          estimatedTimeInMinutes: 30,
          isUnscheduled: true,
        } as never,
        command: null,
      },
      { language: 'uk' },
    );
    const intent = mapped.intents[0];
    expect(intent.summary).toBe('Створив задачу «Молоко»: на потім, 30 хв.');
    expect(unappliedIntentLine(intent, 'uk')).toBe(
      'Не буде створено задачу «Молоко»: на потім, 30 хв.',
    );
    expect(summarizeCreatedTask(
      { name: 'Молоко', estimatedTimeInMinutes: 30, isUnscheduled: true },
      'uk',
    )).toBe(intent.summary);
  });

  it('says an update will not happen', () => {
    const success = summarizeUpdatedTask('Звіт', { estimatedTimeInMinutes: 45 }, 'uk');
    const intent = command('update', {
      taskName: 'Звіт',
      patch: { estimatedTimeInMinutes: 45 },
    }, success);
    expect(success).toContain('Оновити');
    expect(unappliedIntentLine(intent, 'uk')).toBe('Не буде оновлено «Звіт»: 45 хв.');
    expect(unappliedIntentLine(intent, 'en')).toBe('Will not update "Звіт": 45 min.');
  });

  it('says a delete will not happen', () => {
    const intent = command('delete', { taskName: 'Звіт' }, 'Видалити «Звіт»?');
    expect(unappliedIntentLine(intent, 'uk')).toBe('Не буде видалено «Звіт».');
    expect(unappliedIntentLine(intent, 'en')).toBe('Will not delete "Звіт".');
    expect(intent.summary).toBe('Видалити «Звіт»?');
  });

  it('says a reminder will not be created, changed, or deleted', () => {
    const created = command('remind_create', {
      name: 'Звіт',
      dueYmd: '2026-10-19',
      notificationTime: '09:00',
    }, 'Нагадування «Звіт» на 2026-10-19 о 09:00.');
    expect(unappliedIntentLine(created, 'uk')).toBe(
      'Не буде створено нагадування «Звіт» на 2026-10-19 о 09:00.',
    );
    expect(unappliedIntentLine(
      command('remind_update', { name: 'Звіт' }, 'Змінити нагадування «Звіт» на 2026-10-19.'),
      'en',
    )).toBe('Will not update reminder "Звіт".');
    expect(unappliedIntentLine(
      command('remind_delete', { name: 'Звіт' }, 'Видалити нагадування «Звіт».'),
      'uk',
    )).toBe('Не буде видалено нагадування «Звіт».');
    expect(unappliedIntentLine(
      command('remind_resolve', { name: 'Звіт' }, 'Зроблено нагадування «Звіт».'),
      'en',
    )).toBe('Will not mark reminder "Звіт" done.');
  });
});
