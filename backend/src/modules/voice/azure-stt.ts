import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { traceStep } from '../../common/voice-trace';
import { azureSpeechCredentials } from './azure-speech.config';

const AZURE_STT_TIMEOUT_MS = 45_000;

/** Short-audio REST locale. No phrase list and no rewrite instructions. */
export function azureSpeechLocale(language?: string | null): string {
  const lang = (language || '').trim().toLowerCase();
  if (lang.startsWith('uk')) return 'uk-UA';
  if (lang.startsWith('ru')) return 'ru-RU';
  if (lang.startsWith('en')) return 'en-US';
  return 'en-US';
}

type AzureRecognition = {
  RecognitionStatus?: string;
  DisplayText?: string;
  NBest?: { Display?: string; Lexical?: string }[];
  error?: { message?: string } | string;
  message?: string;
};

@Injectable()
export class AzureSttClient {
  private readonly logger = new Logger(AzureSttClient.name);

  constructor(private readonly config: ConfigService) {}

  enabled(): boolean {
    return azureSpeechCredentials(this.config) != null;
  }

  /**
   * Free F0 short-audio REST. `wav` must already be 16 kHz mono PCM.
   * NoMatch and initial silence are an empty transcript, not an error.
   */
  async transcribe(
    wav: Buffer,
    language?: string | null,
  ): Promise<{ text: string; language: string }> {
    const auth = azureSpeechCredentials(this.config);
    if (!auth) {
      throw new ServiceUnavailableException('Azure Speech is not configured');
    }
    const { key, region } = auth;
    const locale = azureSpeechLocale(language);
    const url =
      `https://${region}.stt.speech.microsoft.com` +
      `/speech/recognition/conversation/cognitiveservices/v1` +
      `?language=${encodeURIComponent(locale)}&format=detailed`;

    let response: Response;
    try {
      response = await traceStep('other', 'azure-stt', locale, () =>
        fetch(url, {
          method: 'POST',
          headers: {
            'Ocp-Apim-Subscription-Key': key,
            'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
            Accept: 'application/json',
          },
          body: new Uint8Array(wav),
          signal: AbortSignal.timeout(AZURE_STT_TIMEOUT_MS),
        }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Azure STT request failed: ${message}`);
      throw new ServiceUnavailableException('Azure Speech did not answer');
    }

    const payload = (await response.json().catch(() => ({}))) as AzureRecognition;
    if (!response.ok) {
      const detail = azureErrorMessage(payload, response.status);
      this.logger.warn(detail);
      throw new ServiceUnavailableException(detail);
    }

    const status = payload.RecognitionStatus || '';
    if (status === 'Success') {
      const best = payload.NBest?.[0];
      const text = (payload.DisplayText || best?.Display || best?.Lexical || '').trim();
      return { text, language: locale };
    }
    if (
      status === 'NoMatch' ||
      status === 'InitialSilenceTimeout' ||
      status === 'BabbleTimeout'
    ) {
      return { text: '', language: locale };
    }
    const detail = azureErrorMessage(payload, response.status);
    this.logger.warn(`Azure STT status ${status || 'unknown'}: ${detail}`);
    throw new ServiceUnavailableException(detail);
  }

}

function azureErrorMessage(payload: AzureRecognition, status: number): string {
  const nested = payload.error;
  const fromBody =
    (typeof nested === 'string' ? nested : nested?.message) ||
    payload.message ||
    '';
  const detail = fromBody.replace(/\s+/g, ' ').trim().slice(0, 240);
  if (detail) return `Azure Speech failed (${status}): ${detail}`;
  return `Azure Speech failed (${status})`;
}
