import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const GROQ_AUDIO_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';

const DEFAULT_STT_MODEL = 'whisper-large-v3-turbo';
const DEFAULT_LLM_MODEL = 'llama-3.3-70b-versatile';
const FALLBACK_LLM_MODEL = 'llama-3.1-8b-instant';

@Injectable()
export class GroqClient {
  private readonly logger = new Logger(GroqClient.name);

  constructor(private readonly config: ConfigService) {}

  private apiKey(): string {
    const key = this.config.get<string>('GROQ_API_KEY')?.trim();
    if (!key) {
      throw new ServiceUnavailableException(
        'Voice features are not configured. Set GROQ_API_KEY on the API service.',
      );
    }
    return key;
  }

  sttModel(): string {
    return this.config.get<string>('GROQ_STT_MODEL')?.trim() || DEFAULT_STT_MODEL;
  }

  llmModel(): string {
    return this.config.get<string>('GROQ_LLM_MODEL')?.trim() || DEFAULT_LLM_MODEL;
  }

  async transcribe(
    buffer: Buffer,
    filename: string,
    mimeType: string,
  ): Promise<{ text: string; language?: string }> {
    const form = new FormData();
    const bytes = new Uint8Array(buffer);
    form.append('file', new Blob([bytes], { type: mimeType }), filename);
    form.append('model', this.sttModel());
    form.append('response_format', 'verbose_json');
    form.append('temperature', '0');

    const response = await fetch(GROQ_AUDIO_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey()}` },
      body: form,
    });
    const payload = (await response.json().catch(() => ({}))) as {
      text?: string;
      language?: string;
      error?: { message?: string };
    };
    if (!response.ok) {
      const message = payload.error?.message || `Groq STT failed (${response.status})`;
      this.logger.warn(message);
      throw new ServiceUnavailableException(message);
    }
    const text = (payload.text || '').trim();
    if (!text) {
      throw new ServiceUnavailableException('Could not transcribe audio');
    }
    return { text, language: payload.language };
  }

  async completeJson(systemPrompt: string, userPrompt: string): Promise<string> {
    const models = [this.llmModel(), FALLBACK_LLM_MODEL].filter(
      (model, index, list) => list.indexOf(model) === index,
    );
    let lastError = 'Groq LLM failed';

    for (const model of models) {
      const response = await fetch(GROQ_CHAT_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        choices?: Array<{ message?: { content?: string } }>;
        error?: { message?: string };
      };
      if (response.status === 429 && model !== models[models.length - 1]) {
        this.logger.warn(`Groq rate-limited on ${model}; trying fallback model`);
        lastError = payload.error?.message || 'Groq rate limited';
        continue;
      }
      if (!response.ok) {
        lastError = payload.error?.message || `Groq LLM failed (${response.status})`;
        this.logger.warn(lastError);
        throw new ServiceUnavailableException(lastError);
      }
      const content = payload.choices?.[0]?.message?.content?.trim();
      if (!content) {
        throw new ServiceUnavailableException('Groq LLM returned an empty response');
      }
      return content;
    }

    throw new ServiceUnavailableException(lastError);
  }
}
