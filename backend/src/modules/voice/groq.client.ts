import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const GROQ_AUDIO_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';

const DEFAULT_STT_MODEL = 'whisper-large-v3-turbo';
/** Free-tier production chat model. Llama 3.3/3.1 on Groq are enterprise-only. */
const DEFAULT_LLM_MODEL = 'openai/gpt-oss-20b';
const FALLBACK_LLM_MODEL = 'openai/gpt-oss-120b';

type GroqChatPayload = {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string } | string;
  message?: string;
};

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
      error?: { message?: string } | string;
      message?: string;
    };
    if (!response.ok) {
      const message = groqErrorMessage(payload, response.status, 'STT');
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

    for (let i = 0; i < models.length; i += 1) {
      const model = models[i];
      const hasNext = i < models.length - 1;
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
      const payload = (await response.json().catch(() => ({}))) as GroqChatPayload;
      if (!response.ok) {
        lastError = groqErrorMessage(payload, response.status, 'LLM');
        if (hasNext && shouldTryNextModel(response.status, lastError)) {
          this.logger.warn(`${lastError}; trying fallback model`);
          continue;
        }
        this.logger.warn(lastError);
        throw new ServiceUnavailableException(lastError);
      }
      const content = payload.choices?.[0]?.message?.content?.trim();
      if (!content) {
        lastError = 'Groq LLM returned an empty response';
        if (hasNext) {
          this.logger.warn(`${lastError}; trying fallback model`);
          continue;
        }
        throw new ServiceUnavailableException(lastError);
      }
      return content;
    }

    throw new ServiceUnavailableException(lastError);
  }
}

function groqErrorMessage(
  payload: { error?: { message?: string } | string; message?: string },
  status: number,
  kind: string,
): string {
  const err = payload.error;
  if (typeof err === 'string' && err.trim()) return err.trim();
  if (err && typeof err === 'object' && typeof err.message === 'string') {
    return err.message;
  }
  if (typeof payload.message === 'string' && payload.message.trim()) {
    return payload.message.trim();
  }
  return `Groq ${kind} failed (${status})`;
}

function shouldTryNextModel(status: number, message: string): boolean {
  if (status === 429) return true;
  const lower = message.toLowerCase();
  return (
    (status === 400 || status === 403 || status === 404 || status === 503) &&
    (lower.includes('does not exist') ||
      lower.includes('do not have access') ||
      lower.includes('model_not_found'))
  );
}
