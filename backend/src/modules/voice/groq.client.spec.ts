import { ConfigService } from '@nestjs/config';
import { GroqClient } from './groq.client';

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
});
