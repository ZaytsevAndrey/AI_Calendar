/**
 * Process-local structured sessions.
 * Not VoiceSessionStore, and not consulted by the voice route.
 * A per-key queue serializes commits in this process. A restart drops the map.
 * This is not cross-process compare-and-set and not provider exactly-once.
 */
import { commitIfVersion, createStructuredState, type StateTransition, type StructuredState } from './structured-state';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

type Entry = { state: StructuredState; expiresAt: number };
type Lane = { tail: Promise<void> };

export class StructuredSessionStore {
  private readonly sessions = new Map<string, Entry>();
  private readonly lanes = new Map<string, Lane>();

  constructor(
    private readonly ttlMs = DEFAULT_TTL_MS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** `userId` is the authenticated caller. The store does not read a user id from the client body. */
  open(userId: string, sessionId: string): StructuredState {
    const key = this.key(userId, sessionId);
    const existing = this.sessions.get(key);
    if (existing) return clone(existing.state);
    const created = createStructuredState(sessionId);
    this.sessions.set(key, { state: created, expiresAt: this.now() + this.ttlMs });
    return clone(created);
  }

  read(userId: string, sessionId: string): StructuredState | undefined {
    const entry = this.sessions.get(this.key(userId, sessionId));
    return entry ? clone(entry.state) : undefined;
  }

  commit(userId: string, sessionId: string, expectedSessionVersion: number, candidate: StructuredState): Promise<StateTransition> {
    const key = this.key(userId, sessionId);
    return this.enqueue(key, () => {
      const entry = this.sessions.get(key);
      if (!entry) return missing(candidate);
      const decision = commitIfVersion(entry.state, expectedSessionVersion, candidate);
      if (!decision.ok) return { ...decision, state: clone(entry.state) };
      const stored = clone(candidate);
      entry.state = stored;
      entry.expiresAt = this.now() + this.ttlMs;
      return { ...decision, state: clone(stored) };
    });
  }

  purgeExpired(now = this.now()): number {
    let removed = 0;
    for (const [key, entry] of this.sessions) {
      if (entry.expiresAt > now || this.lanes.has(key)) continue;
      this.sessions.delete(key);
      removed += 1;
    }
    return removed;
  }

  serializationHandleCount(): number {
    return this.lanes.size;
  }

  private enqueue<T>(key: string, job: () => T): Promise<T> {
    const lane = this.lanes.get(key) ?? { tail: Promise.resolve() };
    this.lanes.set(key, lane);
    const run = lane.tail.then(job, job);
    const settled = run.then(() => undefined, () => undefined);
    lane.tail = settled;
    settled.then(() => {
      if (this.lanes.get(key) === lane && lane.tail === settled) this.lanes.delete(key);
    });
    return run;
  }

  private key(userId: string, sessionId: string): string {
    if (!userId.trim() || !sessionId.trim()) throw new Error('session_key');
    return `${userId}\0${sessionId}`;
  }
}

function missing(candidate: StructuredState): StateTransition {
  return { ok: false, code: 'missing_session', detail: candidate.sessionId, state: candidate, duplicate: false };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
