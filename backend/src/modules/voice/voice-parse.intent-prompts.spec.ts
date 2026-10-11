import { buildVoiceIntentPrompt } from './voice-parse.intent-prompts';
import { buildVoiceRouterSystemPrompt } from './voice-parse.router.prompt';
import {
  VOICE_PARSE_INTENTS,
  type VoiceParsePromptContext,
} from './voice-parse.shared.prompt';

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
  language: 'uk',
};

describe('voice parse prompt split', () => {
  it('router asks only for intent and language', () => {
    const system = buildVoiceRouterSystemPrompt();
    expect(system).toMatch(/classify/i);
    expect(system).toMatch(/"language"/);
    expect(system).not.toMatch(/scheduledStartTime/);
  });

  it('exposes a specialist prompt for every intent', () => {
    for (const intent of VOICE_PARSE_INTENTS) {
      const pair = buildVoiceIntentPrompt(intent, ctx);
      expect(pair.system.length).toBeGreaterThan(40);
      expect(pair.user).toContain('Transcript:');
      if (intent === 'create') {
        expect(pair.system).toMatch(/"kind"/);
        expect(pair.system).toMatch(/Ukrainian/);
      }
    }
  });
});
