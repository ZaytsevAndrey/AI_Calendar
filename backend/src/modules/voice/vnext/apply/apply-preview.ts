import type { VoiceWriteIntent } from '../../voice-agent.types';
import { intentKey } from '../session/session';

export type ApplyState = 'pending' | 'succeeded' | 'failed' | 'unknown';

export type ApplyRecord = {
  key: string;
  status: ApplyState;
  error?: string;
};

export class ApplyOutcomeError extends Error {
  constructor(readonly outcome: 'failed' | 'unknown', message: string) {
    super(message);
  }
}

export type ApplyItem = {
  intent: VoiceWriteIntent;
  /** Keys that must already be `succeeded` before this write starts. */
  dependsOn?: string[];
};

export type ApplyResult = {
  key: string;
  status: ApplyState | 'skipped' | 'blocked';
  error?: string;
};

/**
 * Starts a write only after the ledger says it is not already in flight,
 * succeeded, or unknown. Success is recorded after `write` resolves.
 * An unknown outcome is not retried. This is not a provider exactly-once guarantee.
 */
export async function applyPreview(input: {
  items: ApplyItem[];
  ledger: Map<string, ApplyRecord>;
  write: (intent: VoiceWriteIntent, key: string) => Promise<void>;
}): Promise<{ results: ApplyResult[] }> {
  const results: ApplyResult[] = [];
  const succeeded = new Set(
    [...input.ledger.values()].filter((row) => row.status === 'succeeded').map((row) => row.key),
  );
  for (const item of input.items) {
    const key = intentKey(item.intent);
    const blockedBy = (item.dependsOn ?? []).find((dep) => !succeeded.has(dep));
    if (blockedBy) {
      results.push({ key, status: 'blocked', error: 'dependency_failure' });
      continue;
    }
    const existing = input.ledger.get(key);
    if (existing?.status === 'succeeded') {
      results.push({ key, status: 'skipped', error: 'duplicate_request' });
      continue;
    }
    if (existing?.status === 'pending') {
      results.push({ key, status: 'skipped', error: 'in_flight' });
      continue;
    }
    if (existing?.status === 'unknown') {
      results.push({ key, status: 'skipped', error: 'unknown_apply' });
      continue;
    }
    input.ledger.set(key, { key, status: 'pending' });
    try {
      await input.write(item.intent, key);
      input.ledger.set(key, { key, status: 'succeeded' });
      succeeded.add(key);
      results.push({ key, status: 'succeeded' });
    } catch (err) {
      const outcome = err instanceof ApplyOutcomeError ? err.outcome : 'failed';
      const error = err instanceof Error ? err.message : 'provider_unavailable';
      input.ledger.set(key, { key, status: outcome, error });
      results.push({ key, status: outcome, error });
    }
  }
  return { results };
}

/** A crash while a write is pending is an unknown outcome, not a failure to retry. */
export function resumeLedger(records: ApplyRecord[]): Map<string, ApplyRecord> {
  const ledger = new Map<string, ApplyRecord>();
  for (const record of records) {
    ledger.set(record.key, record.status === 'pending' ? { ...record, status: 'unknown', error: record.error ?? 'interrupted' } : { ...record });
  }
  return ledger;
}
