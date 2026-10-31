/**
 * Process-local structured voice sessions for the production route.
 * Keyed by the authenticated user and the client session id; a client cannot reach another
 * user's session. Turns on one key run one at a time. A restart drops every session, which
 * fails closed: an open preview is gone and must be previewed again.
 */
import type { EntityRecord } from '../reference/reference-resolver';
import { createSession, type VNextSession } from '../session/session';

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;

export type Dispatched = {
  /** Ledger keys in the order the Apply intents were returned to the client. */
  keys: string[];
  reported: boolean;
};

export type SessionEntry = {
  session: VNextSession;
  /** Executions this session dispatched, by execution id. */
  dispatched: Map<string, Dispatched>;
  /** Provider events read this session, by catalog id. Re-read from the provider before any write. */
  external: Map<string, EntityRecord>;
  /** When the upcoming provider events were last preloaded into `external`, and for which day / zone. */
  externalLoaded?: { key: string; at: number };
  expiresAt: number;
};

export class StructuredVoiceSessions {
  private readonly entries = new Map<string, SessionEntry>();
  private readonly lanes = new Map<string, Promise<void>>();

  constructor(
    private readonly ttlMs = DEFAULT_TTL_MS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Run `job` with this session's entry, after any earlier turn on the same key has settled. */
  async run<T>(userId: string, sessionId: string, job: (entry: SessionEntry) => Promise<T>): Promise<T> {
    const key = this.key(userId, sessionId);
    const previous = this.lanes.get(key) ?? Promise.resolve();
    let release!: () => void;
    const lane = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => lane);
    this.lanes.set(key, tail);
    await previous;
    try {
      return await job(this.entry(key, userId, sessionId));
    } finally {
      release();
      if (this.lanes.get(key) === tail) this.lanes.delete(key);
    }
  }

  end(userId: string, sessionId: string): void {
    this.entries.delete(this.key(userId, sessionId));
  }

  private entry(key: string, userId: string, sessionId: string): SessionEntry {
    this.purge();
    const existing = this.entries.get(key);
    if (existing) {
      existing.expiresAt = this.now() + this.ttlMs;
      return existing;
    }
    const created: SessionEntry = {
      session: createSession(userId, sessionId),
      dispatched: new Map(),
      external: new Map(),
      expiresAt: this.now() + this.ttlMs,
    };
    this.entries.set(key, created);
    return created;
  }

  private purge(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now && !this.lanes.has(key)) this.entries.delete(key);
    }
  }

  private key(userId: string, sessionId: string): string {
    if (!userId.trim() || !sessionId.trim()) throw new Error('session_key');
    return `${userId}\0${sessionId}`;
  }
}
