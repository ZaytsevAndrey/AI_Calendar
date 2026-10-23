import { buildPlannerSystemPrompt } from './voice-agent.planner.prompt';
import { buildVoiceIntentPrompt } from './voice-parse.intent-prompts';
import type { VoiceParsePromptContext } from './voice-parse.shared.prompt';
import { voiceCompanionMode } from './voice-companion-mode';

const ctx: VoiceParsePromptContext = {
  transcript: 'test',
  timeZone: 'Europe/Kyiv',
  nowIso: '2026-09-07T16:00:00.000Z',
  phases: [],
  settings: {
    wakeTime: '08:00',
    sleepTime: '23:00',
    weekendWorkEnabled: false,
  },
  language: 'en',
};

describe('fast create prompts', () => {
  it('treats a missing mode as the assistant dialogue', () => {
    expect(voiceCompanionMode(undefined)).toBe('assistant');
    expect(voiceCompanionMode('fast_create')).toBe('fast_create');
    expect(voiceCompanionMode('other')).toBe('assistant');
  });

  it('leaves the assistant create and planner prompts unchanged', () => {
    const create = buildVoiceIntentPrompt('create', ctx);
    expect(create.system).not.toContain('Fast create.');
    expect(create.system).toMatch(/First match wins/);
    expect(buildPlannerSystemPrompt('en')).not.toContain('Fast create is on');
    expect(buildPlannerSystemPrompt('uk', 'assistant')).not.toContain('Fast create is on');
  });

  it('tells create to ask once, and only when the task cannot be saved', () => {
    const create = buildVoiceIntentPrompt('create', { ...ctx, mode: 'fast_create' });
    expect(create.system).toContain('Fast create.');
    expect(create.system).toMatch(/Ask at most one question/);
    expect(create.system).toMatch(/empty name/);
    expect(create.system).toMatch(/event's own length or as the window/);
    expect(create.system).toMatch(/default duration/);
    expect(create.system).toMatch(/schedule tomorrow/);
  });

  it('does not change other specialists when the turn is fast create', () => {
    const move = buildVoiceIntentPrompt('update', { ...ctx, mode: 'fast_create' });
    expect(move.system).not.toContain('Fast create.');
  });

  it('keeps moves, questions, and day plans on the planner while creates skip detail questions', () => {
    const planner = buildPlannerSystemPrompt('en', 'fast_create');
    expect(planner).toContain('Fast create is on');
    expect(planner).toMatch(/day plan stay as written above/);
    expect(planner).toMatch(/create specialist fills them/);
    expect(planner).toMatch(/names no errand/);
  });
});
