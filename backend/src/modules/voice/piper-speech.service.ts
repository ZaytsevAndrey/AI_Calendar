import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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

    let response: Response;
    try {
      response = await fetch(`${base}/speak`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: trimmed.slice(0, 2000),
          language: language || 'en',
        }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Piper request failed: ${message}`);
      throw new ServiceUnavailableException({
        code: 'PIPER_UNAVAILABLE',
        message: 'Local speech is unavailable.',
      });
    }

    if (!response.ok) {
      this.logger.warn(`Piper responded ${response.status}`);
      throw new ServiceUnavailableException({
        code: 'PIPER_UNAVAILABLE',
        message: 'Local speech is unavailable.',
      });
    }
    const wav = Buffer.from(await response.arrayBuffer());
    if (wav.length < 44) {
      throw new ServiceUnavailableException({
        code: 'PIPER_UNAVAILABLE',
        message: 'Local speech returned empty audio.',
      });
    }
    return wav;
  }
}
