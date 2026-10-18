import { Injectable } from '@nestjs/common';
import type {
  PendingBatch,
  PlanDraft,
  VoiceAgentSession,
  VoiceSessionTurn,
  VoiceWriteIntent,
} from './voice-agent.types';

/**
 * In-memory voice sessions (v1). Cleared on widget close; lost on process restart.
 * No idle TTL.
 */
@Injectable()
export class VoiceSessionStore {
  private readonly sessions = new Map<string, VoiceAgentSession>();

  private key(userId: string, sessionId: string): string {
    return `${userId}:${sessionId}`;
  }

  getOrCreate(userId: string, sessionId: string): VoiceAgentSession {
    const key = this.key(userId, sessionId);
    const existing = this.sessions.get(key);
    if (existing) return existing;
    const created: VoiceAgentSession = {
      sessionId,
      userId,
      createdAt: Date.now(),
      clarifyCount: 0,
      turns: [],
      pendingIntents: null,
      pendingSummary: null,
      pendingKind: null,
      pendingBatch: null,
      planDraft: null,
      groqKeyIndex: null,
    };
    this.sessions.set(key, created);
    return created;
  }

  get(userId: string, sessionId: string): VoiceAgentSession | undefined {
    return this.sessions.get(this.key(userId, sessionId));
  }

  appendTurn(
    userId: string,
    sessionId: string,
    turn: VoiceSessionTurn,
  ): VoiceAgentSession {
    const session = this.getOrCreate(userId, sessionId);
    session.turns.push(turn);
    if (session.turns.length > 40) {
      session.turns = session.turns.slice(-40);
    }
    return session;
  }

  setClarifyCount(userId: string, sessionId: string, count: number): void {
    this.getOrCreate(userId, sessionId).clarifyCount = count;
  }

  setPending(
    userId: string,
    sessionId: string,
    pending: {
      intents: VoiceWriteIntent[] | null;
      summary: string | null;
      kind: 'plan' | 'writes' | null;
    },
  ): void {
    const session = this.getOrCreate(userId, sessionId);
    session.pendingIntents = pending.intents;
    session.pendingSummary = pending.summary;
    session.pendingKind = pending.kind;
  }

  clearPending(userId: string, sessionId: string): void {
    this.setPending(userId, sessionId, { intents: null, summary: null, kind: null });
  }

  setPendingBatch(
    userId: string,
    sessionId: string,
    batch: PendingBatch | null,
  ): void {
    this.getOrCreate(userId, sessionId).pendingBatch = batch;
  }

  setPlanDraft(
    userId: string,
    sessionId: string,
    draft: PlanDraft | null,
  ): void {
    this.getOrCreate(userId, sessionId).planDraft = draft;
  }

  clear(userId: string, sessionId: string): void {
    this.sessions.delete(this.key(userId, sessionId));
  }
}
