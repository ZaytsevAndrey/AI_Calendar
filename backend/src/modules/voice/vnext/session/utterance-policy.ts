import type { DayPlanEditV1, SemanticEnvelopeV1, SemanticOperationV1, TimeOfDayLabelV1 } from '../contracts/types';

const CONFIRM_WORD = 'так|yes|ok|okay|ок|confirm|yeah|yep|підтверджую|підтверди';
const CONFIRM = new RegExp(`^(?:${CONFIRM_WORD})(?:[, ]+(?:${CONFIRM_WORD}))*(?:\\s+ще\\s+раз)?\\.?$`, 'i');
const CANCEL = /^(?:забудь|не треба|відміна|cancel|never mind|я передумав|ні, залиш як є|залиш як є|скасуй(?: цю зміну| це)?(?:, я передумав)?)\.?$/i;

/** A confirmation is only a short confirmation. A correction is not one. */
export function isExplicitConfirm(transcript: string): boolean {
  return CONFIRM.test(transcript.trim());
}

/** A cancellation of the current preview. A request to cancel a named entity is not one. */
export function isExplicitCancel(transcript: string): boolean {
  return CANCEL.test(transcript.trim());
}

const NAMED_ACT = /^(?:закрий|закрити|заверши|виконай|complete|mark(?:\s+done)?)\s+(?:задачу|завдання|task\s+)?(.+?)\.?$/i;

/**
 * "Закрий ок" names a task. A bare "ок" does not. A mixed sentence is not this shape.
 * The returned title is the user's token, not a chosen entity.
 */
export function explicitCompletionTitle(transcript: string): string | null {
  const text = transcript.trim();
  if (!text || isExplicitConfirm(text) || isExplicitCancel(text)) return null;
  const match = text.match(NAMED_ACT);
  if (!match) return null;
  const title = match[1].replace(/^(?:задачу|завдання|task)\s+/i, '').trim();
  if (!title || /\s/.test(title) || /^(?:задача|завдання|task|event|reminder)$/i.test(title)) return null;
  return title;
}

/**
 * Confirmation with nothing pending is a control, not a write.
 * This does not invent an operation from keywords.
 */
export function alignEnvelope(input: {
  transcript: string;
  envelope: SemanticEnvelopeV1;
  pending: boolean;
}): SemanticEnvelopeV1 {
  if (!input.pending && isExplicitConfirm(input.transcript)) {
    return { version: '1', kind: 'control', operations: [], control: 'confirm_pending' };
  }
  if (input.envelope.kind === 'answer' && input.envelope.operations.length) {
    return { ...input.envelope, kind: 'operations' };
  }
  return input.envelope;
}

function qualitativeOf(operation: SemanticOperationV1): TimeOfDayLabelV1 | undefined {
  const constraint = operation.constraints.find((item) => item.kind === 'time_of_day');
  return constraint && constraint.kind === 'time_of_day' ? constraint.label : undefined;
}

function durationOf(operation: SemanticOperationV1): number | null {
  const constraint = operation.constraints.find((item) => item.kind === 'duration');
  return constraint && constraint.kind === 'duration' ? constraint.minutes : null;
}

function scheduledSeparately(operation: SemanticOperationV1): boolean {
  return operation.constraints.some((constraint) =>
    constraint.kind === 'date' || constraint.kind === 'weekday' || constraint.kind === 'relative_time' || constraint.kind === 'clock',
  );
}

/**
 * An undated create while a draft is open belongs to that draft.
 * A create that already names a date, weekday, or clock stays a standalone task.
 * The decision uses the envelope, not a keyword scan of the utterance.
 */
const STANDALONE = /не в план|окремо|not in the plan|not in this plan|standalone/i;

export function routeOpenDraft(envelope: SemanticEnvelopeV1, draftOpen: boolean, transcript = ''): SemanticEnvelopeV1 {
  if (STANDALONE.test(transcript)) return envelope;
  if (!draftOpen || envelope.kind !== 'operations' || envelope.operations.length === 0) return envelope;
  const creates = envelope.operations.filter((operation) => operation.action === 'create' && operation.target.kind === 'new');
  if (creates.length !== envelope.operations.length) return envelope;
  if (creates.some(scheduledSeparately)) return envelope;
  if (creates.some((operation) => !operation.changes.title?.trim())) return envelope;
  const edits: DayPlanEditV1[] = creates.map((operation) => ({
    op: 'add_task',
    name: operation.changes.title?.trim() ?? '',
    durationMinutes: durationOf(operation),
    preferredHm: null,
    earliestHm: null,
    deadlineHm: null,
    ...(qualitativeOf(operation) ? { qualitative: qualitativeOf(operation) } : {}),
  }));
  return { version: '1', kind: 'day_plan', operations: [], dayPlan: { phase: 'edit', edits } };
}
