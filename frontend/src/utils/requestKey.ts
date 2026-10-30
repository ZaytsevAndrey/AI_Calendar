/** A fresh Idempotency-Key: one per user operation, reused only for its retries. */
export function newRequestKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

/** The key of one opened form and the body it was last sent with. */
export type SubmissionKey = { key: string; body: string | null };

/**
 * Key for sending `body` from a form. The same content again (Save pressed
 * after an error or a lost answer) is a retry and keeps the key, so the
 * server returns the first result. Changed content is a new operation and
 * gets a new key (the server refuses one key with two different bodies).
 */
export function keyForSubmission(current: SubmissionKey, body: unknown): SubmissionKey {
  const serialized = JSON.stringify(body);
  if (current.body === null || current.body === serialized) {
    return { key: current.key, body: serialized };
  }
  return { key: newRequestKey(), body: serialized };
}
