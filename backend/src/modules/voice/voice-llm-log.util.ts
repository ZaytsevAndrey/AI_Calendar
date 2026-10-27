import type { Logger } from '@nestjs/common';
import { clipVoiceBody, currentVoiceTrace, voiceTraceBodiesEnabled } from '../../common/voice-trace';

export type PlannerFaultCode =
  | 'invalid_json'
  | 'invalid_decision'
  | 'segment_limit_exceeded'
  | 'tool_limit_exceeded'
  | 'planner_execution_error';

/** One structured planner line. Faults are warnings; accepted decisions are logs. */
export function logPlannerEvent(
  logger: Logger,
  event: 'planner.decision' | 'planner.fault',
  fields: Record<string, string | number | boolean>,
): void {
  const traceId = currentVoiceTrace()?.traceId;
  const payload = traceId ? { traceId, ...fields } : fields;
  const line = `[${event}] ${JSON.stringify(payload)}`;
  if (event === 'planner.fault') logger.warn(line);
  else logger.log(line);
}

/** `traceId=...` for a file line that is not the voice.trace summary. */
export function voiceTracePrefix(): string {
  const traceId = currentVoiceTrace()?.traceId;
  return traceId ? `traceId=${traceId}` : '';
}

/**
 * Raw model text for debugging. Off unless VOICE_TRACE_BODY is explicitly enabled,
 * and in production also VOICE_TRACE_BODY_PRODUCTION. Secrets are redacted either way.
 */
export function logVoiceLlm(
  logger: Logger,
  step: string,
  raw: string,
  maxChars = 2000,
): void {
  if (!voiceTraceBodiesEnabled()) return;
  const traceId = currentVoiceTrace()?.traceId;
  const prefix = traceId ? `[llm:${step}] traceId=${traceId} ` : `[llm:${step}] `;
  logger.log(`${prefix}${clipVoiceBody(raw, maxChars)}`);
}
