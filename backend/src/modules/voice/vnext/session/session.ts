import type { PlanDraft, VoiceWriteIntent } from '../../voice-agent.types';
import type { SemanticOperationV1 } from '../contracts/types';
import type { StructuredState } from '../state/structured-state';
import type { BlockedOperation } from './clarification';
import type { DialogueClarification } from './dialogue';
import type { ReferentBinding } from '../reference/reference-resolver';

export type VNextArm = 'A' | 'B';

export type PendingClarification = {
  question: string;
  blocked: BlockedOperation[];
  history: string[];
  utterance: string;
};

export type VNextSession = {
  userId: string;
  sessionId: string;
  arm: VNextArm | null;
  referents: Record<string, ReferentBinding>;
  pendingIntents: VoiceWriteIntent[] | null;
  pendingSummary: string | null;
  openQuestion: string | null;
  /** Unresolved questions in ask order. `openQuestion` is the first. */
  clarifications: DialogueClarification[];
  /** Valid operations held while another operation in the same turn is blocked. */
  heldIntents: VoiceWriteIntent[];
  /** Op ids adapted into `heldIntents`. A dependency is satisfied only for these ids. */
  adaptedOpIds: string[];
  /** Op ids withdrawn in this clarification. They are not successful prerequisites. */
  canceledOpIds: string[];
  /** The blocked semantic operations and the question that is still open. */
  pendingClarification: PendingClarification | null;
  planDraft: PlanDraft | null;
  qualitativeByItemId: Record<string, string>;
  appliedKeys: string[];
  /** Entity revisions observed when the current preview was built. */
  previewRevisions: Record<string, number>;
  /** Owner, calendar and write flag observed with the current preview. */
  previewAccess: Record<string, { userId: string; calendarId: string | null; external: boolean; writable: boolean }>;
  /** Semantic operations behind the current preview. A correction edits these, it does not create another object. */
  pendingOperations: SemanticOperationV1[];
  /** Ids expanded from a scope of all. Confirm must see this same set again. */
  previewTargetIds: string[];
  /** The user tried to change this preview and that attempt did not produce a new one. */
  previewSuspended: boolean;
  /** Apply outcomes. A restored pending write is unknown and is not executed again. */
  applyLedger: Array<{ key: string; status: 'pending' | 'succeeded' | 'failed' | 'unknown'; error?: string }>;
  turns: Array<{ role: 'user' | 'assistant'; text: string }>;
  /**
   * Structured preview protocol. Absent or legacy means a pre-cutover pending that cannot confirm.
   * Completed applyLedger rows are kept; open legacy previews are invalidated on the structured path.
   */
  protocol?: 'legacy' | 'structured';
  structured?: StructuredState | null;
  /** Last projected intents for the open structured preview. */
  structuredIntents?: VoiceWriteIntent[] | null;
};

const MAX_TURNS = 8;

export function createSession(userId: string, sessionId: string): VNextSession {
  return {
    userId,
    sessionId,
    arm: null,
    referents: {},
    pendingIntents: null,
    pendingSummary: null,
    openQuestion: null,
    clarifications: [],
    heldIntents: [],
    adaptedOpIds: [],
    canceledOpIds: [],
    pendingClarification: null,
    planDraft: null,
    qualitativeByItemId: {},
    appliedKeys: [],
    previewRevisions: {},
    previewAccess: {},
    pendingOperations: [],
    previewTargetIds: [],
    previewSuspended: false,
    applyLedger: [],
    turns: [],
    protocol: undefined,
    structured: null,
    structuredIntents: null,
  };
}

/** Pin the interpreter for the life of the session. A second arm is refused. */
export function pinArm(session: VNextSession, arm: VNextArm): boolean {
  if (session.arm && session.arm !== arm) return false;
  session.arm = arm;
  return true;
}

export function appendTurn(session: VNextSession, role: 'user' | 'assistant', text: string): void {
  session.turns.push({ role, text });
  if (session.turns.length > MAX_TURNS) session.turns.splice(0, session.turns.length - MAX_TURNS);
}

export function clearPending(session: VNextSession): void {
  session.pendingIntents = null;
  session.pendingSummary = null;
  session.openQuestion = null;
  session.clarifications = [];
  session.heldIntents = [];
  session.adaptedOpIds = [];
  session.canceledOpIds = [];
  session.pendingClarification = null;
  session.previewRevisions = {};
  session.previewAccess = {};
  session.pendingOperations = [];
  session.previewTargetIds = [];
  session.previewSuspended = false;
  session.structuredIntents = null;
}

/** Drop a legacy pending preview. Keep applyLedger and appliedKeys. */
export function invalidateLegacyPreview(session: VNextSession): void {
  if (session.protocol === 'structured') return;
  clearPending(session);
  session.protocol = 'structured';
}

export function intentKey(intent: VoiceWriteIntent): string {
  const taskId = intent.type === 'command' && typeof intent.command.taskId === 'string' ? intent.command.taskId : undefined;
  return JSON.stringify({ type: intent.type, summary: intent.summary, ...(taskId ? { taskId } : {}) });
}

const SESSION_MS = 24 * 60 * 60 * 1000;

export function exportSession(session: VNextSession, nowIso: string): string {
  return JSON.stringify({ ...session, expiresAt: new Date(Date.parse(nowIso) + SESSION_MS).toISOString() });
}

export function restoreSession(raw: string, nowIso: string): { ok: true; session: VNextSession } | { ok: false; reason: 'expired' | 'invalid' } {
  try {
    const parsed = JSON.parse(raw) as VNextSession & { expiresAt?: string };
    if (!parsed || parsed.userId == null || parsed.sessionId == null) return { ok: false, reason: 'invalid' };
    if (parsed.expiresAt && Date.parse(parsed.expiresAt) <= Date.parse(nowIso)) return { ok: false, reason: 'expired' };
    const session = createSession(parsed.userId, parsed.sessionId);
    Object.assign(session, parsed);
    delete (session as VNextSession & { expiresAt?: string }).expiresAt;
    session.pendingIntents = parsed.pendingIntents ?? null;
    session.appliedKeys = parsed.appliedKeys ?? [];
    session.previewRevisions = parsed.previewRevisions ?? {};
    session.previewAccess = parsed.previewAccess ?? {};
    session.pendingOperations = parsed.pendingOperations ?? [];
    session.clarifications = parsed.clarifications ?? [];
    session.previewTargetIds = parsed.previewTargetIds ?? [];
    session.previewSuspended = parsed.previewSuspended ?? false;
    session.applyLedger = (parsed.applyLedger ?? []).map((row) =>
      row.status === 'pending' ? { ...row, status: 'unknown' as const, error: row.error ?? 'interrupted' } : row,
    );
    return { ok: true, session };
  } catch {
    return { ok: false, reason: 'invalid' };
  }
}

export function dropDeletedReferents(session: VNextSession, entityId: string): void {
  for (const [key, binding] of Object.entries(session.referents)) {
    if (binding.entityId === entityId) delete session.referents[key];
  }
}
