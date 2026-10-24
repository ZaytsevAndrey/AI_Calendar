import { VoiceService } from './voice.service';

jest.mock('./audio-to-wav', () => ({
  transcodeToPcmWav: jest.fn(async (input: Buffer) => Buffer.concat([Buffer.from('wav'), input])),
}));

import { transcodeToPcmWav } from './audio-to-wav';

describe('VoiceService speech provider', () => {
  function build(azureOn: boolean) {
    const azure = {
      enabled: () => azureOn,
      transcribe: jest.fn().mockResolvedValue({ text: 'до мишка', language: 'uk-UA' }),
    };
    const groq = {
      transcribe: jest.fn().mockResolvedValue({ text: 'до мешка', language: 'uk' }),
    };
    const service = new VoiceService(
      groq as never,
      {
        getSettings: jest.fn().mockResolvedValue({
          speechLanguage: 'uk',
          language: 'uk',
        }),
      } as never,
      {} as never,
      {} as never,
      { assertUnderLimit: jest.fn().mockResolvedValue(undefined) } as never,
      {} as never,
      {} as never,
      {} as never,
      azure as never,
      { findAll: jest.fn(async () => []) } as never,
    );
    return { service, azure, groq };
  }

  const audio = Buffer.from('webm-bytes').toString('base64');

  it('sends the whole converted recording to Azure and keeps the raw words', async () => {
    const { service, azure, groq } = build(true);
    const result = await service.transcribe('user-1', {
      audioBase64: audio,
      mimeType: 'audio/webm',
    });

    expect(result).toEqual({ transcript: 'до мишка', language: 'uk-UA' });
    expect(groq.transcribe).not.toHaveBeenCalled();
    expect(transcodeToPcmWav).toHaveBeenCalled();
    const wav = azure.transcribe.mock.calls[0][0] as Buffer;
    expect(wav.subarray(0, 3).toString()).toBe('wav');
    expect(azure.transcribe.mock.calls[0][1]).toBe('uk');
  });

  it('keeps a short Azure phrase the Whisper noise filter would drop', async () => {
    const { service, azure } = build(true);
    azure.transcribe.mockResolvedValue({ text: 'дякую', language: 'uk-UA' });

    const result = await service.transcribe('user-1', { audioBase64: audio });

    expect(result.transcript).toBe('дякую');
  });

  it('stays on Groq when Azure is not configured', async () => {
    const { service, azure, groq } = build(false);

    const result = await service.transcribe('user-1', {
      audioBase64: audio,
      mimeType: 'audio/webm',
    });

    expect(result.transcript).toBe('до мешка');
    expect(azure.transcribe).not.toHaveBeenCalled();
    expect(groq.transcribe).toHaveBeenCalledWith(
      expect.any(Buffer),
      'voice.webm',
      'audio/webm',
      'uk',
      expect.stringContaining('Голосовий календар'),
    );
  });
});
