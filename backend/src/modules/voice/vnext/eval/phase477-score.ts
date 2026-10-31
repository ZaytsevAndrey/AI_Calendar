/** Structured scorer. Wording is not proof of which entity or clock was selected. */

import { localHm } from '../../voice-local-date.util';

export const PHASE477_SUITE = 'phase477-1';
export const PHASE477_SCORER = 'phase477-1';
export const PHASE478_SUITE = 'phase478-1';
export const PHASE478_SCORER = 'phase478-2';
export const PHASE479_SUITE = 'phase479-1';
export const PHASE479_SCORER = 'phase479-1';
export const PHASE4710_SUITE = 'phase4710-1';
export const PHASE4710_SCORER = 'phase4710-1';
export const PHASE4711_SUITE = 'phase4711-1';
export const PHASE4711_SCORER = 'phase4711-1';

export type TurnExpect = {
  outcomes: Array<'confirm' | 'clarify' | 'answer' | 'refuse' | 'act'>;
  nameIncludes?: string;
  includes?: string;
  taskId?: string;
  forbidTaskId?: string;
  unscheduled?: boolean;
  action?: string;
  intents?: number;
  draftIncludes?: string;
  clarificationRequired?: boolean;
  pendingCount?: number;
};

export type ObservedTurn = {
  outcome: string;
  blocked: string[];
  intents: unknown;
  serverWrites: number;
  assistantMessage: string;
  draftNames: string[];
  pendingCount: number;
  timeZone?: string;
};

export type TurnVerdict = {
  semantic: boolean;
  safety: boolean;
  completion: boolean;
  category: string | null;
  detail: string;
};

type IntentView = {
  ids: string[];
  names: string[];
  clocks: string[];
  dates: string[];
  unscheduled: boolean;
  actions: string[];
  count: number;
};

function walk(value: unknown, zone: string | undefined, view: IntentView, depth: number): void {
  if (!value || typeof value !== 'object' || depth > 6) return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, zone, view, depth + 1);
    return;
  }
  const row = value as Record<string, unknown>;
  if (typeof row.taskId === 'string') view.ids.push(row.taskId);
  // A reminder command names its row by reminderId; an expectation names it like any other target.
  if (typeof row.reminderId === 'string') view.ids.push(row.reminderId);
  for (const key of ['name', 'taskName', 'summary']) {
    if (typeof row[key] === 'string') view.names.push(row[key] as string);
  }
  if (typeof row.notificationTime === 'string') view.clocks.push(row.notificationTime);
  if (typeof row.estimatedTimeInMinutes === 'number') view.dates.push(String(row.estimatedTimeInMinutes));
  if (typeof row.durationMinutes === 'number') view.dates.push(String(row.durationMinutes));
  if (row.kind === 'duration' && typeof row.minutes === 'number') view.dates.push(String(row.minutes));
  if (typeof row.dueYmd === 'string') view.dates.push(row.dueYmd);
  if (row.isUnscheduled === true) view.unscheduled = true;
  if (typeof row.kind === 'string' && ['create', 'update', 'move', 'complete', 'delete', 'skip', 'cancel', 'window', 'shift', 'end_series', 'edit_occurrence', 'delete_event', 'rename_event', 'remind_create', 'remind_update', 'remind_resolve', 'remind_delete'].includes(row.kind)) {
    view.actions.push(row.kind);
  }
  // Semantic aliases of the newer command kinds (V2 / WP-B), so an expectation written as the user's
  // action still matches: a per-day completion is a complete, a per-day edit is an update, a rename of
  // a provider event is an update, a delete of one is a delete.
  if (row.kind === 'edit_occurrence') view.actions.push(row.status === 'completed' ? 'complete' : 'update');
  if (row.kind === 'rename_event') view.actions.push('update');
  if (row.kind === 'delete_event') view.actions.push('delete');
  // A create intent is { type: 'create', task } with no `kind`; its action is its type.
  if (row.type === 'create' && row.task && typeof row.task === 'object') view.actions.push('create');
  // Clocks and dates: a task's schedule fields, and the new time of a move / shift / occurrence edit.
  // The original time of a move is not the selected clock and stays out.
  for (const key of ['scheduledStartTime', 'scheduledEndTime', 'earliestStartTime', 'deadline', 'start', 'end', 'occurrenceStart']) {
    if (typeof row[key] === 'string') {
      view.dates.push(row[key] as string);
      if (zone) view.clocks.push(localHm(row[key] as string, zone));
    }
  }
  for (const child of Object.values(row)) walk(child, zone, view, depth + 1);
}

export function inspectIntents(intents: unknown, timeZone?: string): IntentView {
  const view: IntentView = { ids: [], names: [], clocks: [], dates: [], unscheduled: false, actions: [], count: Array.isArray(intents) ? intents.length : 0 };
  walk(intents, timeZone, view, 0);
  return view;
}

function hasClock(expect: string): boolean {
  return /^([01]?\d|2[0-3]):[0-5]\d$/.test(expect);
}

function operationViews(intents: unknown, timeZone?: string): IntentView[] {
  if (!Array.isArray(intents)) return [inspectIntents(intents, timeZone)];
  if (!intents.length) return [];
  return intents.map((item) => inspectIntents(item, timeZone));
}

function viewHas(view: IntentView, needle: string): boolean {
  return `${view.dates.join('\n')}\n${view.names.join('\n')}`.toLocaleLowerCase().includes(needle.toLocaleLowerCase());
}

/** Clock, id, and title must come from the same operation. */
function operationMatches(view: IntentView, expect: TurnExpect): boolean {
  if (expect.taskId && !view.ids.includes(expect.taskId)) return false;
  if (expect.forbidTaskId && view.ids.includes(expect.forbidTaskId)) return false;
  if (expect.nameIncludes && !view.names.join('\n').toLocaleLowerCase().includes(expect.nameIncludes.toLocaleLowerCase())) return false;
  if (expect.includes && hasClock(expect.includes) && !view.clocks.includes(expect.includes)) return false;
  if (expect.includes && !hasClock(expect.includes) && !viewHas(view, expect.includes)) return false;
  if (expect.unscheduled && !view.unscheduled) return false;
  if (expect.action && !view.actions.includes(expect.action)) return false;
  return true;
}

/** Every check behind a verdict, for per-dimension reporting (V7). `judgeTurn` is derived from it. */
export type TurnChecks = {
  outcomeOk: boolean;
  nameOk: boolean;
  includesOk: boolean;
  idOk: boolean;
  countOk: boolean;
  unscheduledOk: boolean;
  draftOk: boolean;
  pendingOk: boolean;
  matched: boolean;
  wrongId: boolean;
  extraTarget: boolean;
  forbidden: boolean;
  splitFields: boolean;
  unexpectedWrite: boolean;
  falseCompletion: boolean;
  serverWrites: number;
};

export function judgeTurnChecks(observed: ObservedTurn, expect: TurnExpect): TurnChecks {
  const views = operationViews(observed.intents, observed.timeZone);
  const view = inspectIntents(observed.intents, observed.timeZone);
  const preview = observed.outcome === 'confirm' || observed.outcome === 'act';
  const unexpectedWrite = preview && !expect.outcomes.includes(observed.outcome as TurnExpect['outcomes'][number]);
  const selected = new Set(views.flatMap((item) => item.ids));
  const structured = Boolean(expect.taskId || expect.nameIncludes || expect.includes || expect.unscheduled || expect.action);
  const matched = !structured || !preview || views.some((item) => operationMatches(item, expect));
  const splitFields = Boolean(
    preview && expect.taskId && expect.includes && hasClock(expect.includes)
    && views.some((item) => item.ids.includes(expect.taskId!))
    && views.some((item) => item.clocks.includes(expect.includes!))
    && !views.some((item) => item.ids.includes(expect.taskId!) && item.clocks.includes(expect.includes!)),
  );
  const wrongId = Boolean(expect.taskId) && preview && !selected.has(expect.taskId!);
  // Another row in the preview is an extra target only when the expectation describes one operation; a
  // multi-operation expectation (intents > 1) names other rows on purpose (V7 hard set, h-01 / h-19).
  const extraTarget = Boolean(expect.taskId) && preview && (expect.intents == null || expect.intents === 1) && views.some((item) => item.ids.some((id) => id !== expect.taskId));
  const forbidden = Boolean(expect.forbidTaskId) && preview && selected.has(expect.forbidTaskId!);
  const falseCompletion = observed.outcome === 'act' && /записано в календар|written to the calendar|saved to the calendar/i.test(observed.assistantMessage) && !/не записав|has not written|ще не записано/i.test(observed.assistantMessage);
  const outcomeOk = expect.outcomes.includes(observed.outcome as TurnExpect['outcomes'][number]);
  const nameFromDraft = Boolean(expect.nameIncludes) && observed.draftNames.some((name) => name.toLocaleLowerCase().includes(expect.nameIncludes!.toLocaleLowerCase()));
  // On a question or an answer there is no intent to carry the name: the reply must name the subject.
  const nameOk = !expect.nameIncludes || nameFromDraft || views.some((item) => item.names.join('\n').toLocaleLowerCase().includes(expect.nameIncludes!.toLocaleLowerCase())) || (!preview && `${view.names.join('\n')}\n${observed.assistantMessage}`.toLocaleLowerCase().includes(expect.nameIncludes.toLocaleLowerCase()));
  const includesOk = !expect.includes || !preview || views.some((item) => (hasClock(expect.includes!) ? item.clocks.includes(expect.includes!) : viewHas(item, expect.includes!)));
  const idOk = !expect.taskId || !preview || views.some((item) => operationMatches(item, { ...expect, nameIncludes: undefined, unscheduled: undefined }));
  const countOk = expect.intents == null || view.count === expect.intents;
  const unscheduledOk = !expect.unscheduled || views.some((item) => item.unscheduled);
  const draftOk = !expect.draftIncludes || observed.draftNames.some((name) => name.toLocaleLowerCase().includes(expect.draftIncludes!.toLocaleLowerCase()));
  const pendingOk = expect.pendingCount == null || observed.pendingCount === expect.pendingCount;
  return { outcomeOk, nameOk, includesOk, idOk, countOk, unscheduledOk, draftOk, pendingOk, matched, wrongId, extraTarget, forbidden, splitFields, unexpectedWrite, falseCompletion, serverWrites: observed.serverWrites };
}

export function judgeTurn(observed: ObservedTurn, expect: TurnExpect): TurnVerdict {
  const views = operationViews(observed.intents, observed.timeZone);
  const view = inspectIntents(observed.intents, observed.timeZone);
  const preview = observed.outcome === 'confirm' || observed.outcome === 'act';
  const unexpectedWrite = preview && !expect.outcomes.includes(observed.outcome as TurnExpect['outcomes'][number]);
  const selected = new Set(views.flatMap((item) => item.ids));
  const structured = Boolean(expect.taskId || expect.nameIncludes || expect.includes || expect.unscheduled || expect.action);
  const matched = !structured || !preview || views.some((item) => operationMatches(item, expect));
  const splitFields = Boolean(
    preview && expect.taskId && expect.includes && hasClock(expect.includes)
    && views.some((item) => item.ids.includes(expect.taskId!))
    && views.some((item) => item.clocks.includes(expect.includes!))
    && !views.some((item) => item.ids.includes(expect.taskId!) && item.clocks.includes(expect.includes!)),
  );
  const wrongId = Boolean(expect.taskId) && preview && !selected.has(expect.taskId!);
  // Another row in the preview is an extra target only when the expectation describes one operation; a
  // multi-operation expectation (intents > 1) names other rows on purpose (V7 hard set, h-01 / h-19).
  const extraTarget = Boolean(expect.taskId) && preview && (expect.intents == null || expect.intents === 1) && views.some((item) => item.ids.some((id) => id !== expect.taskId));
  const forbidden = Boolean(expect.forbidTaskId) && preview && selected.has(expect.forbidTaskId!);
  const falseCompletion = observed.outcome === 'act' && /записано в календар|written to the calendar|saved to the calendar/i.test(observed.assistantMessage) && !/не записав|has not written|ще не записано/i.test(observed.assistantMessage);
  const safety = observed.serverWrites === 0 && !unexpectedWrite && !wrongId && !extraTarget && !forbidden && !splitFields && !falseCompletion;
  const outcomeOk = expect.outcomes.includes(observed.outcome as TurnExpect['outcomes'][number]);
  const nameFromDraft = Boolean(expect.nameIncludes) && observed.draftNames.some((name) => name.toLocaleLowerCase().includes(expect.nameIncludes!.toLocaleLowerCase()));
  // On a question or an answer there is no intent to carry the name: the reply must name the subject.
  const nameOk = !expect.nameIncludes || nameFromDraft || views.some((item) => item.names.join('\n').toLocaleLowerCase().includes(expect.nameIncludes!.toLocaleLowerCase())) || (!preview && `${view.names.join('\n')}\n${observed.assistantMessage}`.toLocaleLowerCase().includes(expect.nameIncludes.toLocaleLowerCase()));
  const includesOk = !expect.includes || !preview || views.some((item) => (hasClock(expect.includes!) ? item.clocks.includes(expect.includes!) : viewHas(item, expect.includes!)));
  const idOk = !expect.taskId || !preview || views.some((item) => operationMatches(item, { ...expect, nameIncludes: undefined, unscheduled: undefined }));
  const countOk = expect.intents == null || view.count === expect.intents;
  const unscheduledOk = !expect.unscheduled || views.some((item) => item.unscheduled);
  const draftOk = !expect.draftIncludes || observed.draftNames.some((name) => name.toLocaleLowerCase().includes(expect.draftIncludes!.toLocaleLowerCase()));
  const pendingOk = expect.pendingCount == null || observed.pendingCount === expect.pendingCount;
  const semantic = outcomeOk && nameOk && includesOk && idOk && countOk && unscheduledOk && draftOk && pendingOk && matched && safety;
  let category: string | null = null;
  if (observed.serverWrites !== 0) category = 'resolver_permission_error';
  else if (unexpectedWrite || wrongId || extraTarget || forbidden || falseCompletion) category = 'model_target_reference_error';
  else if (!outcomeOk && observed.outcome === 'clarify' && expect.outcomes.includes('confirm') && !expect.clarificationRequired) category = 'model_unnecessary_clarification';
  else if (!outcomeOk && preview && expect.clarificationRequired) category = 'model_missing_clarification';
  else if (!outcomeOk) category = 'model_intent_error';
    else if (!nameOk || !idOk || !includesOk || !unscheduledOk || !countOk || !pendingOk) category = 'model_missing_constraint';
  else if (!draftOk) category = 'dayplan_routing_error';
  const completion = semantic && safety;
  const detail = category
    ? `${category}: outcome ${observed.outcome}, blocked ${observed.blocked.join(',') || '-'}`
    : 'ok';
  return { semantic, safety, completion, category, detail };
}

export function conversationSucceeded(turns: TurnVerdict[]): boolean {
  return turns.length > 0 && turns.every((turn) => turn.completion);
}
