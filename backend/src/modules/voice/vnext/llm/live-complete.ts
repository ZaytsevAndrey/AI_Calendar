import { deepseekPlannerCall, deepseekPlannerResult, type DeepSeekPlannerPayload } from '../../deepseek-planner';
import type { LlmComplete } from '../repair/repair';
import { deepseekFlashUsd, gpt6LunaUsd } from './pricing';

export type LiveCall = {
  inputTokens: number;
  outputTokens: number;
  cacheHit: number;
  cacheMiss: number;
  totalTokens: number;
  split: boolean;
  latencyMs: number;
  status: number;
};

export type LiveSpend = {
  calls: LiveCall[];
  inputTokens: number;
  outputTokens: number;
  cacheHit: number;
  cacheMiss: number;
  totalTokens: number;
  unsplitCalls: number;
  latencyMs: number;
  usd: number | null;
  usdNote: string;
  peak: boolean;
};

function emptySpend(at: Date): LiveSpend {
  return {
    calls: [],
    inputTokens: 0,
    outputTokens: 0,
    cacheHit: 0,
    cacheMiss: 0,
    totalTokens: 0,
    unsplitCalls: 0,
    latencyMs: 0,
    usd: 0,
    usdNote: 'cache miss assumed when the response omits cache fields',
    peak: deepseekFlashUsd({ at, cacheHit: 0, cacheMiss: 0, output: 0 }).peak,
  };
}

function addCall(
  spend: LiveSpend,
  call: LiveCall,
  at: Date,
  pricer: (input: { at: Date; cacheHit: number; cacheMiss: number; output: number }) => { usd: number; peak: boolean } = deepseekFlashUsd,
  note?: string,
): void {
  spend.calls.push(call);
  spend.inputTokens += call.inputTokens;
  spend.outputTokens += call.outputTokens;
  spend.cacheHit += call.cacheHit;
  spend.cacheMiss += call.cacheMiss;
  spend.totalTokens += call.totalTokens;
  spend.latencyMs += call.latencyMs;
  if (!call.split && call.status !== 429 && call.status !== 503) spend.unsplitCalls += 1;
  if (spend.unsplitCalls > 0) {
    spend.usd = null;
    spend.usdNote = 'currency cost unknown: at least one response omitted the input/output split';
    return;
  }
  const priced = pricer({
    at,
    cacheHit: spend.cacheHit,
    cacheMiss: spend.cacheMiss,
    output: spend.outputTokens,
  });
  spend.usd = priced.usd;
  spend.peak = priced.peak;
  if (note) spend.usdNote = note;
}

function redact(message: string, key: string): string {
  return key ? message.split(key).join('[redacted]') : message;
}

type Usage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
};

function usageOf(payload: DeepSeekPlannerPayload & { usage?: Usage }, latencyMs: number, status: number): LiveCall {
  const usage = payload.usage ?? {};
  const prompt = finite(usage.prompt_tokens);
  const completion = finite(usage.completion_tokens);
  const total = finite(usage.total_tokens);
  const split = prompt != null && completion != null;
  const cacheHit = finite(usage.prompt_cache_hit_tokens) ?? 0;
  const cacheMiss = finite(usage.prompt_cache_miss_tokens) ?? (split ? Math.max(0, (prompt ?? 0) - cacheHit) : 0);
  return {
    inputTokens: split ? prompt ?? 0 : total ?? 0,
    outputTokens: split ? completion ?? 0 : 0,
    cacheHit,
    cacheMiss,
    totalTokens: total ?? (prompt ?? 0) + (completion ?? 0),
    split,
    latencyMs,
    status,
  };
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

async function postJson(url: string, key: string, body: unknown, timeoutMs: number): Promise<{ status: number; payload: DeepSeekPlannerPayload & { usage?: Usage }; latencyMs: number }> {
  const started = Date.now();
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = (await response.json().catch(() => ({}))) as DeepSeekPlannerPayload & { usage?: Usage };
  return { status: response.status, payload, latencyMs: Date.now() - started };
}

export function createDeepSeekComplete(spend: LiveSpend, at = new Date()): LlmComplete {
  const key = process.env.DEEPSEEK_API_KEY?.trim() || '';
  const base = (process.env.DEEPSEEK_BASE_URL?.trim() || 'https://api.deepseek.com').replace(/\/$/, '');
  const model = process.env.DEEPSEEK_PLANNER_MODEL?.trim() || 'deepseek-flash';
  return {
    async complete(input) {
      if (!key) throw new Error('DEEPSEEK_API_KEY missing');
      const body = deepseekPlannerCall(model, input.system, input.user).body;
      let lastError = 'DeepSeek request failed';
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const response = await postJson(`${base}/chat/completions`, key, body, 45_000);
          const call = usageOf(response.payload, response.latencyMs, response.status);
          addCall(spend, call, at);
          const parsed = deepseekPlannerResult(response.payload);
          if (response.status === 429 || response.status === 503) {
            lastError = parsed.ok ? `DeepSeek ${response.status}` : parsed.error;
            await delay(2_000);
            continue;
          }
          if (response.status < 200 || response.status >= 300) {
            throw new Error(redact(parsed.ok ? `DeepSeek ${response.status}` : parsed.error, key));
          }
          return {
            text: parsed.ok ? parsed.content : '',
            inputTokens: call.inputTokens,
            outputTokens: call.outputTokens,
            latencyMs: call.latencyMs,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          lastError = redact(message, key);
          const retry = message.includes('timeout') || message.includes('Timeout');
          if (!retry || attempt === 1) break;
          await delay(2_000);
        }
      }
      throw new Error(redact(lastError, key));
    },
  };
}

const LUNA_NOTE = 'gpt-6-luna standard short-context rates. Cached input is priced only when the response reports cached tokens; otherwise the input is priced as uncached.';

export function createLunaComplete(spend: LiveSpend, at = new Date()): LlmComplete {
  const key = process.env.OPENAI_API_KEY?.trim() || '';
  return {
    async complete(input) {
      if (!key) throw new Error('OPENAI_API_KEY missing');
      const body = {
        model: 'gpt-6-luna',
        max_completion_tokens: 4096,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: input.system },
          { role: 'user', content: input.user },
        ],
      };
      let lastError = 'Luna request failed';
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const response = await postJson('https://api.openai.com/v1/chat/completions', key, body, 180_000);
          const call = usageOfOpenAI(response.payload, response.latencyMs, response.status);
          addCall(spend, call, at, (price) => gpt6LunaUsd(price), LUNA_NOTE);
          const text = openAIText(response.payload);
          if (response.status === 429 || response.status === 503) {
            lastError = text.error || `Luna ${response.status}`;
            await delay(2_000);
            continue;
          }
          if (response.status < 200 || response.status >= 300) {
            throw new Error(redact(text.error || `Luna ${response.status}`, key));
          }
          if (!text.content) throw new Error(redact(text.error || 'Luna returned an empty response', key));
          return {
            text: text.content,
            inputTokens: call.inputTokens,
            outputTokens: call.outputTokens,
            latencyMs: call.latencyMs,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          lastError = redact(message, key);
          const retry = message.includes('timeout') || message.includes('Timeout');
          if (!retry || attempt === 1) break;
          await delay(2_000);
        }
      }
      throw new Error(redact(lastError, key));
    },
  };
}

function usageOfOpenAI(payload: DeepSeekPlannerPayload & { usage?: Usage & { prompt_tokens_details?: { cached_tokens?: number } } }, latencyMs: number, status: number): LiveCall {
  const usage = payload.usage ?? {};
  const prompt = finite(usage.prompt_tokens);
  const completion = finite(usage.completion_tokens);
  const total = finite(usage.total_tokens);
  const split = prompt != null && completion != null;
  const cacheHit = finite(usage.prompt_tokens_details?.cached_tokens) ?? 0;
  const cacheMiss = split ? Math.max(0, (prompt ?? 0) - cacheHit) : 0;
  return {
    inputTokens: split ? prompt ?? 0 : total ?? 0,
    outputTokens: split ? completion ?? 0 : 0,
    cacheHit,
    cacheMiss,
    totalTokens: total ?? (prompt ?? 0) + (completion ?? 0),
    split,
    latencyMs,
    status,
  };
}

function openAIText(payload: DeepSeekPlannerPayload & { choices?: Array<{ message?: { content?: unknown; refusal?: unknown } }> }): { content: string; error: string } {
  const err = payload.error;
  if (typeof err === 'string' && err.trim()) return { content: '', error: err.trim() };
  if (err && typeof err === 'object' && typeof err.message === 'string') return { content: '', error: err.message };
  const message = payload.choices?.[0]?.message;
  if (message && typeof message.refusal === 'string' && message.refusal.trim()) {
    return { content: message.refusal.trim(), error: '' };
  }
  const content: unknown = message?.content;
  if (typeof content === 'string') return { content: content.trim(), error: '' };
  if (Array.isArray(content)) {
    const text = content.map((part: unknown) => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') return (part as { text: string }).text;
      return '';
    }).join('').trim();
    return { content: text, error: text ? '' : 'Luna returned an empty response' };
  }
  return { content: '', error: 'Luna returned an empty response' };
}

export function newSpend(at = new Date()): LiveSpend {
  return emptySpend(at);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
