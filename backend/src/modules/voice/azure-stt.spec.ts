import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AzureSttClient, azureSpeechLocale } from './azure-stt';

describe('AzureSttClient', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function client(env: Record<string, string | undefined>): AzureSttClient {
    return new AzureSttClient({
      get: (key: string) => env[key],
    } as ConfigService);
  }

  it('maps speech settings to an Azure locale', () => {
    expect(azureSpeechLocale('uk')).toBe('uk-UA');
    expect(azureSpeechLocale('en')).toBe('en-US');
    expect(azureSpeechLocale('ru')).toBe('ru-RU');
  });

  it('stays off until both the key and the region are set', () => {
    expect(client({}).enabled()).toBe(false);
    expect(client({ AZURE_SPEECH_KEY: 'key' }).enabled()).toBe(false);
    expect(
      client({ AZURE_SPEECH_KEY: 'key', AZURE_SPEECH_REGION: 'west europe' }).enabled(),
    ).toBe(false);
    expect(
      client({ AZURE_SPEECH_KEY: 'key', AZURE_SPEECH_REGION: 'westeurope' }).enabled(),
    ).toBe(true);
  });

  it('posts the wav with a language hint and no phrase list', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        RecognitionStatus: 'Success',
        DisplayText: 'до мишка',
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const wav = Buffer.from('RIFFwav');

    const result = await client({
      AZURE_SPEECH_KEY: 'secret-key',
      AZURE_SPEECH_REGION: 'westeurope',
    }).transcribe(wav, 'uk');

    expect(result).toEqual({ text: 'до мишка', language: 'uk-UA' });
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      { method: string; headers: Record<string, string>; body: Uint8Array },
    ];
    expect(url).toBe(
      'https://westeurope.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=uk-UA&format=detailed',
    );
    expect(init.method).toBe('POST');
    expect(init.headers['Ocp-Apim-Subscription-Key']).toBe('secret-key');
    expect(init.headers['Content-Type']).toBe(
      'audio/wav; codecs=audio/pcm; samplerate=16000',
    );
    expect(Buffer.from(init.body).equals(wav)).toBe(true);
    expect(JSON.stringify(init)).not.toMatch(/phrase|prompt|vocab/i);
  });

  it('treats silence as an empty transcript', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ RecognitionStatus: 'NoMatch' }),
    }) as unknown as typeof fetch;

    const result = await client({
      AZURE_SPEECH_KEY: 'key',
      AZURE_SPEECH_REGION: 'westeurope',
    }).transcribe(Buffer.from('wav'), 'uk');

    expect(result.text).toBe('');
  });

  it('fails when Azure rejects the request', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'Access denied' } }),
    }) as unknown as typeof fetch;

    await expect(
      client({
        AZURE_SPEECH_KEY: 'key',
        AZURE_SPEECH_REGION: 'westeurope',
      }).transcribe(Buffer.from('wav'), 'en'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
