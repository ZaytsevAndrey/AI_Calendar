import { ServiceUnavailableException } from '@nestjs/common';

const defaultRouterJson = JSON.stringify({
  intent: 'create',
  language: 'en',
});

const defaultParseJson = JSON.stringify({
  intent: 'create',
  understanding: 'complete',
  clarifyingQuestion: null,
  task: {
    name: 'Buy milk',
    kind: 'flexible',
    eventType: 'admin',
    estimatedTimeInMinutes: 30,
    priority: 'medium',
    earliestStartTime: '2026-09-08T00:00:00+03:00',
    deadline: '2026-09-08T23:59:00+03:00',
  },
});

function isRouterPrompt(systemPrompt: string): boolean {
  return /classify a spoken calendar/i.test(systemPrompt);
}

/**
 * Queue router + specialist responses for one /voice/parse-task call.
 * Prefer this over bare mockResolvedValueOnce after the two-step parse landed.
 */
export function mockVoiceParseTurn(
  groq: { completeJson: jest.Mock },
  specialist: unknown,
  router: { intent: string; language?: string } = {
    intent: 'create',
    language: 'en',
  },
): void {
  const specialistJson =
    typeof specialist === 'string' ? specialist : JSON.stringify(specialist);
  groq.completeJson
    .mockResolvedValueOnce(JSON.stringify(router))
    .mockResolvedValueOnce(specialistJson);
}

export function createGroqStub() {
  return {
    transcribe: jest.fn().mockResolvedValue({ text: 'buy milk', language: 'en' }),
    completeJson: jest.fn().mockImplementation(async (systemPrompt: string) => {
      if (isRouterPrompt(String(systemPrompt || ''))) {
        return defaultRouterJson;
      }
      return defaultParseJson;
    }),
    failTranscribe: () => {
      throw new ServiceUnavailableException('Groq STT failed');
    },
  };
}

export type GroqStub = ReturnType<typeof createGroqStub>;
