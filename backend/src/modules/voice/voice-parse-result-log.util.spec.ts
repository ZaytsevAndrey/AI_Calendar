import {
  buildVoiceParseResultLog,
  formatVoiceParseResultLog,
} from './voice-parse-result-log.util';
import type { VoiceParseResult } from './voice-parse.types';

const baseMeta = {
  parseId: '11111111-1111-4111-8111-111111111111',
  transcript: 'завтра купити молоко',
  previousTranscript: null as string | null,
  clarificationAnswer: null as string | null,
  timeZone: 'Europe/Kyiv',
  nowIso: '2026-10-13T10:00:00.000Z',
  routerIntent: 'create',
  sniffed: null as string | null,
  intent: 'create',
  specialistIntent: 'create',
  language: 'uk' as string | null,
};

describe('buildVoiceParseResultLog', () => {
  it('logs create flexible day-window fields without raw LLM text', () => {
    const result: VoiceParseResult = {
      understanding: 'complete',
      clarifyingQuestion: null,
      task: {
        name: 'Купити молоко',
        eventType: 'admin',
        estimatedTimeInMinutes: 30,
        isRecurring: false,
        allowSplit: true,
        priority: 'medium',
        earliestStartTime: '2026-10-14T00:00:00+03:00',
        deadline: '2026-10-14T23:59:00+03:00',
        scheduledStartTime: null,
        scheduledEndTime: null,
      },
      command: null,
    };

    const payload = buildVoiceParseResultLog({ ...baseMeta, result });

    expect(payload).toMatchObject({
      parseId: baseMeta.parseId,
      transcript: 'завтра купити молоко',
      routerIntent: 'create',
      sniffed: null,
      intent: 'create',
      specialistIntent: 'create',
      language: 'uk',
      understanding: 'complete',
      clarifyingQuestion: null,
      kind: 'flexible',
      taskName: 'Купити молоко',
      earliestStartTime: '2026-10-14T00:00:00+03:00',
      deadline: '2026-10-14T23:59:00+03:00',
      commandKind: null,
      commandTaskName: null,
    });
    expect(JSON.stringify(payload)).not.toMatch(/system|prompt|llm/i);
  });

  it('logs unscheduled create', () => {
    const result: VoiceParseResult = {
      understanding: 'complete',
      clarifyingQuestion: null,
      task: {
        name: 'Buy milk',
        eventType: 'admin',
        estimatedTimeInMinutes: 30,
        isRecurring: false,
        isUnscheduled: true,
        allowSplit: true,
        priority: 'medium',
      },
      command: null,
    };

    expect(buildVoiceParseResultLog({ ...baseMeta, transcript: 'buy milk', language: 'en', result })).toMatchObject({
      kind: 'unscheduled',
      isUnscheduled: true,
      taskName: 'Buy milk',
      scheduledStartTime: null,
      earliestStartTime: null,
      deadline: null,
    });
  });

  it('logs sniff override and command result', () => {
    const result: VoiceParseResult = {
      understanding: 'complete',
      clarifyingQuestion: null,
      task: null,
      command: {
        kind: 'complete',
        taskId: 't1',
        taskName: 'Dentist',
        summary: 'Marked Dentist done',
      },
    };

    const payload = buildVoiceParseResultLog({
      ...baseMeta,
      transcript: 'done with dentist',
      routerIntent: 'create',
      sniffed: 'complete',
      intent: 'complete',
      specialistIntent: 'complete',
      language: 'en',
      result,
    });

    expect(payload).toMatchObject({
      routerIntent: 'create',
      sniffed: 'complete',
      intent: 'complete',
      kind: 'complete',
      taskName: null,
      commandKind: 'complete',
      commandTaskName: 'Dentist',
    });
  });

  it('logs clarify without inventing schedule fields', () => {
    const result: VoiceParseResult = {
      understanding: 'needs_clarification',
      clarifyingQuestion: 'What should I call this task?',
      task: null,
      command: null,
    };

    expect(
      buildVoiceParseResultLog({
        ...baseMeta,
        transcript: 'add something',
        language: 'en',
        result,
      }),
    ).toMatchObject({
      understanding: 'needs_clarification',
      clarifyingQuestion: 'What should I call this task?',
      kind: null,
      taskName: null,
      commandKind: null,
    });
  });

  it('formats a single harvestable log line', () => {
    const payload = buildVoiceParseResultLog({
      ...baseMeta,
      result: {
        understanding: 'complete',
        clarifyingQuestion: null,
        task: {
          name: 'Dentist',
          eventType: 'fixed',
          estimatedTimeInMinutes: 60,
          isRecurring: false,
          allowSplit: false,
          priority: 'medium',
          scheduledStartTime: '2026-10-14T15:00:00+03:00',
          scheduledEndTime: '2026-10-14T16:00:00+03:00',
        },
        command: null,
      },
    });

    const line = formatVoiceParseResultLog(payload);
    expect(line.startsWith('voice.parse.result {')).toBe(true);
    expect(line).toContain('"kind":"fixed"');
    expect(line).toContain('"taskName":"Dentist"');
  });
});
