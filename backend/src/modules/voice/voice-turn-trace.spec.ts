import { currentVoiceTrace, runWithVoiceTrace, VoiceTrace, withVoiceSegment } from '../../common/voice-trace';
import type { VoiceParseResult } from './voice-parse.types';
import { VoiceService } from './voice.service';

function service(): {
  turn: VoiceService['turn'];
  segments: Array<number | undefined>;
  ids: string[];
} {
  const segments: Array<number | undefined> = [];
  const ids: string[] = [];
  const session = { groqKeyIndex: 0 };
  const orchestrator = {
    turn: jest.fn(async (_userId: string, _dto: unknown, parse: (ctx: { transcript: string; segment?: number }) => Promise<VoiceParseResult>) => {
      ids.push(currentVoiceTrace()?.traceId ?? '');
      await parse({ transcript: 'buy milk', segment: 0 });
      await parse({ transcript: 'mystery', segment: 1 });
      return { outcome: 'confirm' };
    }),
    endSession: jest.fn(),
  };
  const groq = {
    pinNextKey: () => ({ index: 0, count: 1 }),
    runWithPin: async (_index: number, fn: () => Promise<unknown>) => ({
      value: await fn(),
      keyIndex: 0,
      tokensUsed: 0,
    }),
  };
  const voice = new VoiceService(
    groq as never,
    {} as never,
    orchestrator as never,
    { getOrCreate: () => session } as never,
    { assertUnderLimit: jest.fn(async () => undefined), addTokens: jest.fn() } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  jest.spyOn(voice, 'parseTask').mockImplementation(async () => {
    segments.push(currentVoiceTrace()?.activeSegment);
    return {
      understanding: 'complete',
      clarifyingQuestion: null,
      task: null,
      command: null,
    };
  });
  return { turn: voice.turn.bind(voice), segments, ids };
}

function dto(sessionId: string, transcript: string) {
  return { sessionId, transcript, timeZone: 'Europe/Kyiv' };
}

describe('VoiceService.turn trace', () => {
  // These cases cover the legacy orchestrator, reachable through the VOICE_TURN_ENGINE rollback switch.
  const engine = process.env.VOICE_TURN_ENGINE;
  beforeAll(() => {
    process.env.VOICE_TURN_ENGINE = 'legacy';
  });
  afterAll(() => {
    if (engine === undefined) delete process.env.VOICE_TURN_ENGINE;
    else process.env.VOICE_TURN_ENGINE = engine;
  });

  it('reuses the trace that HTTP already opened', async () => {
    const { turn, ids } = service();
    const http = new VoiceTrace('http-turn');
    await runWithVoiceTrace(http, () => turn('user', dto('s', 'hi')));
    expect(ids).toEqual(['http-turn']);
  });

  it('opens a distinct trace for each direct call', async () => {
    const { turn, segments, ids } = service();
    await turn('user', dto('s', 'one'));
    await turn('user', dto('s', 'two'));
    expect(segments).toEqual([0, 1, 0, 1]);
    expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(ids[1]).toMatch(/^[0-9a-f-]{36}$/);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('passes a stable segment index into the parse that shares the turn trace', async () => {
    const { turn, segments } = service();
    const trace = new VoiceTrace('direct-turn');
    await runWithVoiceTrace(trace, () => turn('user', dto('s', 'two parts')));
    expect(segments).toEqual([0, 1]);
    expect(trace.traceId).toBe('direct-turn');
  });

  it('keeps two direct turns apart', async () => {
    const first = service();
    const second = service();
    const left = new VoiceTrace('a');
    const right = new VoiceTrace('b');
    const ids: string[] = [];
    await Promise.all([
      runWithVoiceTrace(left, async () => {
        await first.turn('user', dto('s1', 'one'));
        ids.push(currentVoiceTrace()?.traceId ?? '');
      }),
      runWithVoiceTrace(right, async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        await second.turn('user', dto('s2', 'two'));
        ids.push(currentVoiceTrace()?.traceId ?? '');
      }),
    ]);
    expect(ids.sort()).toEqual(['a', 'b']);
    expect(left.traceId).not.toBe(right.traceId);
  });
});

describe('withVoiceSegment', () => {
  it('is a no-op outside a turn', async () => {
    let ran = false;
    await withVoiceSegment(3, async () => {
      ran = true;
      expect(currentVoiceTrace()).toBeUndefined();
    });
    expect(ran).toBe(true);
  });
});
