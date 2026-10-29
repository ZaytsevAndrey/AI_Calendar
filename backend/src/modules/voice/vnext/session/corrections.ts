import type { SemanticConstraintV1, SemanticEnvelopeV1, SemanticOperationV1 } from '../contracts/types';
import { relatedName, type EntityRecord } from '../reference/reference-resolver';

const TEMPORAL = new Set<SemanticConstraintV1['kind']>(['date', 'clock', 'weekday', 'time_of_day', 'relative_time', 'duration']);

export type CorrectionResult =
  | { status: 'merged'; operations: SemanticOperationV1[] }
  | { status: 'ambiguous' }
  | { status: 'none' };

function titleOf(operation: SemanticOperationV1): string {
  return (operation.changes.title ?? '').trim();
}

function sameTitle(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: 'accent' }) === 0;
}

function isTemporal(operation: SemanticOperationV1): boolean {
  return operation.constraints.some((constraint) => TEMPORAL.has(constraint.kind));
}

function isDaySource(constraint: SemanticConstraintV1): boolean {
  return constraint.kind === 'date' || constraint.kind === 'weekday' || (constraint.kind === 'relative_time' && constraint.unit === 'day');
}

function replaceConstraints(base: SemanticOperationV1, edit: SemanticOperationV1): SemanticOperationV1 {
  const kinds = new Set(edit.constraints.map((constraint) => constraint.kind));
  const editReplacesDay = edit.constraints.some(isDaySource);
  return {
    ...base,
    changes: { ...base.changes, ...edit.changes, title: base.changes.title || edit.changes.title },
    constraints: supersedeConstraints([
      ...base.constraints.filter((constraint) => !kinds.has(constraint.kind) && !(editReplacesDay && isDaySource(constraint))),
      ...edit.constraints,
    ]),
  };
}

/** An exact clock or dated clock replaces a qualitative time or an ordering constraint. */
export function supersedeConstraints(constraints: SemanticConstraintV1[]): SemanticConstraintV1[] {
  const hasClock = constraints.some((constraint) => constraint.kind === 'clock' && (constraint.role === 'start' || constraint.role === 'preferred'));
  const hasDay = constraints.some((constraint) => constraint.kind === 'date' || constraint.kind === 'weekday');
  if (!hasClock) return constraints;
  return constraints.filter((constraint) => constraint.kind !== 'time_of_day' && constraint.kind !== 'ordering' && !(hasDay && constraint.kind === 'relative_time'));
}

/** A move cannot carry a duration. The same described target becomes an update. The model id is dropped. */
export function normalizeMoveDuration(operation: SemanticOperationV1): SemanticOperationV1 {
  const hasDuration = operation.constraints.some((constraint) => constraint.kind === 'duration');
  if (operation.action !== 'move' || !hasDuration || operation.target.kind !== 'existing' || !operation.target.description) return operation;
  return { ...operation, action: 'update', target: { kind: 'existing', description: operation.target.description } };
}

/**
 * Edits a pending operation when the follow-up names its id, or when the
 * follow-up is one temporal change of the only matching pending title.
 * A different title is a new request. Several matches are ambiguous.
 */
const SPOKEN_HOUR: ReadonlyArray<readonly [RegExp, number]> = [
  [/перш(?:ій|ої|ою)/giu, 1],
  [/друг(?:ій|ої|ою)/giu, 2],
  [/трет(?:ій|ої|ою)/giu, 3],
  [/четверт(?:ій|ої|ою)/giu, 4],
  [/п['ʼ’]?ят(?:ій|ої|ою)/giu, 5],
  [/шост(?:ій|ої|ою)/giu, 6],
  [/сьом(?:ій|ої|ою)/giu, 7],
  [/восьм(?:ій|ої|ою)/giu, 8],
  [/дев['ʼ’]?ят(?:ій|ої|ою)/giu, 9],
  [/десят(?:ій|ої|ою)/giu, 10],
  [/одинадцят(?:ій|ої|ою)/giu, 11],
  [/дванадцят(?:ій|ої|ою)/giu, 12],
];

/**
 * One spoken hour with an explicit part of day. "О сьомій" alone is not a clock.
 * Two hour words are a range and stay unresolved. Thursday ("четвер") is not an hour.
 */
export function spokenClock(transcript: string): string | null {
  const hits: Array<{ index: number; hour: number }> = [];
  for (const [pattern, hour] of SPOKEN_HOUR) {
    for (const match of transcript.matchAll(pattern)) {
      if (match.index != null) hits.push({ index: match.index, hour });
    }
  }
  if (hits.length !== 1) return null;
  const after = transcript.slice(hits[0].index);
  const period = after.match(/^\S+\s+(ранку|вечора|ночі)/iu);
  if (!period) return null;
  const hour = hits[0].hour;
  const name = period[1].toLocaleLowerCase();
  if (name === 'ранку') return `${String(hour === 12 ? 0 : hour).padStart(2, '0')}:00`;
  const evening = hour === 12 ? 0 : hour + 12;
  return `${String(evening).padStart(2, '0')}:00`;
}

/** One HH:MM, or one spoken hour with a part of day, revises the only pending operation. */
export function recoverSingleClock(pending: SemanticOperationV1[], transcript: string): SemanticOperationV1[] | null {
  const found = [...transcript.matchAll(/(?:^|[^\d])([01]?\d|2[0-3])[:.]([0-5]\d)(?!\d)/g)];
  const spoken = found.length === 0 ? spokenClock(transcript) : null;
  if (found.length > 1 || (found.length !== 1 && !spoken) || pending.length !== 1) return null;
  const base = pending[0];
  if (base.action === 'delete' || base.action === 'complete' || base.action === 'skip' || base.action === 'cancel') return null;
  const digit = found.length === 1 ? found[0] : null;
  const clock = spoken ?? (digit ? `${digit[1].padStart(2, '0')}:${digit[2]}` : null);
  if (!clock) return null;
  const constraints: SemanticConstraintV1[] = base.constraints.filter((constraint) => !(constraint.kind === 'clock' && (constraint.role === 'start' || constraint.role === 'preferred')));
  constraints.push({ kind: 'clock', value: clock, role: 'start' });
  if (base.changes.reminder?.dueYmd && !constraints.some((constraint) => constraint.kind === 'date')) {
    constraints.push({ kind: 'date', value: base.changes.reminder.dueYmd, precision: 'day' });
  }
  const superseded = supersedeConstraints(constraints);
  constraints.splice(0, constraints.length, ...superseded);
  const reminder = base.action === 'remind' || base.changes.reminder
    ? { op: base.changes.reminder?.op ?? 'create' as const, ...base.changes.reminder, notificationTime: clock }
    : undefined;
  return [{
    ...base,
    constraints,
    changes: { ...base.changes, ...(reminder ? { reminder } : {}) },
    source: { text: transcript },
  }];
}

const CLOSE_VERB = /(закрий|закрити|заверши|виконай|познач(?:\s+\S+){0,3}\s+виконан|mark\s+.+\s+done)/i;
const EXPLICIT_NEW = /(додай|додати|створи|створити|запиши|кинь|add an|add a|create a|create an|new task)/i;
const MODIFY = /(перенес|постав|зроби|зміни|онови|move|shift|reschedule)/i;

export type OperationIntent =
  | { status: 'ready'; operation: SemanticOperationV1 }
  | { status: 'ambiguous' };
const TYPE_TITLE = /^(задача|завдання|подія|нагадування|task|event|reminder)$/i;

function closing(edit: SemanticOperationV1, transcript: string): boolean {
  return edit.action === 'complete' || (edit.action === 'cancel' && CLOSE_VERB.test(transcript));
}

function titlesRelated(pendingTitle: string, incomingTitle: string): boolean {
  if (!pendingTitle || !incomingTitle) return false;
  if (sameTitle(pendingTitle, incomingTitle)) return true;
  const left = pendingTitle.toLocaleLowerCase();
  const right = incomingTitle.toLocaleLowerCase();
  return left.length >= 3 && right.length >= 3 && (right.includes(left) || left.includes(right));
}

function findPending(pending: SemanticOperationV1[], edit: SemanticOperationV1): SemanticOperationV1[] {
  if (edit.target.kind === 'operation_result') {
    const opId = edit.target.opId;
    return pending.filter((operation) => operation.opId === opId);
  }
  const incomingTitle = titleOf(edit);
  if (!incomingTitle) return [...pending];
  return pending.filter((operation) => titlesRelated(titleOf(operation), incomingTitle));
}

function applyEdit(base: SemanticOperationV1, edit: SemanticOperationV1, transcript: string): SemanticOperationV1 {
  if (closing(edit, transcript) || edit.action === 'delete' || edit.action === 'skip') {
    const action = closing(edit, transcript) ? 'complete' as const : edit.action;
    return {
      ...base,
      action,
      target: base.target,
      changes: { title: base.changes.title || edit.changes.title },
      constraints: [],
      source: { text: transcript || edit.source.text },
    };
  }
  const merged = replaceConstraints(base, edit);
  const incomingTitle = titleOf(edit);
  const pendingTitle = titleOf(base);
  const title = incomingTitle && pendingTitle && !sameTitle(incomingTitle, pendingTitle) && titlesRelated(pendingTitle, incomingTitle)
    ? (incomingTitle.length >= pendingTitle.length ? incomingTitle : pendingTitle)
    : (pendingTitle || incomingTitle);
  const temporalEdit = edit.action === 'create' || edit.action === 'move' || edit.action === 'update';
  return {
    ...merged,
    action: temporalEdit ? base.action : edit.action,
    target: base.target,
    changes: { ...merged.changes, ...(title ? { title } : {}) },
  };
}

/**
 * Revises the current preview. Removing one unconfirmed create does not delete
 * a stored task. Replacing a move with "close it" keeps the same target.
 * A different title that does not refer to a pending operation is a new request.
 */
export function correctPending(pending: SemanticOperationV1[], incoming: SemanticOperationV1[], transcript = ''): CorrectionResult {
  if (!pending.length || !incoming.length) return { status: 'none' };
  const removed = new Set<string>();
  let ambiguous = false;
  for (const edit of incoming) {
    if (edit.action !== 'cancel' && edit.action !== 'delete') continue;
    if (closing(edit, transcript)) continue;
    const hits = findPending(pending, edit);
    if (hits.length > 1) ambiguous = true;
    if (hits.length === 1 && (hits[0].action === 'create' || hits[0].action === 'remind' || edit.action === 'cancel')) removed.add(hits[0].opId);
  }
  if (ambiguous) return { status: 'ambiguous' };
  let next = pending.filter((operation) => !removed.has(operation.opId));
  const edits = incoming.filter((edit) => !((edit.action === 'cancel' || edit.action === 'delete') && !closing(edit, transcript)));
  for (const edit of edits) {
    const hits = findPending(next, edit);
    if (hits.length > 1) return { status: 'ambiguous' };
    if (hits.length === 1) {
      next = next.map((operation) => (operation.opId === hits[0].opId ? applyEdit(operation, edit, transcript) : operation));
      continue;
    }
    const dropped = findPending(pending.filter((operation) => removed.has(operation.opId)), edit);
    if (dropped.length) continue;
    if (edit.action === 'create' && titleOf(edit) && !isTemporal(edit) && next.length && !findPending(pending, edit).length) {
      return { status: 'none' };
    }
    if (edit.action === 'create' || edit.action === 'update' || edit.action === 'move' || edit.action === 'complete') next.push(edit);
  }
  if (!next.length && !removed.size) return { status: 'none' };
  return { status: 'merged', operations: next };
}

const WEEKDAYS: Array<[RegExp, number]> = [
  [/(?<![\p{L}])понед[іi]л/iu, 1],
  [/(?<![\p{L}])в[іi]втор/iu, 2],
  [/(?<![\p{L}])серед/iu, 3],
  [/(?<![\p{L}])четвер/iu, 4],
  [/(?<![\p{L}])п['’]?ятниц/iu, 5],
  [/(?<![\p{L}])субот/iu, 6],
  [/(?<![\p{L}])нед[іi]л/iu, 0],
];

/** One weekday in a failed correction revises the only pending operation. */
export function recoverWeekday(pending: SemanticOperationV1[], transcript: string): SemanticOperationV1[] | null {
  const found = WEEKDAYS.filter(([pattern]) => pattern.test(transcript));
  if (found.length !== 1 || pending.length !== 1) return null;
  const base = pending[0];
  if (base.action === 'delete' || base.action === 'complete' || base.action === 'skip' || base.action === 'cancel') return null;
  const constraints = base.constraints.filter((constraint) => !isDaySource(constraint));
  constraints.push({ kind: 'weekday', weekday: found[0][1] as 0 | 1 | 2 | 3 | 4 | 5 | 6, which: 'next' });
  return [{ ...base, constraints, source: { text: transcript } }];
}

/** "Перейменуй її на …" keeps the pending target and replaces only the title. */
export function recoverRename(pending: SemanticOperationV1[], transcript: string): SemanticOperationV1[] | null {
  const match = transcript.trim().match(/перейменуй(?:\s+\S+){0,4}\s+на\s+(.+?)[.?!]*$/i)
    ?? transcript.trim().match(/rename(?:\s+\S+){0,4}\s+to\s+(.+?)[.?!]*$/i);
  if (!match || pending.length !== 1) return null;
  const title = match[1].trim();
  if (!title) return null;
  return [{ ...pending[0], changes: { ...pending[0].changes, title }, source: { text: transcript } }];
}

export function placeholderTitle(title: string | undefined): boolean {
  return TYPE_TITLE.test((title ?? '').trim().toLocaleLowerCase());
}

/** "Створи задачу." names the type. A longer utterance may use that word as a real title. */
export function bareTypeRequest(transcript: string, title: string | undefined): boolean {
  if (!placeholderTitle(title)) return false;
  return /^(?:створи|додай|запиши|create|add)\s+(?:задачу|завдання|подію|нагадування|a task|an event|a reminder)[.!?\s]*$/i.test(transcript.trim());
}

/** A bare year or a product number after the title stays in the title. */
export function keepTitleToken(operation: SemanticOperationV1, transcript: string): SemanticOperationV1 {
  const title = titleOf(operation);
  if (!title || operation.action !== 'create') return operation;
  const at = transcript.toLocaleLowerCase().indexOf(title.toLocaleLowerCase());
  if (at < 0) return operation;
  const words = transcript.slice(at + title.length).trim().split(/\s+/);
  const kept: string[] = [];
  for (const word of words) {
    const clean = word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (!clean || /^(на|о|в|у|і|й|та|для|до|from|at|on|for)$/i.test(clean)) break;
    if (!/\d/.test(clean) && kept.length === 0) break;
    kept.push(clean);
    if (kept.length === 2 || (kept.length === 1 && !/^\d+$/.test(clean))) break;
  }
  if (!kept.length) return operation;
  const suffix = kept.join(' ');
  if (title.toLocaleLowerCase().includes(suffix.toLocaleLowerCase())) return operation;
  const next: SemanticOperationV1 = { ...operation, changes: { ...operation.changes, title: `${title} ${suffix}` } };
  if (/^\d{4}$/.test(kept[0]) && !/(січ|лют|берез|квіт|трав|черв|лип|серп|верес|жовт|листоп|груд)/i.test(transcript)) {
    next.constraints = operation.constraints.filter((constraint) => constraint.kind !== 'date' && constraint.kind !== 'weekday' && constraint.kind !== 'relative_time');
  }
  return next;
}

/**
 * Title similarity is not enough to turn a create into an update.
 * An explicit add stays a create. An explicit modification, or a follow-up
 * to a turn that already named the only matching task, becomes an update.
 * Several matches, or a temporal create with no modification signal, stay unresolved.
 */
export function classifyOperationIntent(
  operation: SemanticOperationV1,
  entities: EntityRecord[],
  userId: string,
  transcript: string,
  priorUserTurns: string[] = [],
): OperationIntent {
  const shaped = normalizeMoveDuration(operation);
  if (shaped.action !== 'create' || EXPLICIT_NEW.test(transcript) || !isTemporal(shaped)) return { status: 'ready', operation: shaped };
  const title = titleOf(shaped);
  if (!title) return { status: 'ready', operation: shaped };
  const matches = entities.filter((entity) => entity.userId === userId && entity.status === 'open' && entity.type === 'task' && relatedName(title, entity.name));
  if (!matches.length) return { status: 'ready', operation: shaped };
  const mentioned = priorUserTurns.some((turn) => relatedName(title, turn));
  if (matches.length > 1 || (!MODIFY.test(transcript) && !mentioned)) return { status: 'ambiguous' };
  return { status: 'ready', operation: { ...shaped, action: 'update', target: { kind: 'existing', description: title } } };
}

/** @deprecated Use classifyOperationIntent. Kept so older call sites keep the safe subset. */
export function rebindUniqueModification(operation: SemanticOperationV1, entities: EntityRecord[], userId: string, transcript: string, priorUserTurns: string[] = []): SemanticOperationV1 {
  const classified = classifyOperationIntent(operation, entities, userId, transcript, priorUserTurns);
  return classified.status === 'ready' ? classified.operation : operation;
}

/** "Не на годину, а на півтори" revises the only pending duration when the model output is unusable. */
export function recoverDuration(pending: SemanticOperationV1[], transcript: string): SemanticOperationV1[] | null {
  if (pending.length !== 1) return null;
  const base = pending[0];
  if (base.action === 'delete' || base.action === 'complete' || base.action === 'skip' || base.action === 'cancel') return null;
  let minutes: number | null = null;
  if (/півтори/i.test(transcript)) minutes = 90;
  else if (/пів\s*години|half an hour/i.test(transcript)) minutes = 30;
  else {
    const match = transcript.match(/(\d+)\s*хвилин/i);
    if (match) minutes = Number(match[1]);
  }
  if (minutes == null || !Number.isFinite(minutes)) return null;
  const constraints: SemanticConstraintV1[] = base.constraints.filter((constraint) => constraint.kind !== 'duration');
  constraints.push({ kind: 'duration', minutes });
  return [{ ...base, constraints, source: { text: transcript } }];
}

/** "Ні, іншу, після обіду" moves the pending action onto the one other matching task. */
export function recoverSwitchedTarget(
  pending: SemanticOperationV1[],
  transcript: string,
  entities: EntityRecord[],
  userId: string,
): SemanticOperationV1[] | null {
  if (pending.length !== 1 || !/^ні[, ]|not that one|the other/i.test(transcript.trim())) return null;
  const phrase = transcript.trim()
    .replace(/^ні,?\s+/i, '')
    .replace(/^(?:not that one|the other),?\s*/i, '')
    .replace(/^(?:іншу|інша|інше|ту),?\s*/i, '')
    .trim();
  if (!phrase) return null;
  const matches = entities.filter((entity) => entity.userId === userId && entity.status === 'open' && relatedName(phrase, entity.name));
  if (matches.length !== 1) return null;
  return [{ ...pending[0], target: { kind: 'existing', description: matches[0].name }, source: { text: transcript } }];
}

function quotedTitle(question: string): string {
  return (question.match(/«([^»]+)»|"([^"]+)"/)?.[1] || question.match(/«([^»]+)»|"([^"]+)"/)?.[2] || '').trim();
}

function weekdayIn(transcript: string): 0 | 1 | 2 | 3 | 4 | 5 | 6 | null {
  const found = WEEKDAYS.filter(([pattern]) => pattern.test(transcript));
  return found.length === 1 ? found[0][1] as 0 | 1 | 2 | 3 | 4 | 5 | 6 : null;
}

/**
 * A clarification that only asks for a clock, after the user already named a weekday,
 * becomes a dated task with no invented clock.
 */
export function recoverWeekdayCreate(transcript: string, envelope: SemanticEnvelopeV1): SemanticEnvelopeV1 | null {
  if (envelope.kind !== 'clarification') return null;
  const question = envelope.clarification?.question ?? '';
  if (!/на яку годину|what time|which time/i.test(question)) return null;
  const weekday = weekdayIn(transcript);
  const title = quotedTitle(question) || (transcript.match(/(?:зроби|додай|створи|постав)\s+(.+?)[.?!]*$/i)?.[1] ?? '').trim();
  if (weekday == null || !title) return null;
  return {
    version: '1',
    kind: 'operations',
    operations: [{
      opId: 'op-recovered',
      action: 'create',
      target: { kind: 'new', localId: 'recovered' },
      changes: { title },
      constraints: [{ kind: 'weekday', weekday, which: 'next' }],
      dependsOn: [],
      source: { text: transcript },
    }],
  };
}

/** An explicit create with no day in the utterance stays unscheduled when the model asks for one. */
export function recoverUntimedCreate(transcript: string, envelope: SemanticEnvelopeV1): SemanticEnvelopeV1 | null {
  if (envelope.kind !== 'clarification') return null;
  const question = envelope.clarification?.question ?? '';
  if (!/на який день|which day/i.test(question)) return null;
  if (!EXPLICIT_NEW.test(transcript)) return null;
  if (weekdayIn(transcript) != null || /\d{1,2}[:.]\d{2}/.test(transcript) || /жовт|завтра|сьогодні|післязавтра|today|tomorrow/i.test(transcript)) return null;
  const title = quotedTitle(question);
  if (!title) return null;
  return {
    version: '1',
    kind: 'operations',
    operations: [{
      opId: 'op-recovered',
      action: 'create',
      target: { kind: 'new', localId: 'recovered' },
      changes: { title },
      constraints: [],
      dependsOn: [],
      source: { text: transcript },
    }],
  };
}

/** "Додай задачу нотатка." already named the title. Asking what to call it drops that title. */
export function recoverStatedTitle(transcript: string, envelope: SemanticEnvelopeV1): SemanticEnvelopeV1 | null {
  if (envelope.kind !== 'clarification') return null;
  const question = envelope.clarification?.question ?? '';
  if (!/як назвати|what should/i.test(question)) return null;
  const stated = transcript.match(/(?:додай|створи|запиши|add)\s+(?:задачу|завдання|task)\s+(.+?)[.?!]*$/i)?.[1]?.trim();
  if (!stated || placeholderTitle(stated)) return null;
  return {
    version: '1',
    kind: 'operations',
    operations: [{
      opId: 'op-recovered',
      action: 'create',
      target: { kind: 'new', localId: 'recovered' },
      changes: { title: stated },
      constraints: [],
      dependsOn: [],
      source: { text: transcript },
    }],
  };
}

/** "Прибери прогулянку" removes the one draft item that matches. Several or none stay unresolved. */
export function recoverDraftRemoval(transcript: string, items: Array<{ id: string; name: string }>): { op: 'remove_item'; itemId: string } | null {
  const match = transcript.trim().match(/^(?:прибери|прибрати|видали|видалити|remove|drop)\s+(.+?)[.!?]*$/i);
  if (!match) return null;
  const phrase = match[1].replace(/^(?:із|зі|з)\s+(?:плану|дня)\s+/i, '').replace(/[.!?]+$/g, '').trim();
  if (!phrase || /^(?:все|усе|план|його|її|it|this)$/i.test(phrase)) return null;
  const hits = items.filter((item) => relatedName(phrase, item.name) || relatedName(item.name, phrase));
  if (hits.length !== 1) return null;
  return { op: 'remove_item', itemId: hits[0].id };
}

/** "Завдання … без часу" is an unscheduled task. The quoted title comes from the model question, not a guess. */
export function recoverUnscheduled(transcript: string, envelope: SemanticEnvelopeV1): SemanticEnvelopeV1 | null {
  if (!/без часу|без дати|поки без/i.test(transcript) || envelope.kind !== 'clarification') return null;
  const question = envelope.clarification?.question ?? '';
  const quoted = question.match(/«([^»]+)»|"([^"]+)"/);
  const title = (quoted?.[1] || quoted?.[2] || '').trim();
  if (!title) return null;
  return {
    version: '1',
    kind: 'operations',
    operations: [{
      opId: 'op-recovered',
      action: 'create',
      target: { kind: 'new', localId: 'recovered' },
      changes: { title },
      constraints: [],
      dependsOn: [],
      source: { text: transcript },
    }],
  };
}
