import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PiperSpeechService } from './piper-speech.service';

describe('PiperSpeechService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function service(url?: string): PiperSpeechService {
    return new PiperSpeechService({
      get: (key: string) => (key === 'PIPER_URL' ? url : undefined),
    } as ConfigService);
  }

  it('refuses when Piper is not configured', async () => {
    await expect(service().synthesize('Привіт', 'uk')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('posts the reply text to the local Piper process', async () => {
    const wav = Buffer.alloc(64, 1);
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () =>
        wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await service('http://127.0.0.1:5510/').synthesize('Привіт', 'uk');

    expect(result.length).toBe(64);
    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(url).toBe('http://127.0.0.1:5510/speak');
    expect(JSON.parse(init.body)).toEqual({ text: 'Привіт', language: 'uk' });
  });
});
