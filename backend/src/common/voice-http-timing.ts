import type { Logger } from '@nestjs/common';
import {
  bindVoiceTrace,
  formatVoiceTrace,
  readVoiceTrace,
  type VoiceStep,
} from './voice-trace';

export type VoiceTimingReply = {
  statusCode: number;
  /** Milliseconds from request receipt until the response was sent. */
  elapsedTime: number;
};

export type VoiceTimingRequest = {
  method: string;
  url: string;
};

export type VoiceTimingServer = {
  addHook(
    name: 'onRequest',
    hook: (request: VoiceTimingRequest) => void | Promise<void>,
  ): void;
  addHook(
    name: 'onResponse',
    hook: (request: VoiceTimingRequest, reply: VoiceTimingReply) => void | Promise<void>,
  ): void;
};

/** One finished /voice request, handed to an optional sink (the admin turn log). */
export type VoiceTurnRecord = {
  traceId: string;
  userId: string | null;
  method: string;
  url: string;
  statusCode: number;
  totalMs: number;
  steps: VoiceStep[];
};

function requestUserId(request: object): string | null {
  const user = (request as { user?: { userId?: unknown } }).user;
  return typeof user?.userId === 'string' ? user.userId : null;
}

function isVoicePath(url: string): boolean {
  return /^\/voice(?:\/|$)/.test((url || '').split('?')[0]);
}

/**
 * Log one summary when Fastify finishes a /voice response.
 * The total is receive-to-sent. Steps are the model calls and the other
 * work recorded while the handler ran.
 */
export function registerVoiceHttpTiming(
  server: VoiceTimingServer,
  logger: Pick<Logger, 'log'>,
  onTurn?: (record: VoiceTurnRecord) => void | Promise<void>,
): void {
  server.addHook('onRequest', async (request) => {
    if (isVoicePath(request.url)) bindVoiceTrace(request);
  });
  server.addHook('onResponse', async (request, reply) => {
    const trace = readVoiceTrace(request);
    const steps: VoiceStep[] = trace?.steps ?? [];
    const line = formatVoiceTrace({
      traceId: trace?.traceId ?? 'none',
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      totalMs: reply.elapsedTime,
      steps,
    });
    if (line) logger.log(line);
    if (line && onTurn) {
      // Do not hold the response hook on the database write.
      void Promise.resolve()
        .then(() =>
          onTurn({
            traceId: trace?.traceId ?? 'none',
            userId: requestUserId(request),
            method: request.method,
            url: request.url,
            statusCode: reply.statusCode,
            totalMs: reply.elapsedTime,
            steps: steps.map((step) => ({ ...step })),
          }),
        )
        .catch(() => undefined);
    }
  });
}
