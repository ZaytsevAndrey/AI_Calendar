import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GroqClient, groqRetryAfterSeconds, rateLimitWaitMs } from './groq.client';

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
      json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }),
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
