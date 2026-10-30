import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AsyncLocalStorage } from 'async_hooks';
import {
  annotateLatestStep,
  armNextLlmReason,
  clipVoiceBody,
  currentVoiceTrace,
  noteVoiceStep,
  traceStep,
  voiceComponentForStep,
  voiceTraceBodiesEnabled,
} from '../../common/voice-trace';
import {
  DEFAULT_DEEPSEEK_PLANNER_MODEL,
  deepseekPlannerCall,
  deepseekPlannerResult,
  type DeepSeekPlannerPayload,
} from './deepseek-planner';
import {
  DEFAULT_GEMINI_PLANNER_MODEL,
  geminiPlannerCall,
  geminiPlannerResult,
  type GeminiPlannerPayload,
} from './gemini-planner';
import {
  DEFAULT_QWEN_PLANNER_MODEL,
  qwenPlannerCall,
  qwenPlannerResult,
  type QwenPlannerPayload,
} from './qwen-planner';

const GROQ_AUDIO_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';

/** Full v3 is slower/costlier than turbo but materially better for uk/ru short speech. */
const DEFAULT_STT_MODEL = 'whisper-large-v3';
/** Free-tier production chat model. Llama 3.3/3.1 on Groq are enterprise-only. */
const DEFAULT_LLM_MODEL = 'openai/gpt-oss-20b';
const FALLBACK_LLM_MODEL = 'openai/gpt-oss-120b';
/** Companion planner (multi-intent split, day-plan dialogue). Falls back to the chat model. */
const DEFAULT_PLANNER_MODEL = 'openai/gpt-oss-120b';

export type GroqCompletionRole = 'parse' | 'planner';

/** One Groq chat call recorded while VOICE_EVAL_PACE=1. */
export type GroqEvalSpend = {
  at: number;
  model: string;
  keyIndex: number;
  tokens: number;
  role: GroqCompletionRole;
  label: string;
};

const EVAL_PACE_WINDOW_MS = 60_000;

/**
 * How long to wait so `need` tokens fit this key+model's minute window.
 * A request larger than the ceiling returns 0: waiting cannot make it fit.
 */
export function tokenPaceWaitMs(input: {
  now: number;
  limit: number;
  need: number;
  spends: Array<{ at: number; tokens: number }>;
}): number {
  if (input.need <= 0 || input.limit <= 0 || input.need > input.limit) return 0;
  const window = input.spends
    .filter((row) => input.now - row.at < EVAL_PACE_WINDOW_MS && row.tokens > 0)
    .sort((a, b) => a.at - b.at);
  const used = window.reduce((sum, row) => sum + row.tokens, 0);
  if (used + input.need <= input.limit) return 0;
  let dropped = 0;
  let waitUntil = input.now;
  for (const row of window) {
    dropped += row.tokens;
    waitUntil = row.at + EVAL_PACE_WINDOW_MS + 250;
    if (used - dropped + input.need <= input.limit) break;
  }
  return Math.max(0, waitUntil - input.now);
}
/** Free-tier TPM is 8000. One voice prompt is ~3000, so a short wait usually fits. */
const RATE_LIMIT_RETRIES = 2;
/** Understanding waits on this call. A silent Groq must fail, not hang the turn. */
const GROQ_CHAT_TIMEOUT_MS = 25_000;
const RATE_LIMIT_WAIT_MIN_MS = 400;
const RATE_LIMIT_WAIT_MAX_MS = 6000;
/** Safety cap when scanning GROQ_API_KEY_N. */
const MAX_DISCOVERED_KEYS = 64;

type GroqChatPayload = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; failed_generation?: string } | string;
  message?: string;
  failed_generation?: string;
};

type GroqRequestContext = {
  keyIndex: number;
  tokensUsed: number;
  /** Usage of the most recent completion in this request, until the caller takes it. */
  lastCompletion: LlmCompletionUsage | null;
};

/** What one model call cost in tokens, as the provider reported it. The split is null when it gave only a total. */
export type LlmCompletionUsage = {
  model: string;
  totalTokens: number;
  promptTokens: number | null;
  completionTokens: number | null;
};

/**
 * `GROQ_API_KEY`, then `GROQ_API_KEY_2`, `GROQ_API_KEY_3`, … while set.
 * Stops at the first gap so operators can add keys without a fixed ceiling.
 */
export function discoverGroqKeyNames(
  get: (name: string) => string | undefined,
): string[] {
  const names: string[] = [];
  const first = get('GROQ_API_KEY')?.trim();
  if (first) names.push('GROQ_API_KEY');
  for (let n = 2; n <= MAX_DISCOVERED_KEYS; n += 1) {
    const name = `GROQ_API_KEY_${n}`;
    if (!get(name)?.trim()) break;
    names.push(name);
  }
  return names;
}

@Injectable()
export class GroqClient {
  private readonly logger = new Logger(GroqClient.name);
  /** Index of the key pinned for the current eval scenario. -1 until the first pin. */
  private pinnedKeyIndex = -1;
  private readonly evalSpendsLog: GroqEvalSpend[] = [];
  private readonly evalTpmLimit = new Map<string, number>();
  private evalMeta: { role: GroqCompletionRole; label: string } | null = null;
  private readonly requestAls = new AsyncLocalStorage<GroqRequestContext>();

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

  /**
   * Rotate when 2+ keys are configured, or when create-eval sets GROQ_ROTATE_KEYS.
   */
  private rotating(): boolean {
    const flag = this.config.get<string>('GROQ_ROTATE_KEYS')?.trim().toLowerCase();
    if (flag === '1' || flag === 'true') return true;
    return this.activeKeyNames().length >= 2;
  }

  /** Key env names retired after a tokens-per-day response. In-memory for this process. */
  private readonly retiredKeyNames = new Set<string>();

  private discoveredKeyNames(): string[] {
    return discoverGroqKeyNames((name) => this.config.get<string>(name));
  }

  private activeKeyNames(): string[] {
    const skipFirst = this.config.get<string>('GROQ_SKIP_FIRST_KEY')?.trim() === '1';
    const skipList = (this.config.get<string>('GROQ_SKIP_KEY_NAMES') || '')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean);
    const retired = new Set([...skipList, ...this.retiredKeyNames]);
    const names = this.discoveredKeyNames();
    const list = skipFirst ? names.filter((name) => name !== 'GROQ_API_KEY') : names;
    return list.filter(
      (name) => !retired.has(name) && Boolean(this.config.get<string>(name)?.trim()),
    );
  }

  private rotationKeys(): string[] {
    if (!this.rotating()) return [];
    return this.activeKeyNames()
      .map((name) => this.config.get<string>(name)?.trim())
      .filter((key): key is string => Boolean(key));
  }

  /**
   * Drop the key pinned for the current scenario until this process ends.
   * Used when that org is out of daily tokens.
   */
  retirePinnedKey(): { remaining: number; retiredName: string | null } {
    const names = this.activeKeyNames();
    if (names.length === 0) return { remaining: 0, retiredName: null };
    const index = this.currentKeyIndex() % Math.max(names.length, 1);
    const retiredName = names[index] ?? null;
    if (retiredName) this.retiredKeyNames.add(retiredName);
    this.pinnedKeyIndex = -1;
    const ctx = this.requestAls.getStore();
    if (ctx) ctx.keyIndex = 0;
    return { remaining: this.activeKeyNames().length, retiredName };
  }

  pinnedKeyName(): string | null {
    const names = this.activeKeyNames();
    if (!this.rotating() || names.length === 0) return null;
    const index = this.currentKeyIndex() % names.length;
    return names[index] ?? null;
  }

  retireNamedKey(name: string): { remaining: number } {
    if (name) this.retiredKeyNames.add(name);
    this.pinnedKeyIndex = -1;
    const ctx = this.requestAls.getStore();
    if (ctx) ctx.keyIndex = 0;
    return { remaining: this.activeKeyNames().length };
  }

  /**
   * Pin the next org for every chat call until the next pin.
   * One create scenario is router + specialist, so both stay on the same key.
   */
  pinNextKey(): { index: number; count: number } {
    const keys = this.rotationKeys();
    if (keys.length === 0) return { index: 0, count: 1 };
    this.pinnedKeyIndex = (this.pinnedKeyIndex + 1) % keys.length;
    const ctx = this.requestAls.getStore();
    if (ctx) ctx.keyIndex = this.pinnedKeyIndex;
    return { index: this.pinnedKeyIndex, count: keys.length };
  }

  /** Same org as the last pin. Used when a short daily window should not rotate the key. */
  currentPin(): { index: number; count: number } {
    const keys = this.rotationKeys();
    if (keys.length === 0) return { index: 0, count: 1 };
    const index = this.currentKeyIndex() % keys.length;
    return { index, count: keys.length };
  }

  /**
   * Run Groq calls under a fixed key index (voice session pin).
   * Key hops inside the callback update the returned `keyIndex`.
   */
  async runWithPin<T>(
    keyIndex: number,
    fn: () => Promise<T>,
  ): Promise<{ value: T; keyIndex: number; tokensUsed: number }> {
    const keys = this.rotationKeys();
    const safeIndex =
      keys.length === 0 ? 0 : ((keyIndex % keys.length) + keys.length) % keys.length;
    const ctx: GroqRequestContext = { keyIndex: safeIndex, tokensUsed: 0, lastCompletion: null };
    this.pinnedKeyIndex = safeIndex;
    const value = await this.requestAls.run(ctx, fn);
    return { value, keyIndex: ctx.keyIndex, tokensUsed: ctx.tokensUsed };
  }

  /** True while inside `runWithPin` (nested parse must not open a second context). */
  isInPinContext(): boolean {
    return Boolean(this.requestAls.getStore());
  }

  private currentKeyIndex(): number {
    const ctx = this.requestAls.getStore();
    if (ctx) return ctx.keyIndex;
    return this.pinnedKeyIndex < 0 ? 0 : this.pinnedKeyIndex;
  }

  private chatKey(): string {
    const keys = this.rotationKeys();
    if (keys.length === 0) return this.apiKey();
    const index = this.currentKeyIndex() % keys.length;
    return keys[index];
  }

  private canHopKey(): boolean {
    return this.rotationKeys().length >= 2;
  }

  /** Advance pin after TPM; keep eval global index in sync. */
  private advancePin(): void {
    const keys = this.rotationKeys();
    if (keys.length < 2) return;
    const next = (this.currentKeyIndex() + 1) % keys.length;
    this.pinnedKeyIndex = next;
    const ctx = this.requestAls.getStore();
    if (ctx) ctx.keyIndex = next;
  }

  private recordTokens(total: number | undefined): void {
    if (total == null || !Number.isFinite(total) || total <= 0) return;
    const ctx = this.requestAls.getStore();
    if (ctx) ctx.tokensUsed += Math.floor(total);
  }

  /** Remember the usage of the completion that just returned, for `takeLastCompletion`. */
  private noteCompletion(model: string, usage: { tokens: number | undefined; promptTokens?: number | null; completionTokens?: number | null }): void {
    const ctx = this.requestAls.getStore();
    if (!ctx) return;
    const total = usage.tokens != null && Number.isFinite(usage.tokens) ? Math.max(0, Math.floor(usage.tokens)) : 0;
    ctx.lastCompletion = {
      model,
      totalTokens: total,
      promptTokens: usage.promptTokens ?? null,
      completionTokens: usage.completionTokens ?? null,
    };
  }

  /**
   * The usage of the most recent completion in this request, then nothing until the next
   * call. Null outside a pin context or when the provider reported no usage (VR-24).
   */
  takeLastCompletion(): LlmCompletionUsage | null {
    const ctx = this.requestAls.getStore();
    if (!ctx) return null;
    const usage = ctx.lastCompletion;
    ctx.lastCompletion = null;
    return usage;
  }

  /** Keys still usable after a tokens-per-day retirement. */
  liveKeyCount(): number {
    return this.activeKeyNames().length;
  }

  evalSpends(): readonly GroqEvalSpend[] {
    return this.evalSpendsLog;
  }

  private evalPacing(): boolean {
    const flag = process.env.VOICE_EVAL_PACE?.trim().toLowerCase();
    return flag === '1' || flag === 'true';
  }

  private async paceForEval(model: string, systemPrompt: string, userPrompt: string): Promise<void> {
    if (!this.evalPacing()) return;
    const keyIndex = this.currentKeyIndex();
    const bucket = `${keyIndex}:${model}`;
    const limit = this.evalTpmLimit.get(bucket) ?? 8_000;
    const recent = this.evalSpendsLog.filter(
      (row) => row.keyIndex === keyIndex && row.model === model,
    );
    const peak = recent.slice(-4).reduce((max, row) => Math.max(max, row.tokens), 0);
    const estimate = Math.max(
      Math.ceil((systemPrompt.length + userPrompt.length) / 3.5) + 800,
      peak,
    );
    const now = Date.now();
    const wait = tokenPaceWaitMs({
      now,
      limit,
      need: estimate,
      spends: this.evalSpendsLog.filter(
        (row) => row.keyIndex === keyIndex && row.model === model,
      ),
    });
    if (estimate > limit) {
      this.logger.warn(
        `Eval pace: ${model} prompt estimate ${estimate} exceeds TPM ${limit}`,
      );
      return;
    }
    if (wait > 0) {
      this.logger.warn(`Eval pace ${model} key ${keyIndex}: sleep ${wait}ms`);
      await this.sleep(wait);
    }
  }

  private noteEvalSpend(
    model: string,
    tokens: number | undefined,
    limitHeader: string | null,
  ): void {
    if (!this.evalPacing()) return;
    const keyIndex = this.currentKeyIndex();
    const bucket = `${keyIndex}:${model}`;
    const limit = Number(limitHeader);
    if (Number.isFinite(limit) && limit > 0) this.evalTpmLimit.set(bucket, limit);
    const used = Math.floor(tokens ?? 0);
    if (used <= 0) return;
    this.evalSpendsLog.push({
      at: Date.now(),
      model,
      keyIndex,
      tokens: used,
      role: this.evalMeta?.role ?? 'parse',
      label: this.evalMeta?.label ?? 'parse',
    });
  }

  sttModel(): string {
    return this.config.get<string>('GROQ_STT_MODEL')?.trim() || DEFAULT_STT_MODEL;
  }

  llmModel(): string {
    return this.config.get<string>('GROQ_LLM_MODEL')?.trim() || DEFAULT_LLM_MODEL;
  }

  plannerModel(): string {
    return (
      this.config.get<string>('GROQ_PLANNER_MODEL')?.trim() || DEFAULT_PLANNER_MODEL
    );
  }

  private modelsFor(role: GroqCompletionRole): string[] {
    const list =
      role === 'planner'
        ? [this.plannerModel(), this.llmModel()]
        : this.rotating()
          ? [this.llmModel()]
          : [this.llmModel(), FALLBACK_LLM_MODEL];
    return list.filter((model, index) => list.indexOf(model) === index);
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
    const buildForm = () => {
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
      return form;
    };

    let result = await this.trackStt(() => this.transcribeOnce(buildForm));
    if (!result.ok && result.status === 429) {
      if (isDailyTokenLimit(result.error) && this.canHopKey()) {
        this.retirePinnedKey();
        if (this.rotationKeys().length >= 1) {
          this.pinnedKeyIndex = 0;
          const ctx = this.requestAls.getStore();
          if (ctx) ctx.keyIndex = 0;
          this.logger.warn('Groq STT TPD; hopping to next key');
          result = await this.trackStt(() => this.transcribeOnce(buildForm));
        }
      } else if (!isDailyTokenLimit(result.error)) {
        for (
          let attempt = 0;
          attempt < RATE_LIMIT_RETRIES && !result.ok && result.status === 429;
          attempt += 1
        ) {
          const wait = result.retryAfterMs ?? 4000;
          this.logger.warn(`Groq STT rate limit; retrying in ${wait}ms`);
          await this.sleep(wait);
          result = await this.trackStt(() => this.transcribeOnce(buildForm));
        }
        if (!result.ok && result.status === 429 && this.canHopKey()) {
          this.advancePin();
          this.logger.warn('Groq STT TPM; hopping to next key');
          result = await this.trackStt(() => this.transcribeOnce(buildForm));
        }
      }
    }

    if (!result.ok) {
      this.logger.warn(result.error);
      throw this.llmUnavailable(result.error, result.status);
    }
    return { text: result.text, language: result.language };
  }

  private async transcribeOnce(
    buildForm: () => FormData,
  ): Promise<
    | { ok: true; text: string; language?: string }
    | { ok: false; error: string; status: number; retryAfterMs?: number }
  > {
    let response: Response;
    try {
      response = await fetch(GROQ_AUDIO_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.chatKey()}` },
        body: buildForm(),
        signal: AbortSignal.timeout(GROQ_CHAT_TIMEOUT_MS),
      });
    } catch (err) {
      return {
        ok: false,
        error: fetchFailureMessage(err, 'STT'),
        status: fetchFailureStatus(err),
      };
    }
    const payload = (await response.json().catch(() => ({}))) as {
      text?: string;
      language?: string;
      error?: { message?: string } | string;
      message?: string;
    };
    if (!response.ok) {
      const error = groqErrorMessage(payload, response.status, 'STT');
      return {
        ok: false,
        error,
        status: response.status,
        retryAfterMs:
          response.status === 429
            ? rateLimitWaitMs(error, response.headers.get('retry-after'))
            : undefined,
      };
    }
    const text = (payload.text || '').trim();
    if (!text) {
      return { ok: false, error: 'Could not transcribe audio', status: 502 };
    }
    return { ok: true, text, language: payload.language };
  }

  async completeJson(
    systemPrompt: string,
    userPrompt: string,
    opts?: { role?: GroqCompletionRole; label?: string },
  ): Promise<string> {
    const role = opts?.role ?? 'parse';
    const previousMeta = this.evalMeta;
    this.evalMeta = {
      role,
      label: opts?.label ?? (role === 'planner' ? 'planner' : 'parse'),
    };
    try {
    if (this.deepseekForEveryCall()) {
      const forced = await this.tryDeepSeekPlanner(systemPrompt, userPrompt, true);
      if (forced == null) {
        throw this.llmUnavailable('DeepSeek returned no text', 503);
      }
      return forced;
    }
    if (role === 'planner') {
      const deepseekKey = this.config.get<string>('DEEPSEEK_API_KEY')?.trim();
      const viaDeepSeek = await this.tryDeepSeekPlanner(systemPrompt, userPrompt);
      if (viaDeepSeek != null) return viaDeepSeek;
      if (deepseekKey) armNextLlmReason('model_fallback');
      const qwenKey = this.config.get<string>('QWEN_API_KEY')?.trim();
      const viaQwen = await this.tryQwenPlanner(systemPrompt, userPrompt);
      if (viaQwen != null) return viaQwen;
      if (qwenKey) armNextLlmReason('model_fallback');
      const geminiKey = this.config.get<string>('GEMINI_API_KEY')?.trim();
      const viaGemini = await this.tryGeminiPlanner(systemPrompt, userPrompt);
      if (viaGemini != null) return viaGemini;
      if (geminiKey) armNextLlmReason('model_fallback');
    }

    const localBase = this.localLlmBase();
    if (localBase) return this.completeLocalJson(localBase, systemPrompt, userPrompt);

    const models = this.modelsFor(role);
    let lastError = 'Groq LLM failed';
    let lastStatus = 503;

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
      lastStatus = strict.status;
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
          this.markJsonMode();
          return soft.content;
        }
        lastError = soft.error;
        lastStatus = soft.status;
        logFailedGeneration(this.logger, soft.failedGeneration);
      }

      if (hasNext && shouldTryNextModel(strict.status, lastError)) {
        this.logger.warn(`${lastError}; trying fallback model`);
        armNextLlmReason('model_fallback');
        continue;
      }
      this.logger.warn(lastError);
      throw this.llmUnavailable(lastError, lastStatus);
    }

    throw this.llmUnavailable(lastError, lastStatus);
    } finally {
      this.evalMeta = previousMeta;
    }
  }

  /** Eval switch. Groq chat stays in place when this is unset. */
  private deepseekForEveryCall(): boolean {
    return process.env.VOICE_LLM_PROVIDER?.trim().toLowerCase() === 'deepseek';
  }

  /**
   * Planner calls use DeepSeek when `DEEPSEEK_API_KEY` is set.
   * A failure returns null so Qwen, Gemini, then Groq still answer,
   * unless `required` is set (every call is DeepSeek, no Groq hop).
   */
  private async tryDeepSeekPlanner(
    systemPrompt: string,
    userPrompt: string,
    required = false,
  ): Promise<string | null> {
    const key = this.config.get<string>('DEEPSEEK_API_KEY')?.trim() || '';
    if (!key) {
      if (required) throw this.llmUnavailable('DEEPSEEK_API_KEY missing', 503);
      return null;
    }
    const model =
      this.config.get<string>('DEEPSEEK_PLANNER_MODEL')?.trim() ||
      DEFAULT_DEEPSEEK_PLANNER_MODEL;
    const base =
      this.config.get<string>('DEEPSEEK_BASE_URL')?.trim() || 'https://api.deepseek.com';
    return this.trackLlm(`deepseek:${model}`, async () => {
    const call = deepseekPlannerCall(model, systemPrompt, userPrompt);
    let response: Response;
    try {
      response = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(call.body),
        signal: AbortSignal.timeout(45_000),
      });
    } catch (err) {
      const message = isTimeoutError(err)
        ? 'DeepSeek planner timed out'
        : `DeepSeek planner failed: ${err instanceof Error ? err.message : String(err)}`;
      if (required) throw this.llmUnavailable(message, isTimeoutError(err) ? 504 : 503);
      this.logger.warn(`${message}; using the fallback planner`);
      return null;
    }
    const payload = (await response.json().catch(() => ({}))) as DeepSeekPlannerPayload;
    const parsed = deepseekPlannerResult(payload);
    if (!response.ok || !parsed.ok) {
      const error = parsed.ok
        ? `DeepSeek planner failed (${response.status})`
        : parsed.error;
      if (required) throw this.llmUnavailable(error, response.status);
      this.logger.warn(`${error}; using the fallback planner`);
      return null;
    }
    this.recordTokens(parsed.tokens);
    this.noteEvalSpend(model, parsed.tokens, null);
    this.noteStepTokens(parsed.tokens);
    this.noteCompletion(model, parsed);
    return parsed.content;
    }, (value) => value == null);
  }

  /**
   * Planner calls use Qwen when `QWEN_API_KEY` is set.
   * A failure returns null so Gemini, then Groq, still answers.
   */
  private async tryQwenPlanner(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<string | null> {
    const key = this.config.get<string>('QWEN_API_KEY')?.trim() || '';
    if (!key) return null;
    const model =
      this.config.get<string>('QWEN_PLANNER_MODEL')?.trim() ||
      DEFAULT_QWEN_PLANNER_MODEL;
    const base =
      this.config.get<string>('QWEN_BASE_URL')?.trim() ||
      'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
    return this.trackLlm(`qwen:${model}`, async () => {
    const call = qwenPlannerCall(model, systemPrompt, userPrompt);
    let response: Response;
    try {
      response = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(call.body),
        signal: AbortSignal.timeout(45_000),
      });
    } catch (err) {
      const message = isTimeoutError(err)
        ? 'Qwen planner timed out'
        : `Qwen planner failed: ${err instanceof Error ? err.message : String(err)}`;
      this.logger.warn(`${message}; using the fallback planner`);
      return null;
    }
    const payload = (await response.json().catch(() => ({}))) as QwenPlannerPayload;
    const parsed = qwenPlannerResult(payload);
    if (!response.ok || !parsed.ok) {
      const error = parsed.ok ? `Qwen planner failed (${response.status})` : parsed.error;
      this.logger.warn(`${error}; using the fallback planner`);
      return null;
    }
    this.recordTokens(parsed.tokens);
    this.noteEvalSpend(model, parsed.tokens, null);
    this.noteStepTokens(parsed.tokens);
    this.noteCompletion(model, parsed);
    return parsed.content;
    }, (value) => value == null);
  }

  /**
   * Planner calls use Gemini when `GEMINI_API_KEY` is set.
   * A failure returns null so the Groq planner (or local chat) still answers.
   */
  private async tryGeminiPlanner(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<string | null> {
    const key = this.config.get<string>('GEMINI_API_KEY')?.trim() || '';
    if (!key) return null;
    const model =
      this.config.get<string>('GEMINI_PLANNER_MODEL')?.trim() ||
      DEFAULT_GEMINI_PLANNER_MODEL;
    return this.trackLlm(`gemini:${model}`, async () => {
    const call = geminiPlannerCall(model, systemPrompt, userPrompt);
    let response: Response;
    try {
      response = await fetch(call.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': key,
        },
        body: JSON.stringify(call.body),
        signal: AbortSignal.timeout(GROQ_CHAT_TIMEOUT_MS),
      });
    } catch (err) {
      const message = isTimeoutError(err)
        ? 'Gemini planner timed out'
        : `Gemini planner failed: ${err instanceof Error ? err.message : String(err)}`;
      this.logger.warn(`${message}; using the fallback planner`);
      return null;
    }
    const payload = (await response.json().catch(() => ({}))) as GeminiPlannerPayload;
    const parsed = geminiPlannerResult(payload);
    if (!response.ok || !parsed.ok) {
      const error = parsed.ok
        ? `Gemini planner failed (${response.status})`
        : parsed.error;
      this.logger.warn(`${error}; using the fallback planner`);
      return null;
    }
    this.recordTokens(parsed.tokens);
    this.noteEvalSpend(model, parsed.tokens, null);
    this.noteStepTokens(parsed.tokens);
    this.noteCompletion(model, parsed);
    return parsed.content;
    }, (value) => value == null);
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
    if (!strict.ok && isLlmTimeout(strict.error, strict.status)) {
      throw this.llmUnavailable(strict.error, strict.status);
    }
    const soft = await this.ollamaChat(base, model, systemPrompt, userPrompt, false);
    if (soft.ok) {
      this.logger.warn(`Local JSON mode failed on ${model}; recovered without format`);
      this.markJsonMode();
      return soft.content;
    }
    const error = strict.ok ? soft.error : strict.error;
    this.logger.warn(error);
    throw new ServiceUnavailableException(error);
  }

  private ollamaChat(
    base: string,
    model: string,
    systemPrompt: string,
    userPrompt: string,
    jsonFormat: boolean,
  ): Promise<{ ok: true; content: string } | { ok: false; error: string; status: number }> {
    return this.trackLlm(
      `ollama:${model}`,
      () => this.postOllama(base, model, systemPrompt, userPrompt, jsonFormat),
      (result) => !result.ok,
    );
  }

  private async postOllama(
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
      const timedOut = isTimeoutError(err);
      return {
        ok: false,
        error: timedOut ? 'Local LLM timed out' : `Local LLM failed: ${message}`,
        status: timedOut ? 504 : 503,
      };
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
        daily: isDailyTokenLimit(message),
        retryAfterMs: groqRetryAfterMs(message),
        requestedTokens: groqRequestedTokens(message),
        message: 'Voice is busy. Try again in a few seconds.',
      });
    }
    if (isLlmTimeout(message, status)) {
      return new ServiceUnavailableException({
        code: 'VOICE_LLM_TIMEOUT',
        message: 'The voice model did not answer. Try again.',
      });
    }
    return new ServiceUnavailableException(message);
  }

  /** TPM 429: wait on the same key, then hop. TPD: retire and hop once. */
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
    // A near-full daily window asks for minutes. Hop keys instead of waiting.
    if (
      !result.ok &&
      result.status === 429 &&
      isDailyTokenLimit(result.error) &&
      (groqRetryAfterSeconds(result.error) ?? 0) * 1000 > RATE_LIMIT_WAIT_MAX_MS
    ) {
      if (this.canHopKey()) {
        this.retirePinnedKey();
        if (this.rotationKeys().length >= 1) {
          // After retire, index 0 is the next live key; pinNext would skip it.
          this.pinnedKeyIndex = 0;
          const ctx = this.requestAls.getStore();
          if (ctx) ctx.keyIndex = 0;
          this.logger.warn(`Groq TPD on ${model}; hopping to next key`);
          armNextLlmReason('key_hop');
          result = await this.chatCompletion(
            model,
            systemPrompt,
            userPrompt,
            jsonObject,
          );
        }
      }
      return result;
    }
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
    if (!result.ok && result.status === 429 && this.canHopKey()) {
      if (isDailyTokenLimit(result.error)) {
        this.retirePinnedKey();
        this.pinnedKeyIndex = 0;
        const ctx = this.requestAls.getStore();
        if (ctx) ctx.keyIndex = 0;
      } else {
        this.advancePin();
      }
      this.logger.warn(`Groq rate limit on ${model}; hopping to next key`);
      armNextLlmReason('key_hop');
      result = await this.chatCompletion(
        model,
        systemPrompt,
        userPrompt,
        jsonObject,
      );
    }
    if (!result.ok && /empty response/i.test(result.error)) {
      this.logger.warn(`Empty LLM response on ${model}; retrying once`);
      await this.sleep(400);
      result = await this.chatCompletion(
        model,
        systemPrompt,
        userPrompt,
        jsonObject,
      );
    }
    return result;
  }

  private llmStepName(): string {
    return this.evalMeta?.label || 'llm';
  }

  private noteStepTokens(tokens: number | undefined): void {
    const used = Math.floor(tokens ?? 0);
    if (used > 0) noteVoiceStep({ tokens: used });
  }

  private markJsonMode(): void {
    annotateLatestStep(
      (step) => step.kind === 'llm',
      (step) => (step.reason ? {} : { reason: 'json_mode' }),
    );
  }

  private trackLlm<T>(
    via: string,
    fn: () => Promise<T>,
    failed?: (value: T) => boolean,
  ): Promise<T> {
    const name = this.llmStepName();
    const component = voiceComponentForStep(name);
    const segment =
      component === 'router' || component === 'specialist'
        ? currentVoiceTrace()?.activeSegment
        : undefined;
    return traceStep('llm', name, via, fn, failed, {
      ...(component ? { component } : {}),
      ...(segment != null ? { segment } : {}),
    });
  }

  private trackStt<T extends { ok: boolean }>(fn: () => Promise<T>): Promise<T> {
    return traceStep('other', 'stt', `groq:${this.sttModel()}`, fn, (result) => !result.ok);
  }

  private sleep(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return traceStep(
      'other',
      'wait',
      '',
      () => new Promise((resolve) => setTimeout(resolve, ms)),
    );
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
    await this.paceForEval(model, systemPrompt, userPrompt);
    return this.trackLlm(
      `groq:${model}`,
      () => this.postGroqChat(model, systemPrompt, userPrompt, jsonObject),
      (result) => !result.ok,
    );
  }

  private async postGroqChat(
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

    let response: Response;
    try {
      response = await fetch(GROQ_CHAT_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.chatKey()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(GROQ_CHAT_TIMEOUT_MS),
      });
    } catch (err) {
      return {
        ok: false,
        error: fetchFailureMessage(err, 'LLM'),
        status: fetchFailureStatus(err),
      };
    }
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
    this.recordTokens(payload.usage?.total_tokens);
    this.noteEvalSpend(
      model,
      payload.usage?.total_tokens,
      response.headers?.get('x-ratelimit-limit-tokens') ?? null,
    );
    this.noteStepTokens(payload.usage?.total_tokens);
    this.noteCompletion(model, {
      tokens: payload.usage?.total_tokens,
      promptTokens: typeof payload.usage?.prompt_tokens === 'number' ? Math.floor(payload.usage.prompt_tokens) : null,
      completionTokens: typeof payload.usage?.completion_tokens === 'number' ? Math.floor(payload.usage.completion_tokens) : null,
    });
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
  if (!voiceTraceBodiesEnabled()) {
    logger.warn('Groq failed_generation');
    return;
  }
  logger.warn(`Groq failed_generation (truncated): ${clipVoiceBody(snippet, 400)}`);
}

function isFailedJsonGeneration(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('failed to generate json') ||
    lower.includes('failed_generation') ||
    lower.includes('tool choice is none')
  );
}

/** Groq writes "3.645s", "1m11.712s", or "19m9.984s". */
export function groqRetryAfterSeconds(message: string): number | null {
  const match = message.match(/try again in\s+(\S+)/i);
  if (!match) return null;
  const token = match[1].replace(/[,.]$/, '');
  let total = 0;
  let found = false;
  const parts = /(\d+(?:\.\d+)?)(h|m|s)/gi;
  let part: RegExpExecArray | null;
  while ((part = parts.exec(token))) {
    found = true;
    const value = Number(part[1]);
    if (!Number.isFinite(value)) return null;
    const unit = part[2].toLowerCase();
    if (unit === 'h') total += value * 3600;
    else if (unit === 'm') total += value * 60;
    else total += value;
  }
  return found ? total : null;
}

export function groqRequestedTokens(message: string): number | null {
  const match = message.match(/Requested\s+(\d+)/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

export function groqRetryAfterMs(message: string): number | null {
  const seconds = groqRetryAfterSeconds(message);
  if (seconds == null) return null;
  return Math.ceil(seconds * 1000);
}

function isDailyTokenLimit(message: string): boolean {
  return /tokens per day|\bTPD\b/i.test(message);
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
  if (seconds == null) seconds = groqRetryAfterSeconds(message);
  if (seconds == null) return 4000;
  return Math.min(
    RATE_LIMIT_WAIT_MAX_MS,
    Math.max(RATE_LIMIT_WAIT_MIN_MS, Math.ceil(seconds * 1000) + 250),
  );
}

function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
}

function fetchFailureStatus(err: unknown): number {
  return isTimeoutError(err) ? 504 : 503;
}

function fetchFailureMessage(err: unknown, kind: string): string {
  if (isTimeoutError(err)) return `Groq ${kind} timed out`;
  const message = err instanceof Error ? err.message : String(err);
  return `Groq ${kind} failed: ${message}`;
}

function isLlmTimeout(message: string, status: number): boolean {
  return status === 504 || /timed out/i.test(message);
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
