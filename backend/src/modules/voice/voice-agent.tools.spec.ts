import { VoiceAgentTools, type VoiceToolContext } from './voice-agent.tools';
import { resolveScheduleDayYmd, scheduleTodayYmd } from './voice-local-date.util';

const NOW = '2026-10-18T06:00:00.000Z';
const TZ = 'Europe/Kyiv';
const TODAY = '2026-10-18';

describe('resolveScheduleDayYmd', () => {
  it('keeps a blank day as today and rejects a date that is not real', () => {
    expect(resolveScheduleDayYmd('', TODAY)).toEqual({ day: TODAY });
    expect(resolveScheduleDayYmd('   ', TODAY)).toEqual({ day: TODAY });
    expect(resolveScheduleDayYmd('2024-02-29', TODAY)).toEqual({ day: '2024-02-29' });
    expect(resolveScheduleDayYmd('2026-10-18', TODAY)).toEqual({ day: '2026-10-18' });
    for (const raw of ['2026-02-29', '2026-02-31', '2026-13-01', '2026-04-31', 'tomorrow']) {
      expect(resolveScheduleDayYmd(raw, TODAY)).toEqual({ error: 'invalid_day' });
    }
    const rolled = new Date(Date.UTC(2026, 1, 31));
    const rolledYmd = rolled.toISOString().slice(0, 10);
    expect(rolledYmd).not.toBe('2026-02-31');
    expect(resolveScheduleDayYmd('2026-02-31', TODAY)).not.toEqual({ day: rolledYmd });
    expect(resolveScheduleDayYmd('2026-02-31', TODAY)).not.toEqual({ day: TODAY });
  });
});

describe('VoiceAgentTools day args', () => {
  function build() {
    const listVisibleEvents = jest.fn(async () => []);
    const agent = new VoiceAgentTools({ listVisibleEvents } as never);
    const ctx = {
      userId: 'u',
      timeZone: TZ,
      nowIso: NOW,
      settings: { wakeTime: '08:00', sleepTime: '23:00' },
      tasks: [],
      slots: [],
      phases: [],
      reminders: [],
    } as unknown as VoiceToolContext;
    return { agent, listVisibleEvents, ctx };
  }

  it('returns an error for a day that is not real and does not answer with today', async () => {
    const { agent, listVisibleEvents, ctx } = build();
    await expect(agent.execute({ name: 'get_day_agenda', args: { day: 'tomorrow' } }, ctx)).resolves.toEqual({
      error: 'invalid_day',
    });
    await expect(agent.execute({ name: 'get_day_agenda', args: { day: '2026-02-31' } }, ctx)).resolves.toEqual({
      error: 'invalid_day',
    });
    await expect(agent.execute({ name: 'find_free_gaps', args: { day: '2026-13-01' } }, ctx)).resolves.toEqual({
      error: 'invalid_day',
    });
    expect(listVisibleEvents).not.toHaveBeenCalled();
  });

  it('still reads today when the day argument is empty', async () => {
    const { agent, ctx } = build();
    const today = scheduleTodayYmd(NOW, TZ, '08:00', '23:00');
    await expect(agent.execute({ name: 'get_day_agenda', args: { day: '' } }, ctx)).resolves.toMatchObject({
      day: today,
      count: 0,
    });
    await expect(agent.execute({ name: 'find_free_gaps', args: {} }, ctx)).resolves.toMatchObject({
      day: today,
    });
  });
});
