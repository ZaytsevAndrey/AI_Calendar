import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const GROQ_AUDIO_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';

/** Full v3 is slower/costlier than turbo but materially better for uk/ru short speech. */
const DEFAULT_STT_MODEL = 'whisper-large-v3';
/** Free-tier production chat model. Llama 3.3/3.1 on Groq are enterprise-only. */
const DEFAULT_LLM_MODEL = 'openai/gpt-oss-20b';
const FALLBACK_LLM_MODEL = 'openai/gpt-oss-120b';
/** Free-tier TPM is 8000. One voice prompt is ~3000, so a short wait usually fits. */
const RATE_LIMIT_RETRIES = 2;
const RATE_LIMIT_WAIT_MIN_MS = 400;
const RATE_LIMIT_WAIT_MAX_MS = 6000;

type GroqChatPayload = {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string; failed_generation?: string } | string;
  message?: string;
  failed_generation?: string;
};

@Injectable()
export class GroqClient {
  private readonly logger = new Logger(GroqClient.name);

  constructor(private readonly config: ConfigService) {}

  private apiKey(): string {
    const key = this.config.get<string>('GROQ_API_KEY')?.trim();
    if (!key) {
      throw new ServiceUnavailableException(
        'AI features are not configured. Set GROQ_API_KEY on the API service.',
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
    /** ISO-639-1 hint for Whisper (e.g. `en`, `uk`). Improves accuracy when known. */
    language?: string,
    /** Same-language vocabulary / style hint (max ~224 tokens). */
    prompt?: string,
  ): Promise<{ text: string; language?: string }> {
    const form = new FormData();
    const bytes = new Uint8Array(buffer);
    form.append('file', new Blob([bytes], { type: mimeType }), filename);
    form.append('model', this.sttModel());
    form.append('response_format', 'verbose_json');
    form.append('temperature', '0');
    const lang = language?.trim().toLowerCase().slice(0, 2);
    if (lang && /^[a-z]{2}$/.test(lang)) {
      form.append('language', lang);
    }
    const hint = prompt?.replace(/\s+/g, ' ').trim();
    if (hint) {
      form.append('prompt', hint.slice(0, 800));
    }

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
    const localBase = this.localLlmBase();
    if (localBase) return this.completeLocalJson(localBase, systemPrompt, userPrompt);

    const models = [this.llmModel(), FALLBACK_LLM_MODEL].filter(
      (model, index, list) => list.indexOf(model) === index,
    );
    let lastError = 'Groq LLM failed';

    for (let i = 0; i < models.length; i += 1) {
      const model = models[i];
      const hasNext = i < models.length - 1;

      const strict = await this.chatWithRateLimitRetry(
        model,
        systemPrompt,
        userPrompt,
        true,
      );
      if (strict.ok) return strict.content;
      lastError = strict.error;
      logFailedGeneration(this.logger, strict.failedGeneration);

      // json_object mode is flaky on longer voice prompts — retry same model without it.
      if (isFailedJsonGeneration(lastError)) {
        const soft = await this.chatWithRateLimitRetry(
          model,
          systemPrompt,
          userPrompt,
          false,
        );
        if (soft.ok) {
          this.logger.warn(
            `Groq JSON mode failed on ${model}; recovered without response_format`,
          );
          return soft.content;
        }
        lastError = soft.error;
        logFailedGeneration(this.logger, soft.failedGeneration);
      }

      if (hasNext && shouldTryNextModel(strict.status, lastError)) {
        this.logger.warn(`${lastError}; trying fallback model`);
        continue;
      }
      this.logger.warn(lastError);
      throw this.llmUnavailable(lastError, strict.status);
    }

    throw this.llmUnavailable(lastError, 503);
  }

  private localLlmBase(): string {
    return this.config.get<string>('LLM_BASE_URL')?.trim().replace(/\/$/, '') || '';
  }

  /** Home Ollama. Speech-to-text stays on Groq. */
  private async completeLocalJson(
    base: string,
    systemPrompt: string,
    userPrompt: string,
  ): Promise<string> {
    const model = this.config.get<string>('LLM_MODEL')?.trim() || 'calendar-voice';
    const strict = await this.ollamaChat(base, model, systemPrompt, userPrompt, true);
    if (strict.ok && looksLikeJson(strict.content)) return strict.content;
    const soft = await this.ollamaChat(base, model, systemPrompt, userPrompt, false);
    if (soft.ok) {
      this.logger.warn(`Local JSON mode failed on ${model}; recovered without format`);
      return soft.content;
    }
    const error = strict.ok ? soft.error : strict.error;
    this.logger.warn(error);
    throw new ServiceUnavailableException(error);
  }

  private async ollamaChat(
    base: string,
    model: string,
    systemPrompt: string,
    userPrompt: string,
    jsonFormat: boolean,
  ): Promise<{ ok: true; content: string } | { ok: false; error: string; status: number }> {
    let response: Response;
    try {
      response = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: false,
          think: false,
          ...(jsonFormat ? { format: 'json' } : {}),
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          options: { temperature: 0.1, num_ctx: 8192 },
        }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `Local LLM failed: ${message}`, status: 503 };
    }
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
      message?: { content?: string };
    };
    if (!response.ok) {
      return {
        ok: false,
        error: payload.error || `Local LLM failed (${response.status})`,
        status: response.status,
      };
    }
    const content = stripThink(payload.message?.content || '');
    if (!content) {
      return { ok: false, error: 'Local LLM returned an empty response', status: 502 };
    }
    return { ok: true, content };
  }

  private llmUnavailable(message: string, status: number): ServiceUnavailableException {
    if (isRateLimit(status, message)) {
      return new ServiceUnavailableException({
        code: 'VOICE_RATE_LIMIT',
        message: 'Voice is busy. Try again in a few seconds.',
      });
    }
    return new ServiceUnavailableException(message);
  }

  /** TPM 429: wait out the window Groq names, then repeat the same model. */
  private async chatWithRateLimitRetry(
    model: string,
    systemPrompt: string,
    userPrompt: string,
    jsonObject: boolean,
  ) {
    let result = await this.chatCompletion(
      model,
      systemPrompt,
      userPrompt,
      jsonObject,
    );
    for (
      let attempt = 0;
      attempt < RATE_LIMIT_RETRIES && !result.ok && result.status === 429;
      attempt += 1
    ) {
      const wait = result.retryAfterMs ?? 4000;
      this.logger.warn(
        `Groq rate limit on ${model}; retrying in ${wait}ms`,
      );
      await this.sleep(wait);
      result = await this.chatCompletion(
        model,
        systemPrompt,
        userPrompt,
        jsonObject,
      );
    }
    return result;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async chatCompletion(
    model: string,
    systemPrompt: string,
    userPrompt: string,
    jsonObject: boolean,
  ): Promise<
    | { ok: true; content: string }
    | {
        ok: false;
        error: string;
        status: number;
        retryAfterMs?: number;
        failedGeneration?: string;
      }
  > {
    const body: Record<string, unknown> = {
      model,
      temperature: 0.1,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    };
    if (jsonObject) {
      body.response_format = { type: 'json_object' };
    }

    const response = await fetch(GROQ_CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({}))) as GroqChatPayload;
    if (!response.ok) {
      const error = groqErrorMessage(payload, response.status, 'LLM');
      return {
        ok: false,
        error,
        status: response.status,
        retryAfterMs:
          response.status === 429
            ? rateLimitWaitMs(error, response.headers.get('retry-after'))
            : undefined,
        failedGeneration: readFailedGeneration(payload),
      };
    }
    const content = payload.choices?.[0]?.message?.content?.trim();
    if (!content) {
      return {
        ok: false,
        error: 'Groq LLM returned an empty response',
        status: response.status,
      };
    }
    return { ok: true, content };
  }
}

function stripThink(content: string): string {
  return content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

function looksLikeJson(content: string): boolean {
  const trimmed = content.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('```');
}

function groqErrorMessage(
  payload: {
    error?: { message?: string; failed_generation?: string } | string;
    message?: string;
  },
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

function readFailedGeneration(payload: GroqChatPayload): string | undefined {
  const fromError =
    payload.error &&
    typeof payload.error === 'object' &&
    typeof payload.error.failed_generation === 'string'
      ? payload.error.failed_generation
      : undefined;
  const top =
    typeof payload.failed_generation === 'string'
      ? payload.failed_generation
      : undefined;
  const raw = (fromError || top || '').trim();
  return raw || undefined;
}

function logFailedGeneration(logger: Logger, snippet?: string): void {
  if (!snippet) return;
  logger.warn(
    `Groq failed_generation (truncated): ${snippet.slice(0, 400).replace(/\s+/g, ' ')}`,
  );
}

function isFailedJsonGeneration(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('failed to generate json') ||
    lower.includes('failed_generation')
  );
}

/** Free-tier "try again in 3.645s" or a Retry-After header, capped so a turn stays short. */
export function rateLimitWaitMs(
  message: string,
  retryAfterHeader: string | null,
): number {
  let seconds: number | null = null;
  if (retryAfterHeader) {
    const header = Number(retryAfterHeader);
    if (Number.isFinite(header) && header >= 0) seconds = header;
  }
  if (seconds == null) {
    const match = message.match(/try again in\s+([\d.]+)\s*s/i);
    if (match) {
      const parsed = Number(match[1]);
      if (Number.isFinite(parsed) && parsed >= 0) seconds = parsed;
    }
  }
  if (seconds == null) return 4000;
  return Math.min(
    RATE_LIMIT_WAIT_MAX_MS,
    Math.max(RATE_LIMIT_WAIT_MIN_MS, Math.ceil(seconds * 1000) + 250),
  );
}

function isRateLimit(status: number, message: string): boolean {
  return status === 429 || /rate limit reached/i.test(message);
}

function shouldTryNextModel(status: number, message: string): boolean {
  if (status === 429) return true;
  const lower = message.toLowerCase();
  if (isFailedJsonGeneration(message)) return true;
  return (
    (status === 400 || status === 403 || status === 404 || status === 503) &&
    (lower.includes('does not exist') ||
      lower.includes('do not have access') ||
      lower.includes('model_not_found') ||
      lower.includes('failed to generate json'))
  );
}
