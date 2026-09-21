import { ServiceUnavailableException } from '@nestjs/common';

const defaultParseJson = JSON.stringify({
  understanding: 'complete',
  clarifyingQuestion: null,
  task: {
    name: 'Buy milk',
    eventType: 'admin',
    estimatedTimeInMinutes: 30,
    priority: 'medium',
  },
});

export function createGroqStub() {
  return {
    transcribe: jest.fn().mockResolvedValue({ text: 'buy milk', language: 'en' }),
    completeJson: jest.fn().mockResolvedValue(defaultParseJson),
    failTranscribe: () => {
      throw new ServiceUnavailableException('Groq STT failed');
    },
  };
}

export type GroqStub = ReturnType<typeof createGroqStub>;
