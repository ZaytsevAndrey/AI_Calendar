import type { Logger } from '@nestjs/common';

export type PlannerFaultCode =
  | 'invalid_decision'
  | 'tool_limit_exceeded'
  | 'planner_execution_error';

/** One structured planner line. Faults are warnings; accepted decisions are logs. */
export function logPlannerEvent(
  logger: Logger,
  event: 'planner.decision' | 'planner.fault',
  fields: Record<string, string | number | boolean>,
): void {
  const line = `[${event}] ${JSON.stringify(fields)}`;
  if (event === 'planner.fault') logger.warn(line);
  else logger.log(line);
}

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
