import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { traceStep } from '../../common/voice-trace';
import { azureSpeechCredentials } from './azure-speech.config';

const AZURE_TTS_TIMEOUT_MS = 20_000;
const MAX_TTS_CHARS = 2000;

/** Neural voices on the same F0 resource as speech-to-text. */
export function azureTtsVoice(language?: string | null): {
  locale: string;
  voice: string;
} {
  const lang = (language || '').trim().toLowerCase();
  if (lang.startsWith('uk')) {
    return { locale: 'uk-UA', voice: 'uk-UA-PolinaNeural' };
  }
  if (lang.startsWith('ru')) {
    return { locale: 'ru-RU', voice: 'ru-RU-SvetlanaNeural' };
  }
  return { locale: 'en-US', voice: 'en-US-GuyNeural' };
}

export function escapeSsml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

@Injectable()
export class AzureTtsClient {
  private readonly logger = new Logger(AzureTtsClient.name);

  constructor(private readonly config: ConfigService) {}

  enabled(): boolean {
    return azureSpeechCredentials(this.config) != null;
  }

  /** Neural TTS. Returns a WAV buffer. Uses the STT key and region. */
  async synthesize(text: string, language?: string | null): Promise<Buffer> {
    const auth = azureSpeechCredentials(this.config);
    if (!auth) {
      throw new ServiceUnavailableException('Azure Speech is not configured');
    }
    const spoken = text.replace(/\s+/g, ' ').trim().slice(0, MAX_TTS_CHARS);
    if (!spoken) {
      throw new ServiceUnavailableException('Nothing to speak.');
    }
    const { locale, voice } = azureTtsVoice(language);
    const ssml =
      `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${locale}">` +
      `<voice name="${voice}">${escapeSsml(spoken)}</voice></speak>`;
    const url = `https://${auth.region}.tts.speech.microsoft.com/cognitiveservices/v1`;

    let response: Response;
    try {
      response = await traceStep('other', 'azure-tts', voice, () =>
        fetch(url, {
          method: 'POST',
          headers: {
            'Ocp-Apim-Subscription-Key': auth.key,
            'Content-Type': 'application/ssml+xml',
            'X-Microsoft-OutputFormat': 'riff-24khz-16bit-mono-pcm',
            'User-Agent': 'luefy',
          },
          body: ssml,
          signal: AbortSignal.timeout(AZURE_TTS_TIMEOUT_MS),
        }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Azure TTS request failed: ${message}`);
      throw new ServiceUnavailableException('Azure Speech did not answer');
    }

    if (!response.ok) {
      const detail = (await response.text().catch(() => ''))
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 240);
      const message = detail
        ? `Azure Speech failed (${response.status}): ${detail}`
        : `Azure Speech failed (${response.status})`;
      this.logger.warn(message);
      throw new ServiceUnavailableException(message);
    }

    const wav = Buffer.from(await response.arrayBuffer());
    if (wav.length < 44 || wav.subarray(0, 4).toString() !== 'RIFF') {
      throw new ServiceUnavailableException('Azure Speech returned empty audio');
    }
    return wav;
  }
}
