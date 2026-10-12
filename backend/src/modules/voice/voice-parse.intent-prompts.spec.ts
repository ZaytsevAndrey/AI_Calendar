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
        expect(pair.system).toMatch(/after sleep/i);
        expect(pair.system).toMatch(/First match wins/);
        expect(pair.system).toMatch(/phaseId only from the phases list/);
        expect(pair.system).toMatch(/Do not guess/);
        expect(pair.user).toContain('schedule today:');
        expect(pair.user).toContain('After sleep');
        expect(pair.user).toContain('Default task duration: 30 minutes');
      }
      if (intent === 'update') {
        expect(pair.system).toMatch(/ONLY fields the speaker changed/);
        expect(pair.system).toMatch(/command\.newName/);
        expect(pair.system).toMatch(/phaseId/);
        expect(pair.system).not.toMatch(/Habit create/);
        expect(pair.user).toContain('Phases:');
      }
      if (intent === 'reschedule') {
        expect(pair.system).toMatch(/command\.start/);
        expect(pair.system).toMatch(/00:00/);
        expect(pair.system).toMatch(/23:59/);
        expect(pair.system).toMatch(/зроби зараз/);
        expect(pair.system).toMatch(/task null/i);
        expect(pair.user).toContain('schedule tomorrow:');
        expect(pair.user).not.toContain('Phases:');
      }
    }
  });
});
