import type { VNextSession } from './session';

export type DialoguePhase = 'idle' | 'clarifying' | 'preview' | 'suspended' | 'draft';

export type DialogueClarification = {
  id: string;
  question: string;
  missing: string;
  operationId: string | null;
};

/** One active question, with any later questions kept in order. */
export function ask(session: VNextSession, item: DialogueClarification): void {
  if (!session.clarifications.some((row) => row.id === item.id && row.missing === item.missing)) {
    session.clarifications.push(item);
  }
  session.openQuestion = session.clarifications[0]?.question ?? item.question;
}

export function clearDialogue(session: VNextSession): void {
  session.clarifications = [];
  session.openQuestion = null;
}

/** Drop the active question and expose the next one. Returns that question, if any. */
export function resolveActive(session: VNextSession): string | null {
  session.clarifications = session.clarifications.slice(1);
  session.openQuestion = session.clarifications[0]?.question ?? null;
  return session.openQuestion;
}

export function phaseOf(session: VNextSession): DialoguePhase {
  if (session.previewSuspended) return 'suspended';
  if (session.clarifications.length || session.openQuestion || session.pendingClarification) return 'clarifying';
  if (session.pendingIntents?.length) return 'preview';
  if (session.planDraft) return 'draft';
  return 'idle';
}

export function canConfirm(session: VNextSession): boolean {
  return phaseOf(session) === 'preview' && !session.previewSuspended && session.clarifications.length === 0;
}
