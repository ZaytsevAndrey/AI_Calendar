import Fastify from 'fastify';
import { registerVoiceHttpTiming } from './voice-http-timing';
import { Logger } from '@nestjs/common';
import { logVoiceLlm } from '../modules/voice/voice-llm-log.util';
import {
  bindVoiceTrace,
  currentVoiceTrace,
  formatVoiceTrace,
  noteVoiceStep,
  readVoiceTrace,
  runWithVoiceTrace,
  traceStep,
  voiceTraceBodiesEnabled,
  withTurnTrace,
  withVoiceSegment,
  VoiceTrace,
} from './voice-trace';

describe('formatVoiceTrace', () => {
  const steps = [
    { kind: 'llm' as const, name: 'planner.r0', via: 'deepseek:deepseek-flash', ms: 1835, ok: true },
    { kind: 'llm' as const, name: 'router', via: 'ollama:calendar-voice', ms: 31743, ok: true },
    { kind: 'other' as const, name: 'db.parse-context', via: '', ms: 40, ok: true },
    { kind: 'llm' as const, name: 'specialist.create', via: 'ollama:calendar-voice', ms: 84821, ok: false },
  ];

  it('sums model calls, other work, and the unaccounted gap', () => {
    expect(
      formatVoiceTrace({
        traceId: 'trace-1',
        method: 'POST',
        url: '/voice/turn?x=1',
        statusCode: 201,
        totalMs: 118432.6,
        steps,
      }),
    ).toBe(
      'voice.trace trace-1 POST /voice/turn 201 118433ms' +
        ' | llm 3x 118399ms | other 1x 40ms | gap -6ms' +
        ' | llm planner.r0 deepseek:deepseek-flash 1835ms' +
        ' | llm router ollama:calendar-voice 31743ms' +
        ' | other db.parse-context 40ms' +
        ' | llm specialist.create ollama:calendar-voice 84821ms fail',
    );
  });

  it('ignores routes outside /voice and still reports a request with no steps', () => {
    expect(
      formatVoiceTrace({
        traceId: 'trace-1',
        method: 'GET',
        url: '/tasks',
        statusCode: 200,
        totalMs: 4,
        steps: [],
      }),
    ).toBeNull();
    expect(
      formatVoiceTrace({
        traceId: 'trace-1',
        method: 'DELETE',
        url: '/voice/session/abc',
        statusCode: 200,
        totalMs: 4,
        steps: [],
      }),
    ).toBe(
      'voice.trace trace-1 DELETE /voice/session/abc 200 4ms | llm 0x 0ms | other 0x 0ms | gap 4ms',
    );
  });

  it('shows a technical success that failed validation without calling it a transport failure', () => {
    expect(
      formatVoiceTrace({
        traceId: 'trace-1',
        method: 'POST',
        url: '/voice/turn',
        statusCode: 201,
        totalMs: 20,
        steps: [
          {
            kind: 'llm',
            name: 'planner.r0',
            via: 'groq:openai/gpt-oss-120b',
            ms: 20,
            ok: true,
            valid: false,
            errorCode: 'invalid_decision',
            decision: 'nope',
            component: 'planner',
          },
        ],
      }),
    ).toBe(
      'voice.trace trace-1 POST /voice/turn 201 20ms' +
        ' | llm 1x 20ms | other 0x 0ms | gap 0ms' +
        ' | llm planner.r0 groq:openai/gpt-oss-120b decision=nope 20ms invalid=invalid_decision',
    );
  });

  it('prints a segment disposition separately from validation', () => {
    expect(
      formatVoiceTrace({
        traceId: 'trace-1',
        method: 'POST',
        url: '/voice/turn',
        statusCode: 201,
        totalMs: 4,
        steps: [
          {
            kind: 'other',
            name: 'segment',
            via: '',
            ms: 0,
            ok: true,
            component: 'orchestrator',
            segment: 1,
            outcome: 'clarify',
            reason: 'needs_clarification',
          },
        ],
      }),
    ).toBe(
      'voice.trace trace-1 POST /voice/turn 201 4ms' +
        ' | llm 0x 0ms | other 1x 0ms | gap 4ms' +
        ' | other segment s1 outcome=clarify 0ms reason=needs_clarification',
    );
  });
});

describe('traceStep', () => {
  it('records success and a thrown failure on the active trace only', async () => {
    const trace = new VoiceTrace();
    await runWithVoiceTrace(trace, async () => {
      await traceStep('other', 'db.turn-context', '', async () => 'rows');
      await expect(
        traceStep('llm', 'router', 'ollama:calendar-voice', async () => {
          throw new Error('down');
        }),
      ).rejects.toThrow('down');
    });
    await traceStep('other', 'stt', 'groq:whisper', async () => 'outside');

    expect(trace.steps).toEqual([
      { kind: 'other', name: 'db.turn-context', via: '', ms: expect.any(Number), ok: true },
      { kind: 'llm', name: 'router', via: 'ollama:calendar-voice', ms: expect.any(Number), ok: false },
    ]);
  });

  it('marks a returned failure without throwing', async () => {
    const trace = new VoiceTrace();
    const value = await runWithVoiceTrace(trace, () =>
      traceStep('llm', 'planner.r0', 'deepseek:deepseek-flash', async () => null, (v) => v == null),
    );
    expect(value).toBeNull();
    expect(trace.steps[0].ok).toBe(false);
  });
});

describe('registerVoiceHttpTiming', () => {
  it('logs model and other steps against the request that sent the response', async () => {
    const lines: string[] = [];
    const app = Fastify();
    registerVoiceHttpTiming(app, { log: (message) => lines.push(String(message)) });
    app.post('/voice/turn', async (request) => {
      const trace = readVoiceTrace(request);
      await runWithVoiceTrace(trace ?? bindVoiceTrace(request), async () => {
        await traceStep('llm', 'router', 'ollama:calendar-voice', async () => 'ok');
        await traceStep('other', 'db.parse-context', '', async () => undefined);
      });
      return { ok: true };
    });
    app.get('/tasks', async () => ({ ok: true }));

    const voice = await app.inject({ method: 'POST', url: '/voice/turn' });
    const other = await app.inject({ method: 'GET', url: '/tasks' });
    await app.close();

    expect(voice.statusCode).toBe(200);
    expect(other.statusCode).toBe(200);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^voice\.trace [0-9a-f-]{36} POST \/voice\/turn 200 \d+ms \| llm 1x \d+ms \| other 1x \d+ms \| gap -?\d+ms \| llm router ollama:calendar-voice \d+ms \| other db\.parse-context \d+ms$/,
    );
  });

  it('puts the request trace id on the summary once', async () => {
    const lines: string[] = [];
    const app = Fastify();
    registerVoiceHttpTiming(app, { log: (message) => lines.push(String(message)) });
    let seen = '';
    app.post('/voice/turn', async (request) => {
      const trace = readVoiceTrace(request) ?? bindVoiceTrace(request);
      await runWithVoiceTrace(trace, async () => {
        seen = currentVoiceTrace()?.traceId ?? '';
        await traceStep('other', 'db.turn-context', '', async () => undefined);
      });
      return { ok: true };
    });
    await app.inject({ method: 'POST', url: '/voice/turn' });
    await app.close();
    expect(seen).toMatch(/^[0-9a-f-]{36}$/);
    expect(lines[0].startsWith(`voice.trace ${seen} `)).toBe(true);
    expect(lines[0].slice(`voice.trace ${seen}`.length)).not.toContain(seen);
  });
});

describe('turn trace isolation', () => {
  it('reuses one trace for a nested turn and keeps a direct turn on its own', async () => {
    const outer = new VoiceTrace('http-turn');
    let nested = '';
    await runWithVoiceTrace(outer, () =>
      withTurnTrace(async () => {
        nested = currentVoiceTrace()?.traceId ?? '';
        await traceStep('other', 'db.turn-context', '', async () => undefined);
      }),
    );
    expect(nested).toBe('http-turn');
    expect(outer.steps.map((step) => step.name)).toEqual(['db.turn-context']);

    let direct = '';
    await withTurnTrace(async () => {
      direct = currentVoiceTrace()?.traceId ?? '';
    });
    expect(direct).not.toBe('http-turn');
    expect(direct).not.toBe('');
  });

  it('does not mix two overlapping turns or two overlapping steps', async () => {
    const left = new VoiceTrace('left');
    const right = new VoiceTrace('right');
    await Promise.all([
      runWithVoiceTrace(left, () =>
        traceStep('other', 'left-step', '', async () => {
          noteVoiceStep({ decision: 'left' });
          await new Promise((resolve) => setTimeout(resolve, 20));
        }),
      ),
      runWithVoiceTrace(right, () =>
        traceStep('other', 'right-step', '', async () => {
          noteVoiceStep({ decision: 'right' });
          await new Promise((resolve) => setTimeout(resolve, 5));
        }),
      ),
    ]);
    expect(left.steps.map((step) => step.decision)).toEqual(['left']);
    expect(right.steps.map((step) => step.decision)).toEqual(['right']);

    const shared = new VoiceTrace('shared');
    await runWithVoiceTrace(shared, () =>
      Promise.all([
        traceStep('other', 'slow', '', async () => {
          noteVoiceStep({ decision: 'slow' });
          await new Promise((resolve) => setTimeout(resolve, 15));
          await traceStep('other', 'nested', '', async () => {
            noteVoiceStep({ decision: 'nested' });
          });
        }),
        traceStep('other', 'fast', '', async () => {
          noteVoiceStep({ decision: 'fast' });
        }),
      ]),
    );
    const byName = Object.fromEntries(shared.steps.map((step) => [step.name, step.decision]));
    expect(byName).toEqual({ slow: 'slow', fast: 'fast', nested: 'nested' });
    expect(shared.traceId).toBe('shared');
  });

  it('keeps a segment index on the nested step and restores the outer one', async () => {
    const trace = new VoiceTrace('segments');
    await runWithVoiceTrace(trace, async () => {
      await withVoiceSegment(1, async () => {
        expect(currentVoiceTrace()?.activeSegment).toBe(1);
        await withVoiceSegment(2, async () => {
          await traceStep('llm', 'router', 'groq:test', async () => 'ok', undefined, {
            component: 'router',
            segment: currentVoiceTrace()?.activeSegment,
          });
        });
        expect(currentVoiceTrace()?.activeSegment).toBe(1);
      });
      expect(currentVoiceTrace()?.activeSegment).toBeUndefined();
    });
    expect(trace.steps[0]).toMatchObject({ name: 'router', segment: 2, component: 'router' });
    expect(trace.steps[0]).not.toHaveProperty('traceId');
  });
});

describe('VOICE_TRACE_BODY', () => {
  const previous = {
    body: process.env.VOICE_TRACE_BODY,
    production: process.env.VOICE_TRACE_BODY_PRODUCTION,
    node: process.env.NODE_ENV,
  };

  afterEach(() => {
    restoreEnv('VOICE_TRACE_BODY', previous.body);
    restoreEnv('VOICE_TRACE_BODY_PRODUCTION', previous.production);
    restoreEnv('NODE_ENV', previous.node);
  });

  it('stays off unless enabled, and production needs a second flag', () => {
    delete process.env.VOICE_TRACE_BODY;
    delete process.env.VOICE_TRACE_BODY_PRODUCTION;
    process.env.NODE_ENV = 'test';
    expect(voiceTraceBodiesEnabled()).toBe(false);

    process.env.VOICE_TRACE_BODY = '1';
    expect(voiceTraceBodiesEnabled()).toBe(true);

    process.env.NODE_ENV = 'production';
    expect(voiceTraceBodiesEnabled()).toBe(false);
    process.env.VOICE_TRACE_BODY_PRODUCTION = '1';
    expect(voiceTraceBodiesEnabled()).toBe(true);
  });

  it('drops raw model text by default and redacts it when debug bodies are on', () => {
    delete process.env.VOICE_TRACE_BODY;
    const logger = new Logger('voice-trace-spec');
    const log = jest.spyOn(logger, 'log').mockImplementation(() => undefined);
    logVoiceLlm(logger, 'planner.round0', 'Bearer abc.def.ghi {"type":"final"}');
    expect(log).not.toHaveBeenCalled();

    process.env.VOICE_TRACE_BODY = '1';
    process.env.NODE_ENV = 'test';
    logVoiceLlm(logger, 'planner.round0', 'Bearer abc.def.ghi {"password":"secret"}');
    expect(String(log.mock.calls[0][0])).not.toContain('abc.def.ghi');
    expect(String(log.mock.calls[0][0])).toContain('[redacted]');
    expect(String(log.mock.calls[0][0]).length).toBeLessThan(4000);
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
