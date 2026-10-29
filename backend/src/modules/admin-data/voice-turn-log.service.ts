import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { VoiceTurnLog } from './entities/voice-turn-log.entity';
import type { VoiceTurnRecord } from '../../common/voice-http-timing';
import type { VoiceStep } from '../../common/voice-trace';

/** Turns older than this are pruned. */
export const VOICE_TURN_RETENTION_DAYS = 30;
const PRUNE_EVERY = 200;

/**
 * `reason` is usually a code list (`timeout,rate_limit`) but some paths put a raw
 * error message there, which can echo user or model text. Keep code-like values only.
 */
const CODE_LIKE = /^[A-Za-z0-9_.:,=/-]{1,120}$/;

function stripFreeText(steps: VoiceStep[]): VoiceStep[] {
  return steps.map((step) => {
    const out: VoiceStep = { ...step };
    if (out.reason !== undefined && !CODE_LIKE.test(out.reason)) out.reason = 'free_text_omitted';
    if (out.decision !== undefined && !CODE_LIKE.test(out.decision)) delete out.decision;
    return out;
  });
}

export function summarizeVoiceTurn(record: VoiceTurnRecord): Omit<VoiceTurnLog, 'id' | 'createdAt'> {
  const steps = stripFreeText(record.steps);
  const llm = steps.filter((s) => s.kind === 'llm');
  const failed = steps.filter((s) => !s.ok || s.valid === false);
  const firstCode =
    failed.find((s) => s.errorCode && CODE_LIKE.test(s.errorCode))?.errorCode ??
    (failed[0] ? failed[0].name : null) ??
    (record.statusCode >= 400 ? `http_${record.statusCode}` : null);
  return {
    userId: isUuid(record.userId) ? record.userId : null,
    traceId: (record.traceId || 'none').slice(0, 80),
    method: (record.method || '').slice(0, 10),
    path: (record.url || '').split('?')[0].slice(0, 120),
    statusCode: record.statusCode,
    totalMs: Math.max(0, Math.round(record.totalMs)),
    llmCalls: llm.length,
    llmMs: llm.reduce((t, s) => t + s.ms, 0),
    tokens: steps.reduce((t, s) => t + (s.tokens ?? 0), 0),
    failedSteps: failed.length,
    errorCode: firstCode ? String(firstCode).slice(0, 80) : null,
    stepsJson: JSON.stringify(steps),
  };
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

@Injectable()
export class VoiceTurnLogService {
  private readonly logger = new Logger(VoiceTurnLogService.name);
  private writes = 0;

  constructor(
    @InjectRepository(VoiceTurnLog)
    private readonly repo: Repository<VoiceTurnLog>,
  ) {}

  /** Fire-and-forget from the response hook. Never throws. */
  async record(record: VoiceTurnRecord): Promise<void> {
    if (record.method === 'OPTIONS') return;
    try {
      await this.repo.insert(summarizeVoiceTurn(record));
      this.writes += 1;
      if (this.writes % PRUNE_EVERY === 1) await this.prune();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`voice turn log write failed: ${msg}`);
    }
  }

  async prune(now = new Date()): Promise<void> {
    const cutoff = new Date(now.getTime() - VOICE_TURN_RETENTION_DAYS * 86_400_000);
    await this.repo.delete({ createdAt: LessThan(cutoff) });
  }
}
