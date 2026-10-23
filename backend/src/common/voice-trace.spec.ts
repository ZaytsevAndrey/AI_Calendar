import Fastify from 'fastify';
import { registerVoiceHttpTiming } from './voice-http-timing';
import {
  bindVoiceTrace,
  formatVoiceTrace,
  readVoiceTrace,
  runWithVoiceTrace,
  traceStep,
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
        method: 'POST',
        url: '/voice/turn?x=1',
        statusCode: 201,
        totalMs: 118432.6,
        steps,
      }),
    ).toBe(
      'voice.trace POST /voice/turn 201 118433ms' +
        ' | llm 3x 118399ms | other 1x 40ms | gap -6ms' +
        ' | llm planner.r0 deepseek:deepseek-flash 1835ms' +
        ' | llm router ollama:calendar-voice 31743ms' +
        ' | other db.parse-context 40ms' +
        ' | llm specialist.create ollama:calendar-voice 84821ms fail',
    );
  });

  it('ignores routes outside /voice and still reports a request with no steps', () => {
    expect(
      formatVoiceTrace({ method: 'GET', url: '/tasks', statusCode: 200, totalMs: 4, steps: [] }),
    ).toBeNull();
    expect(
      formatVoiceTrace({
        method: 'DELETE',
        url: '/voice/session/abc',
        statusCode: 200,
        totalMs: 4,
        steps: [],
      }),
    ).toBe('voice.trace DELETE /voice/session/abc 200 4ms | llm 0x 0ms | other 0x 0ms | gap 4ms');
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
      /^voice\.trace POST \/voice\/turn 200 \d+ms \| llm 1x \d+ms \| other 1x \d+ms \| gap -?\d+ms \| llm router ollama:calendar-voice \d+ms \| other db\.parse-context \d+ms$/,
    );
  });
});
