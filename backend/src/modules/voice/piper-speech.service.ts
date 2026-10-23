import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { traceStep } from '../../common/voice-trace';

@Injectable()
export class PiperSpeechService {
  private readonly logger = new Logger(PiperSpeechService.name);

  constructor(private readonly config: ConfigService) {}

  async synthesize(text: string, language?: string | null): Promise<Buffer> {
    const base = this.config.get<string>('PIPER_URL')?.trim().replace(/\/$/, '');
    if (!base) {
      throw new ServiceUnavailableException({
        code: 'PIPER_UNAVAILABLE',
        message: 'Local speech is not configured.',
      });
    }
    const trimmed = text.replace(/\s+/g, ' ').trim();
    if (!trimmed) {
      throw new ServiceUnavailableException({
        code: 'PIPER_UNAVAILABLE',
        message: 'Nothing to speak.',
      });
    }

    let wav: Buffer;
    try {
      wav = await traceStep('other', 'speak', 'piper', async () => {
        const response = await fetch(`${base}/speak`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: trimmed.slice(0, 2000),
            language: language || 'en',
          }),
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) {
          throw new Error(`status ${response.status}`);
        }
        return Buffer.from(await response.arrayBuffer());
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Piper request failed: ${message}`);
      throw new ServiceUnavailableException({
        code: 'PIPER_UNAVAILABLE',
        message: 'Local speech is unavailable.',
      });
    }
    if (wav.length < 44) {
      throw new ServiceUnavailableException({
        code: 'PIPER_UNAVAILABLE',
        message: 'Local speech returned empty audio.',
      });
    }
    return wav;
  }
}
