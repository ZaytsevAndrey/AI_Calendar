import { Injectable } from '@nestjs/common';
import type {
  DayPlanProposal,
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
      pendingProposal: null,
      pendingSummary: null,
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
      proposal: DayPlanProposal | null;
      summary: string | null;
    },
  ): void {
    const session = this.getOrCreate(userId, sessionId);
    session.pendingIntents = pending.intents;
    session.pendingProposal = pending.proposal;
    session.pendingSummary = pending.summary;
  }

  clearPending(userId: string, sessionId: string): void {
    this.setPending(userId, sessionId, {
      intents: null,
      proposal: null,
      summary: null,
    });
  }

  clear(userId: string, sessionId: string): void {
    this.sessions.delete(this.key(userId, sessionId));
  }
}
