import type { Logger } from '@nestjs/common';

/** Compact one-line log of an LLM JSON reply for voice debugging. */
export function logVoiceLlm(
  logger: Logger,
  step: string,
  raw: string,
  maxChars = 2000,
): void {
  const compact = String(raw || '')
    .replace(/\s+/g, ' ')
    .trim();
  const clipped =
    compact.length > maxChars
      ? `${compact.slice(0, maxChars)}…(+${compact.length - maxChars})`
      : compact;
  logger.log(`[llm:${step}] ${clipped}`);
}
