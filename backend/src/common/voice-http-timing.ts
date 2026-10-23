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
): void {
  server.addHook('onRequest', async (request) => {
    if (isVoicePath(request.url)) bindVoiceTrace(request);
  });
  server.addHook('onResponse', async (request, reply) => {
    const steps: VoiceStep[] = readVoiceTrace(request)?.steps ?? [];
    const line = formatVoiceTrace({
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      totalMs: reply.elapsedTime,
      steps,
    });
    if (line) logger.log(line);
  });
}
