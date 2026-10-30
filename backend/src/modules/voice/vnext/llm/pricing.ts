/** Official DeepSeek API docs, retrieved 2026-10-27. USD per 1M tokens. */
export const DEEPSEEK_FLASH_PRICE = {
  source: 'https://api-docs.deepseek.com/quick_start/pricing/',
  retrieved: '2026-10-27',
  model: 'deepseek-flash',
  offPeak: { cacheHitInput: 0.003, cacheMissInput: 0.15, output: 0.6 },
  peak: { cacheHitInput: 0.006, cacheMissInput: 0.3, output: 1.2 },
} as const;

/** Peak is 01:00–04:00 and 06:00–10:00 UTC, Monday–Friday. Weekends are off-peak. */
export function deepseekFlashIsPeak(at: Date): boolean {
  const day = at.getUTCDay();
  if (day === 0 || day === 6) return false;
  const hour = at.getUTCHours();
  return (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10);
}

/** OpenAI model page, retrieved 2026-10-28. Standard short-context USD per 1M tokens. */
export const GPT6_LUNA_PRICE = {
  source: 'https://developers.openai.com/api/docs/models/gpt-6-luna',
  retrieved: '2026-10-28',
  model: 'gpt-6-luna',
  standardShortContext: { input: 0.1, cachedInput: 0.01, output: 0.5 },
} as const;

export function gpt6LunaUsd(input: {
  cacheHit: number;
  cacheMiss: number;
  output: number;
}): { usd: number; peak: false } {
  const rate = GPT6_LUNA_PRICE.standardShortContext;
  const usd = (input.cacheHit * rate.cachedInput + input.cacheMiss * rate.input + input.output * rate.output) / 1_000_000;
  return { usd, peak: false };
}

export function deepseekFlashUsd(input: {
  at: Date;
  cacheHit: number;
  cacheMiss: number;
  output: number;
}): { usd: number; peak: boolean } {
  const peak = deepseekFlashIsPeak(input.at);
  const rate = peak ? DEEPSEEK_FLASH_PRICE.peak : DEEPSEEK_FLASH_PRICE.offPeak;
  const usd = (input.cacheHit * rate.cacheHitInput
    + input.cacheMiss * rate.cacheMissInput
    + input.output * rate.output) / 1_000_000;
  return { usd, peak };
}

/**
 * Cost of one completion in USD for the models with a known price; null otherwise.
 * Without a prompt / completion split the total is charged as cache-miss input (an upper bound).
 */
export function completionUsd(
  model: string,
  usage: { totalTokens: number; promptTokens: number | null; completionTokens: number | null },
  at: Date = new Date(),
): number | null {
  const input = usage.promptTokens ?? usage.totalTokens;
  const output = usage.completionTokens ?? 0;
  if (model === DEEPSEEK_FLASH_PRICE.model) {
    return Math.round(deepseekFlashUsd({ at, cacheHit: 0, cacheMiss: input, output }).usd * 1_000_000) / 1_000_000;
  }
  if (model === GPT6_LUNA_PRICE.model) {
    return Math.round(gpt6LunaUsd({ cacheHit: 0, cacheMiss: input, output }).usd * 1_000_000) / 1_000_000;
  }
  return null;
}
