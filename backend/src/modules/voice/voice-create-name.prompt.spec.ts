import { buildVoiceCreateSystemPrompt, buildVoiceCreateUserPrompt } from './voice-parse.create.prompt';
import type { VoiceParsePromptContext } from './voice-parse.shared.prompt';

const ctx: VoiceParsePromptContext = {
  transcript: 'test',
  timeZone: 'Europe/Kyiv',
  nowIso: '2026-10-18T06:00:00.000Z',
  phases: [],
  settings: { wakeTime: '08:00', sleepTime: '23:00', weekendWorkEnabled: false },
  language: 'uk',
  mode: 'assistant',
};

function userPrompt(transcript: string, open: string[]): string {
  return buildVoiceCreateUserPrompt({
    ...ctx,
    transcript,
    openTasks: open.map((name) => ({ name, recurring: false })),
  });
}

describe('create specialist name rule', () => {
  const system = buildVoiceCreateSystemPrompt('uk', 'assistant');

  it('takes the title from the command and keeps a duplicate title', () => {
    expect(system).toMatch(/title comes from the content of this create command/);
    expect(system).toMatch(/not a reason to clear the name or to ask/);
    expect(system).toMatch(/Another task with that title is still this create/);
  });

  it('treats a further-instance marker as frame, not as a listed word', () => {
    expect(system).toMatch(/only marks a further instance of that errand is frame/);
    expect(system).toMatch(/Keep it in the title only when the utterance makes that word part of the errand/);
    expect(system).not.toMatch(/нову|ще одну|другу/);
  });

  it('still asks when the command names no errand and does not copy an open title', () => {
    expect(system).toMatch(/only the act of creating, plus a day or a clock, and names no errand/);
    expect(system).toMatch(/Do not copy an Open task title they did not say/);
    expect(system).toMatch(/The open list does not choose a title/);
    expect(system).toMatch(/only when the words of this command determine that task and no other/);
  });

  it.each([
    ['Створи нову Report', ['Report']],
    ['Створи ще одну Report', ['Report']],
    ['Додай другу Report', ['Report']],
    ['Створи задачу на завтра', ['Report']],
    ['Купи молоко', ['Звіт', 'Нарада']],
  ])('passes %s through with the open list and no rewritten title', (transcript, open) => {
    const user = userPrompt(transcript, open);
    expect(user).toContain(`Transcript: ${JSON.stringify(transcript)}`);
    for (const name of open) {
      expect(user).toContain(JSON.stringify(name));
    }
    expect(user).not.toContain('task.name');
  });
});
