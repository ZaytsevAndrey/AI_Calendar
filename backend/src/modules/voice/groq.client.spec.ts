import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  discoverGroqKeyNames,
  GroqClient,
  groqRetryAfterSeconds,
  rateLimitWaitMs,
} from './groq.client';

describe('discoverGroqKeyNames', () => {
  it('returns only the primary key when extras are missing', () => {
    expect(
      discoverGroqKeyNames((name) => (name === 'GROQ_API_KEY' ? 'k1' : undefined)),
    ).toEqual(['GROQ_API_KEY']);
  });

  it('collects numbered keys until the first gap', () => {
    const env: Record<string, string> = {
      GROQ_API_KEY: 'k1',
      GROQ_API_KEY_2: 'k2',
      GROQ_API_KEY_3: 'k3',
      GROQ_API_KEY_5: 'k5',
    };
    expect(discoverGroqKeyNames((name) => env[name])).toEqual([
      'GROQ_API_KEY',
      'GROQ_API_KEY_2',
      'GROQ_API_KEY_3',
    ]);
  });

  it('supports more than six keys', () => {
    const env: Record<string, string> = { GROQ_API_KEY: 'k1' };
    for (let n = 2; n <= 10; n += 1) {
      env[`GROQ_API_KEY_${n}`] = `k${n}`;
    }
    expect(discoverGroqKeyNames((name) => env[name])).toHaveLength(10);
  });
});

describe('GroqClient local LLM', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function client(): GroqClient {
    return new GroqClient({
      get: (key: string) => {
        if (key === 'LLM_BASE_URL') return 'http://127.0.0.1:11434/';
        if (key === 'LLM_MODEL') return 'calendar-voice';
        return undefined;
      },
    } as ConfigService);
  }

  it('sends chat to Ollama with thinking off and an 8k context', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ message: { content: '{"ok":true}' } }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(client().completeJson('system', 'user')).resolves.toBe('{"ok":true}');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(url).toBe('http://127.0.0.1:11434/api/chat');
    const body = JSON.parse(init.body) as {
      model: string;
      think: boolean;
      format: string;
      options: { num_ctx: number };
    };
    expect(body.model).toBe('calendar-voice');
    expect(body.think).toBe(false);
    expect(body.format).toBe('json');
    expect(body.options.num_ctx).toBe(8192);
  });

  it('drops a think block before the JSON', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        message: { content: '<think>hidden</think>{"name":"Молоко"}' },
      }),
    }) as unknown as typeof fetch;

    await expect(client().completeJson('system', 'user')).resolves.toBe('{"name":"Молоко"}');
  });

  it('pins each eval scenario to the next Groq key and keeps both chats there', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '{"ok":true}' } }],
        usage: { total_tokens: 10 },
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const groq = new GroqClient({
      get: (key: string) => {
        if (key === 'GROQ_ROTATE_KEYS') return '1';
        if (key === 'GROQ_API_KEY') return 'key-1';
        if (key === 'GROQ_API_KEY_2') return 'key-2';
        if (key === 'GROQ_API_KEY_3') return 'key-3';
        return undefined;
      },
    } as ConfigService);

    expect(groq.pinNextKey()).toEqual({ index: 0, count: 3 });
    await groq.completeJson('system', 'user');
    await groq.completeJson('system', 'user');
    expect(groq.pinNextKey()).toEqual({ index: 1, count: 3 });
    await groq.completeJson('system', 'user');

    const bearers = fetchMock.mock.calls.map((call) => {
      const init = call[1] as { headers: { Authorization: string } };
      return init.headers.Authorization;
    });
    expect(bearers).toEqual(['Bearer key-1', 'Bearer key-1', 'Bearer key-2']);
  });

  it('rotates on the live API when two or more keys are set without GROQ_ROTATE_KEYS', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '{"ok":true}' } }],
        usage: { total_tokens: 5 },
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const groq = new GroqClient({
      get: (key: string) => {
        if (key === 'GROQ_API_KEY') return 'key-1';
        if (key === 'GROQ_API_KEY_2') return 'key-2';
        return undefined;
      },
    } as ConfigService);

    expect(groq.pinNextKey()).toEqual({ index: 0, count: 2 });
    const first = await groq.runWithPin(0, () => groq.completeJson('system', 'user'));
    expect(first.tokensUsed).toBe(5);
    expect(groq.pinNextKey()).toEqual({ index: 1, count: 2 });
    await groq.runWithPin(1, () => groq.completeJson('system', 'user'));

    const bearers = fetchMock.mock.calls.map((call) => {
      const init = call[1] as { headers: { Authorization: string } };
      return init.headers.Authorization;
    });
    expect(bearers).toEqual(['Bearer key-1', 'Bearer key-2']);
  });

  it('hops to the next key after TPM retries fail', async () => {
    const tpm = {
      ok: false,
      status: 429,
      headers: { get: () => '1' },
      json: async () => ({
        error: { message: 'Rate limit reached. Please try again in 0.5s.' },
      }),
    };
    const ok = {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({
        choices: [{ message: { content: '{"ok":true}' } }],
        usage: { total_tokens: 3 },
      }),
    };
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(tpm)
      .mockResolvedValueOnce(tpm)
      .mockResolvedValueOnce(tpm)
      .mockResolvedValueOnce(ok);
    global.fetch = fetchMock as unknown as typeof fetch;

    const groq = new GroqClient({
      get: (key: string) => {
        if (key === 'GROQ_API_KEY') return 'key-1';
        if (key === 'GROQ_API_KEY_2') return 'key-2';
        return undefined;
      },
    } as ConfigService);

    const sleep = jest
      .spyOn(groq as unknown as { sleep: (ms: number) => Promise<void> }, 'sleep')
      .mockResolvedValue(undefined);

    const result = await groq.runWithPin(0, () => groq.completeJson('system', 'user'));
    expect(result.value).toBe('{"ok":true}');
    expect(result.keyIndex).toBe(1);
    const bearers = fetchMock.mock.calls.map((call) => {
      const init = call[1] as { headers: { Authorization: string } };
      return init.headers.Authorization;
    });
    expect(bearers.filter((b) => b === 'Bearer key-1').length).toBeGreaterThanOrEqual(1);
    expect(bearers[bearers.length - 1]).toBe('Bearer key-2');
    sleep.mockRestore();
  });

  it('skips the first Groq key when that org is out of tokens', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const groq = new GroqClient({
      get: (key: string) => {
        if (key === 'GROQ_ROTATE_KEYS') return '1';
        if (key === 'GROQ_SKIP_FIRST_KEY') return '1';
        if (key === 'GROQ_API_KEY') return 'key-1';
        if (key === 'GROQ_API_KEY_2') return 'key-2';
        if (key === 'GROQ_API_KEY_3') return 'key-3';
        return undefined;
      },
    } as ConfigService);

    expect(groq.pinNextKey()).toEqual({ index: 0, count: 2 });
    await groq.completeJson('system', 'user');
    expect(groq.pinNextKey()).toEqual({ index: 1, count: 2 });
    await groq.completeJson('system', 'user');

    const bearers = fetchMock.mock.calls.map((call) => {
      const init = call[1] as { headers: { Authorization: string } };
      return init.headers.Authorization;
    });
    expect(bearers).toEqual(['Bearer key-2', 'Bearer key-3']);
  });

  it('sends planner calls to gpt-oss-120b and falls back to the chat model on a rate limit', async () => {
    const tpd = {
      ok: false,
      status: 429,
      headers: { get: () => null },
      json: async () => ({
        error: {
          message:
            'Rate limit reached: tokens per day (TPD). Please try again in 19m9.984s.',
        },
      }),
    };
    const ok = {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({
        choices: [{ message: { content: '{"ok":true}' } }],
        usage: { total_tokens: 7 },
      }),
    };
    const fetchMock = jest.fn().mockResolvedValueOnce(tpd).mockResolvedValueOnce(ok);
    global.fetch = fetchMock as unknown as typeof fetch;

    const groq = new GroqClient({
      get: (key: string) => (key === 'GROQ_API_KEY' ? 'test-key' : undefined),
    } as ConfigService);

    const result = await groq.runWithPin(0, () =>
      groq.completeJson('system', 'user', { role: 'planner' }),
    );
    expect(result.value).toBe('{"ok":true}');
    expect(result.tokensUsed).toBe(7);
    const models = fetchMock.mock.calls.map(
      (call) => (JSON.parse((call[1] as { body: string }).body) as { model: string }).model,
    );
    expect(models).toEqual(['openai/gpt-oss-120b', 'openai/gpt-oss-20b']);
  });

  it('retries the same model without JSON mode when it emits a stray tool call', async () => {
    const strayTool = {
      ok: false,
      status: 400,
      headers: { get: () => null },
      json: async () => ({
        error: { message: 'Tool choice is none, but model called a tool', code: 'tool_use_failed' },
      }),
    };
    const ok = {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({
        choices: [{ message: { content: '{"ok":true}' } }],
        usage: { total_tokens: 5 },
      }),
    };
    const fetchMock = jest.fn().mockResolvedValueOnce(strayTool).mockResolvedValueOnce(ok);
    global.fetch = fetchMock as unknown as typeof fetch;

    const groq = new GroqClient({
      get: (key: string) => (key === 'GROQ_API_KEY' ? 'test-key' : undefined),
    } as ConfigService);

    const result = await groq.runWithPin(0, () => groq.completeJson('system', 'user'));
    expect(result.value).toBe('{"ok":true}');
    const bodies = fetchMock.mock.calls.map(
      (call) => JSON.parse((call[1] as { body: string }).body) as { model: string; response_format?: unknown },
    );
    expect(bodies.map((body) => body.model)).toEqual(['openai/gpt-oss-20b', 'openai/gpt-oss-20b']);
    expect(bodies[0].response_format).toBeDefined();
    expect(bodies[1].response_format).toBeUndefined();
  });

  it('fails a hung Groq chat once instead of trying the fallback model', async () => {
    const timeout = new Error('The operation was aborted due to timeout');
    timeout.name = 'TimeoutError';
    const fetchMock = jest.fn().mockRejectedValue(timeout);
    global.fetch = fetchMock as unknown as typeof fetch;

    const groq = new GroqClient({
      get: (key: string) => (key === 'GROQ_API_KEY' ? 'test-key' : undefined),
    } as ConfigService);

    await expect(groq.completeJson('system', 'user')).rejects.toMatchObject({
      response: { code: 'VOICE_LLM_TIMEOUT' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('Groq retry-after', () => {
  it('reads minutes and seconds from a daily-window message', () => {
    const message =
      'tokens per day (TPD): Limit 200000, Used 199316, Requested 3346. Please try again in 19m9.984s.';
    expect(groqRetryAfterSeconds(message)).toBeCloseTo(19 * 60 + 9.984, 2);
    expect(rateLimitWaitMs(message, null)).toBe(6000);
  });

  it('reads a short seconds wait', () => {
    expect(groqRetryAfterSeconds('Please try again in 3.645s.')).toBeCloseTo(3.645, 2);
  });
});
