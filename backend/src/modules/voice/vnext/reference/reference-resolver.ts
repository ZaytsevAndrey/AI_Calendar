import type { TargetRefV1 } from '../contracts/types';

export type EntityRecord = {
  id: string;
  userId: string;
  type: 'task' | 'reminder' | 'external_event';
  name: string;
  status: 'open' | 'completed' | 'canceled';
  revision?: number;
  calendarId?: string;
  /** Present only when the record is a recurring series. Absence means not recurring. */
  recurring?: boolean;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  /** The one app slot of a one-off task. A move names it; no calendar event id is needed (VC-03). */
  slotId?: string | null;
  /** A Later (inbox) task with no placement (VC-02). */
  unscheduled?: boolean;
  /** Trusted calendar event id from the catalog. Never invented by the model. */
  googleEventId?: string | null;
  /** External events are writable only when this is explicitly true. */
  writable?: boolean;
  /** Calendar provider that owns an external event. Kept so a write goes to the same provider. */
  provider?: 'google' | 'microsoft' | 'apple';
  /** Recurring rows: each placed occurrence with its calendar event id, and the series event id. */
  occurrences?: Array<{ start: string; end: string; googleEventId: string | null; slotId?: string | null }>;
  seriesEventId?: string | null;
  /** The series group holds detached copies or parked days (D-03 stopgap, VB-02). */
  seriesCopies?: boolean;
  /** A fixed Luefy task keeps its slot until a clock moves it; a window does not reseat it. */
  fixed?: boolean;
  /** Stored fields of a day reminder, so an update can keep what the user did not restate (VC-05). */
  reminder?: StoredReminderFields;
};

export type StoredReminderFields = {
  dueYmd: string;
  notificationTime: string | null;
  description: string | null;
  recurrencePattern: 'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | null;
  recurrenceWeekDays: number[] | null;
};

export type ReferentBinding = { entityId?: string; localId?: string; phrase: string };

export type TargetResolution =
  | { status: 'new'; localId: string }
  | { status: 'resolved'; entityId: string; entityType: EntityRecord['type'] }
  | { status: 'operation'; opId: string }
  | { status: 'ambiguous'; candidateIds: string[] }
  | { status: 'unresolved'; phrase: string }
  | { status: 'rejected'; reason: 'cross_user' | 'missing' | 'external_readonly' | 'forged' | 'wrong_calendar' | 'ineligible' };

const ENDINGS = ['ого', 'ому', 'ими', 'ої', 'ий', 'ій', 'ами', 'ями', 'ові', 'еві', 'ів', 'ей', 'ом', 'ем', 'ою', 'ею', 'ах', 'ях', 'ам', 'ям', 'им', 'ім', 'их', 'іх', 'у', 'ю', 'і', 'ї', 'и', 'а', 'я', 'е', 'о', 'ь'];
const LEMMA: Record<string, string> = {
  report: 'звіт',
  meeting: 'нарада',
  flight: 'політ',
  letter: 'лист',
  walk: 'прогулянка',
  call: 'дзвінок',
  mail: 'пошта',
  medicine: 'ліки',
};

function normalize(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^the\s+/, '')
    .trim();
}

export function stem(value: string): string {
  const text = normalize(value);
  const mapped = LEMMA[text] ?? text;
  for (const ending of ENDINGS) {
    if (mapped.length - ending.length >= 3 && mapped.endsWith(ending)) return mapped.slice(0, -ending.length);
  }
  return mapped;
}

/** Same rule as the resolver. A single word of a longer phrase is not enough. */
export function relatedName(phrase: string, name: string): boolean {
  return related(phrase, name);
}

function related(phrase: string, name: string): boolean {
  const leftText = normalize(phrase);
  const rightText = normalize(name);
  if (!leftText || !rightText) return false;
  if (leftText === rightText) return true;
  const left = stem(leftText);
  const right = stem(rightText);
  if (left.length >= 3 && left === right) return true;
  const words = rightText.split(' ').map(stem).filter((word) => word.length >= 3);
  if (left.length >= 3 && words.includes(left)) return true;
  const phraseWords = leftText.split(' ').map(stem).filter((word) => word.length >= 3).flatMap((word) => (
    word.startsWith('післяобід') ? [stem('після'), stem('обід')] : [word]
  ));
  return phraseWords.length > 1 && phraseWords.every((word) => word === right || words.includes(word));
}

function accessible(entity: EntityRecord, userId: string): boolean {
  return entity.userId === userId && entity.status === 'open';
}

const TASK_ACTIONS = new Set(['delete', 'move', 'update', 'complete', 'skip', 'cancel']);

function rejectWrite(entity: EntityRecord, write: boolean, action?: string): TargetResolution | null {
  if (!write) return null;
  if (entity.status !== 'open') return { status: 'rejected', reason: 'ineligible' };
  if (action && TASK_ACTIONS.has(action) && entity.type === 'reminder') return { status: 'rejected', reason: 'ineligible' };
  if (action === 'remind' && entity.type !== 'reminder') return { status: 'rejected', reason: 'ineligible' };
  if (entity.type === 'external_event' && entity.writable !== true) return { status: 'rejected', reason: 'external_readonly' };
  return null;
}

function sameCalendar(entity: EntityRecord, wanted?: string): boolean {
  if (!wanted) return true;
  return entity.calendarId === wanted;
}

/**
 * A model id is untrusted. A description is matched exactly, by stem, or by a
 * known translation. One eligible candidate may be previewed. An unrelated
 * lone entity is not a candidate.
 */
export function resolveTarget(input: {
  target: TargetRefV1;
  userId: string;
  entities: EntityRecord[];
  referents: Record<string, ReferentBinding>;
  write: boolean;
  action?: string;
  /** A clarification answer may select one of several description matches. A fresh proposal may not. */
  allowIdDisambiguation?: boolean;
  /** Set only by trusted bulk expansion, never by model JSON. */
  trustedSetMember?: boolean;
  /** Set only when the id comes from an application referent, not from model JSON. */
  trustedBinding?: boolean;
}): TargetResolution {
  const { target } = input;
  if (target.kind === 'new') return { status: 'new', localId: target.localId };
  if (target.kind === 'operation_result') return { status: 'operation', opId: target.opId };
  if (target.kind === 'context') {
    const binding = input.referents[target.referentKey];
    if (!binding) return { status: 'unresolved', phrase: target.referentKey };
    if (binding.localId) return { status: 'new', localId: binding.localId };
    if (!binding.entityId) return { status: 'unresolved', phrase: binding.phrase };
    return resolveTarget({
      ...input,
      trustedBinding: true,
      target: { kind: 'existing', proposedId: binding.entityId },
    });
  }
  if (target.kind === 'unresolved') return { status: 'unresolved', phrase: target.phrase };
  const description = target.description?.trim() ?? '';
  const named = description
    ? input.entities.filter((entity) => accessible(entity, input.userId) && related(description, entity.name))
    : [];
  const wanted = target.calendarId;
  const matches = wanted ? named.filter((entity) => entity.calendarId === wanted) : named;
  if (wanted && description && !matches.length && named.length) return { status: 'rejected', reason: 'wrong_calendar' };
  if (target.proposedId) {
    const found = input.entities.find((entity) => entity.id === target.proposedId);
    if (found && found.userId !== input.userId) return { status: 'rejected', reason: 'cross_user' };
    if (matches.length === 1) {
      const denied = rejectWrite(matches[0], input.write, input.action);
      if (denied) return denied;
      if (!sameCalendar(matches[0], wanted)) return { status: 'rejected', reason: 'wrong_calendar' };
      return { status: 'resolved', entityId: matches[0].id, entityType: matches[0].type };
    }
    if (matches.length > 1) {
      const hinted = found && matches.some((entity) => entity.id === found.id);
      if (hinted && found && (input.trustedSetMember || input.allowIdDisambiguation)) {
        const denied = rejectWrite(found, input.write, input.action);
        if (denied) return denied;
        if (!sameCalendar(found, wanted)) return { status: 'rejected', reason: 'wrong_calendar' };
        return { status: 'resolved', entityId: found.id, entityType: found.type };
      }
      return { status: 'ambiguous', candidateIds: matches.map((entity) => entity.id) };
    }
    if (!found) return { status: 'rejected', reason: 'forged' };
    if (description && !related(description, found.name)) return { status: 'unresolved', phrase: description };
    const denied = rejectWrite(found, input.write, input.action);
    if (denied) return denied;
    if (!sameCalendar(found, wanted)) return { status: 'rejected', reason: 'wrong_calendar' };
    if (!description && !input.trustedSetMember && !input.trustedBinding) {
      return { status: 'unresolved', phrase: '' };
    }
    return { status: 'resolved', entityId: found.id, entityType: found.type };
  }
  if (!description) return { status: 'unresolved', phrase: '' };
  if (matches.length === 1) {
    const denied = rejectWrite(matches[0], input.write, input.action);
    if (denied) return denied;
    return { status: 'resolved', entityId: matches[0].id, entityType: matches[0].type };
  }
  if (matches.length > 1) return { status: 'ambiguous', candidateIds: matches.map((entity) => entity.id) };
  return { status: 'unresolved', phrase: description };
}
