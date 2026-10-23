import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AzureTtsClient, azureTtsVoice, escapeSsml } from './azure-tts';

describe('AzureTtsClient', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function client(env: Record<string, string | undefined>): AzureTtsClient {
    return new AzureTtsClient({
      get: (key: string) => env[key],
    } as ConfigService);
  }

  const ready = {
    AZURE_SPEECH_KEY: 'secret-key',
    AZURE_SPEECH_REGION: 'northeurope',
  };

  it('picks a neural voice from the speech language', () => {
    expect(azureTtsVoice('uk')).toEqual({
      locale: 'uk-UA',
      voice: 'uk-UA-PolinaNeural',
    });
    expect(azureTtsVoice('en')).toEqual({
      locale: 'en-US',
      voice: 'en-US-GuyNeural',
    });
    expect(escapeSsml(`a < b & "c"`)).toBe('a &lt; b &amp; &quot;c&quot;');
  });

  it('posts SSML with the same key used for transcription', async () => {
    const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(64)]);
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () =>
        wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await client(ready).synthesize('Привіт', 'uk');

    expect(result.subarray(0, 4).toString()).toBe('RIFF');
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      { headers: Record<string, string>; body: string },
    ];
    expect(url).toBe('https://northeurope.tts.speech.microsoft.com/cognitiveservices/v1');
    expect(init.headers['Ocp-Apim-Subscription-Key']).toBe('secret-key');
    expect(init.headers['X-Microsoft-OutputFormat']).toBe('riff-24khz-16bit-mono-pcm');
    expect(init.body).toContain('uk-UA-PolinaNeural');
    expect(init.body).toContain('Привіт');
  });

  it('refuses when Azure Speech is not configured', async () => {
    await expect(client({}).synthesize('Привіт', 'uk')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('fails when Azure rejects the request', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Access denied',
    }) as unknown as typeof fetch;

    await expect(client(ready).synthesize('Hello', 'en')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
