/**
 * Step log for one structured voice turn.
 * Every line: `voice.structured <traceId> <step> <fields>`, with timings and counts always.
 * Text the user said or the model wrote (transcript, prompt, model output, read results, intents)
 * is added as `body=` only when voiceTraceBodiesEnabled() is on. Production needs its own flag.
 */
import type { Logger } from '@nestjs/common';
import { clipVoiceBody, currentVoiceTrace, voiceTraceBodiesEnabled } from '../../../../common/voice-trace';

/** Prompts and model output are long; the file line cap is 16000 characters. */
const BODY_CHARS = 12000;

/** Model usage of one turn: every call summed, with a cost estimate where the model's price is known (VR-24). */
export type TurnUsage = { calls: number; tokens: number; promptTokens: number; completionTokens: number; usd: number };

export class TurnLog {
  private readonly startedAt = Date.now();
  readonly traceId: string;
  readonly bodies: boolean;
  readonly usage: TurnUsage = { calls: 0, tokens: 0, promptTokens: 0, completionTokens: 0, usd: 0 };

  constructor(private readonly logger: Pick<Logger, 'log' | 'warn'>) {
    this.traceId = currentVoiceTrace()?.traceId ?? 'none';
    this.bodies = voiceTraceBodiesEnabled();
  }

  /** One step. `body` is written only when bodies are enabled. */
  step(name: string, fields: Record<string, unknown> = {}, body?: unknown): void {
    this.logger.log(this.line(name, fields, body));
  }

  warn(name: string, fields: Record<string, unknown> = {}, body?: unknown): void {
    this.logger.warn(this.line(name, fields, body));
  }

  /** Time `fn` and log it as one step, also on failure. */
  async timed<T>(
    name: string,
    fn: () => Promise<T>,
    describe?: (value: T) => { fields?: Record<string, unknown>; body?: unknown },
  ): Promise<T> {
    const started = Date.now();
    try {
      const value = await fn();
      const described = describe?.(value) ?? {};
      this.step(name, { ms: Date.now() - started, ok: true, ...described.fields }, described.body);
      return value;
    } catch (err) {
      this.warn(name, { ms: Date.now() - started, ok: false, error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  /** Add one model call to the turn's usage. A null split adds nothing to that side. */
  noteModelCall(usage: { totalTokens: number; promptTokens: number | null; completionTokens: number | null; usd: number | null } | null): void {
    this.usage.calls += 1;
    if (!usage) return;
    this.usage.tokens += usage.totalTokens;
    this.usage.promptTokens += usage.promptTokens ?? 0;
    this.usage.completionTokens += usage.completionTokens ?? 0;
    this.usage.usd = round6(this.usage.usd + (usage.usd ?? 0));
  }

  elapsed(): number {
    return Date.now() - this.startedAt;
  }

  private line(name: string, fields: Record<string, unknown>, body?: unknown): string {
    const head = `voice.structured ${this.traceId} ${name} ${safeJson(fields)}`;
    if (!this.bodies || body === undefined) return head;
    const text = typeof body === 'string' ? body : safeJson(body);
    return `${head} body=${clipVoiceBody(text, BODY_CHARS)}`;
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
