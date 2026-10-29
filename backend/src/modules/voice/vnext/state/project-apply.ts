/**
 * Project a normalized structured preview into the existing client Apply shapes.
 * Does not call a provider. The frontend executor ignores ApplyItem.dependsOn and
 * stops after the first failure, so a dependent command is not given a new provider id.
 * Same-draft work must already be folded. This function rejects anything that would
 * still need a draft id.
 * A constraint or change that the target command cannot carry is rejected, never dropped.
 */
import type { VoiceWriteIntent } from '../../voice-agent.types';
import { addDaysToYmd, localDateTimeIso, localHm, localYmd, nextWeekdayYmd, scheduleTodayYmd } from '../../voice-local-date.util';
import { intentKey } from '../session/session';
import { resolveZonedClock } from '../temporal/resolve-clock';
import type { ApplyItem } from '../apply/apply-preview';
import type { ClockRole, EntityOccurrence, PendingOperation, SeriesScope, TemporalProposal } from '../contracts/proposal';
import type { OperationChangesV1, TimeOfDayLabelV1 } from '../contracts/types';
import { preservedLabel, type VNextLanguage } from '../copy';
import type { StructuredState } from './structured-state';

export type ApplyProjection =
  | { ok: true; intents: VoiceWriteIntent[]; items: ApplyItem[]; preservedLabels: string[] }
  | { ok: false; code: string; detail: string };

const DRAFT_KEYS = ['taskId', 'localId', 'pendingId', 'id'] as const;

type ProjectError = { ok: false; code: string; detail: string };

/** Turn context for projection. references are authorized rows an ordering constraint may point at. */
type Clock = {
  timeZone: string;
  wakeHm: string;
  sleepHm: string;
  defaultDuration: number;
  defaultReminderTime: string;
  nowIso?: string;
  references: ReadonlyMap<string, { scheduledStart?: string | null; scheduledEnd?: string | null }>;
  /** Fixed spans of creates already projected in this preview, by pending id. */
  created: Map<string, { scheduledStart: string; scheduledEnd: string }>;
};

const PENDING_REF = 'pending:';

/** Pending ids this operation is ordered against. */
function orderingRefs(operation: PendingOperation): Set<string> {
  const refs = new Set<string>();
  for (const constraint of operation.constraints) {
    if (constraint.kind === 'ordering' && constraint.entityId.startsWith(PENDING_REF)) refs.add(constraint.entityId.slice(PENDING_REF.length));
  }
  return refs;
}

/** An ordering on another operation of the preview runs after it, so its span is known and a failure skips it. */
function withOrderingEdges(operations: PendingOperation[], dependencies: StructuredState['dependencies']): StructuredState['dependencies'] {
  const out: Record<string, readonly string[]> = { ...dependencies };
  for (const operation of operations) {
    const refs = [...orderingRefs(operation)].filter((ref) => ref !== operation.pendingId);
    const existing = out[operation.pendingId] ?? [];
    const added = refs.filter((ref) => !existing.includes(ref));
    if (added.length) out[operation.pendingId] = [...existing, ...added];
  }
  return out;
}

/** The fixed span of a one-off create, or null when the engine will place it. */
function createdSpan(task: Record<string, unknown>, defaultDuration: number): { scheduledStart: string; scheduledEnd: string } | null {
  if (task.isRecurring || typeof task.scheduledStartTime !== 'string') return null;
  const start = task.scheduledStartTime;
  if (typeof task.scheduledEndTime === 'string') return { scheduledStart: start, scheduledEnd: task.scheduledEndTime };
  const minutes = typeof task.estimatedTimeInMinutes === 'number' ? task.estimatedTimeInMinutes : defaultDuration;
  return { scheduledStart: start, scheduledEnd: new Date(Date.parse(start) + minutes * 60_000).toISOString() };
}

type Constraint = PendingOperation['constraints'][number];

export function projectApply(input: {
  state: StructuredState;
  timeZone: string;
  catalogEntityIds: readonly string[];
  defaultDurationMinutes?: number;
  defaultReminderTime?: string;
  nowIso?: string;
  wakeHm?: string;
  sleepHm?: string;
  language?: VNextLanguage;
  references?: ReadonlyArray<{ entityId: string; scheduledStart?: string | null; scheduledEnd?: string | null }>;
}): ApplyProjection {
  const draftIds = new Set<string>();
  for (const operation of input.state.operations) {
    draftIds.add(operation.pendingId);
    if (operation.target.kind === 'new') draftIds.add(operation.target.localId);
  }
  const dependencies = withOrderingEdges(input.state.operations, input.state.dependencies);
  const ordered = order(input.state.operations, dependencies);
  if (!ordered.ok) return { ok: false, code: ordered.code, detail: ordered.detail };
  const clock: Clock = {
    timeZone: input.timeZone,
    wakeHm: input.wakeHm ?? '07:00',
    sleepHm: input.sleepHm ?? '23:00',
    defaultDuration: input.defaultDurationMinutes ?? 30,
    defaultReminderTime: input.defaultReminderTime ?? '09:00',
    nowIso: input.nowIso,
    references: new Map((input.references ?? []).map((row) => [row.entityId, row])),
    created: new Map(),
  };
  const intents: VoiceWriteIntent[] = [];
  const preservedLabels: string[] = [];
  const keys = new Map<string, string>();
  const byId = new Map(ordered.operations.map((operation) => [operation.pendingId, operation]));
  for (const operation of ordered.operations) {
    if (operation.action !== 'create' && operation.action !== 'remind' && operation.target.kind === 'new') {
      return { ok: false, code: 'draft_command', detail: operation.action };
    }
    if (operation.target.kind === 'entity') {
      const eligible = eligibleTarget(operation);
      if (!eligible.ok) return eligible;
      if (!input.catalogEntityIds.includes(operation.target.entityId)) {
        return { ok: false, code: 'unauthorized_entity', detail: operation.target.entityId };
      }
    }
    const timedBy = orderingRefs(operation);
    for (const prerequisite of dependencies[operation.pendingId] ?? []) {
      const prior = byId.get(prerequisite);
      // A stored target or the new object's time is known now, and the preview order runs it after the create.
      // Only a command that needs the new object's id cannot be projected before Apply.
      if (prior?.action === 'create' && operation.action !== 'create' && operation.target.kind !== 'entity' && !timedBy.has(prerequisite)) {
        return { ok: false, code: 'unsupported_dependency_execution', detail: operation.pendingId };
      }
    }
    const resolved = resolveWeekdayConstraints(operation, {
      nowIso: input.nowIso,
      timeZone: input.timeZone,
      wakeHm: clock.wakeHm,
      sleepHm: clock.sleepHm,
    });
    if (!resolved.ok) return resolved;
    const relative = resolveRelative(resolved.operation, clock);
    if (!relative.ok) return relative;
    resolved.operation = relative.operation;
    // A reminder asks for its own missing fields first; projectRemind then rejects what it cannot carry.
    const labels = operation.action === 'remind' ? { ok: true as const, labels: [] } : keptLabels(resolved.operation);
    if (!labels.ok) return labels;
    const projected = operation.action === 'create'
      ? projectCreate(resolved.operation, clock, labels.labels, input.language ?? 'uk')
      : operation.action === 'remind'
        ? projectRemind(resolved.operation, clock)
        : projectCommand(resolved.operation, clock, input.language ?? 'uk');
    if (!projected.ok) return projected;
    if (exposesDraftId(projected.intent, draftIds)) return { ok: false, code: 'draft_identifier', detail: operation.pendingId };
    keys.set(operation.pendingId, intentKey(projected.intent));
    intents.push(projected.intent);
    preservedLabels.push(...labels.labels);
    const placed = projected.intent.type === 'create' ? createdSpan(projected.intent.task, clock.defaultDuration) : null;
    if (placed) clock.created.set(operation.pendingId, placed);
  }
  const items: ApplyItem[] = ordered.operations.map((operation, index) => {
    const prerequisites = (dependencies[operation.pendingId] ?? []).map((id) => keys.get(id)).filter((key): key is string => Boolean(key));
    return { intent: intents[index], ...(prerequisites.length ? { dependsOn: prerequisites } : {}) };
  });
  return { ok: true, intents, items, preservedLabels };
}

/**
 * Unresolved time blocks the preview, except a time-of-day label on an otherwise unplaced create.
 * That create is previewed without a clock and its summary says the label was not placed.
 */
function keptLabels(operation: PendingOperation): { ok: true; labels: TimeOfDayLabelV1[] } | ProjectError {
  const unresolved = operation.constraints.filter((constraint): constraint is Extract<Constraint, { kind: 'unresolved' }> =>
    constraint.kind === 'unresolved');
  if (!unresolved.length) return { ok: true, labels: [] };
  if (unresolved.some((constraint) => !constraint.label)) {
    return { ok: false, code: 'unrepresented_constraint', detail: operation.pendingId };
  }
  const placed = operation.constraints.some((constraint) => constraint.kind === 'date' || constraint.kind === 'clock' || constraint.kind === 'interval');
  // The detail carries the labels so the reply can name what was not placed.
  if (operation.action !== 'create' || placed) {
    return { ok: false, code: 'unmapped_time', detail: unresolved.map((constraint) => constraint.label).join(',') };
  }
  return { ok: true, labels: unresolved.map((constraint) => constraint.label!) };
}

/** Writes need an open, writable row. A recurring task needs a series scope the contract cannot carry. */
function eligibleTarget(operation: PendingOperation): { ok: true } | ProjectError {
  if (operation.target.kind !== 'entity') return { ok: true };
  const target = operation.target;
  // A provider event has no done state. Say so, whatever its access, instead of asking which task.
  if (target.entityType === 'external_event' && operation.action === 'complete') {
    return { ok: false, code: 'event_no_done', detail: target.entityId };
  }
  if (!target.writable) return { ok: false, code: 'unauthorized_entity', detail: target.entityId };
  if (target.status && target.status !== 'open') return { ok: false, code: 'ineligible', detail: target.entityId };
  if (target.recurring && target.entityType !== 'reminder' && !operation.seriesScope) {
    return { ok: false, code: 'missing_series_scope', detail: target.entityId };
  }
  // A series scope on a one-off row is a misreading, not something to ignore.
  if (!target.recurring && operation.seriesScope) return { ok: false, code: 'invalid_series_scope', detail: target.entityId };
  return { ok: true };
}

function find<K extends TemporalProposal['kind']>(operation: PendingOperation, kind: K): (Extract<TemporalProposal, { kind: K }> & { constraintId: string }) | undefined {
  return operation.constraints.find((constraint) => constraint.kind === kind) as (Extract<TemporalProposal, { kind: K }> & { constraintId: string }) | undefined;
}

function findClock(operation: PendingOperation, role: ClockRole): (Extract<TemporalProposal, { kind: 'clock' }> & { constraintId: string }) | undefined {
  return operation.constraints.find((constraint): constraint is Extract<TemporalProposal, { kind: 'clock' }> & { constraintId: string } =>
    constraint.kind === 'clock' && constraint.role === role);
}

/** Every constraint must be one the command can carry. */
function onlyKinds(operation: PendingOperation, allowed: ReadonlyArray<Constraint['kind']>): ProjectError | null {
  const extra = operation.constraints.find((constraint) => !allowed.includes(constraint.kind));
  return extra ? { ok: false, code: 'unrepresented_constraint', detail: `${operation.pendingId}:${extra.kind}` } : null;
}

/** Every change must be one the command can carry. `title` is display text on every command. */
function onlyChanges(operation: PendingOperation, allowed: ReadonlyArray<keyof OperationChangesV1>): ProjectError | null {
  const extra = (Object.keys(operation.changes) as Array<keyof OperationChangesV1>)
    .find((key) => operation.changes[key] !== undefined && key !== 'title' && !allowed.includes(key));
  return extra ? { ok: false, code: 'unrepresented_constraint', detail: `${operation.pendingId}:${extra}` } : null;
}

function zoned(ymd: string, hm: string, timeZone: string): { ok: true; iso: string } | ProjectError {
  const resolved = resolveZonedClock(ymd, hm, timeZone);
  if (resolved.status !== 'ok') return { ok: false, code: 'unrepresentable_schedule', detail: resolved.status };
  return { ok: true, iso: resolved.iso };
}

/** `{ op: 'create' }` with no name, day, clock, or repeat carries nothing a reminder command could store. */
function emptyReminder(changes: OperationChangesV1): boolean {
  const reminder = changes.reminder;
  if (!reminder) return false;
  return reminder.op === 'create'
    && !reminder.name
    && !reminder.dueYmd
    && reminder.notificationTime == null
    && reminder.recurrencePattern == null;
}

/**
 * before or after another authorized row: after it ends is an earliest start, before it starts is a deadline.
 * A row without a placed time gives no bound and is a question.
 */
function orderingBounds(operation: PendingOperation, clock: Clock): { ok: true; earliest?: string; deadline?: string } | ProjectError {
  const out: { earliest?: string; deadline?: string } = {};
  for (const constraint of operation.constraints) {
    if (constraint.kind !== 'ordering') continue;
    // A create of this preview gives its span only when it has a fixed time; otherwise there is no bound yet.
    const row = constraint.entityId.startsWith(PENDING_REF)
      ? clock.created.get(constraint.entityId.slice(PENDING_REF.length)) ?? {}
      : clock.references.get(constraint.entityId);
    if (!row) return { ok: false, code: 'unauthorized_entity', detail: constraint.entityId };
    const role = constraint.relation === 'after' ? 'earliest' : 'deadline';
    const at = constraint.relation === 'after' ? row.scheduledEnd : row.scheduledStart;
    if (!at) return { ok: false, code: 'missing_predecessor_time', detail: constraint.entityId };
    if (out[role]) return { ok: false, code: 'contradictory_constraints', detail: `${operation.pendingId}:ordering` };
    out[role] = at;
  }
  if (out.earliest && out.deadline && Date.parse(out.earliest) >= Date.parse(out.deadline)) {
    return { ok: false, code: 'contradictory_constraints', detail: `${operation.pendingId}:ordering` };
  }
  return { ok: true, ...out };
}

function hasBounds(operation: PendingOperation): boolean {
  return operation.constraints.some((constraint) =>
    constraint.kind === 'day_bound' || (constraint.kind === 'clock' && (constraint.role === 'earliest' || constraint.role === 'deadline')));
}

/**
 * earliest and deadline on the date: an explicit clock, or the user's wake or sleep edge.
 * A sleep time at or before wake belongs to the next calendar day.
 */
function boundsOn(operation: PendingOperation, ymd: string, clock: Clock): { ok: true; earliest?: string; deadline?: string } | ProjectError {
  const out: { earliest?: string; deadline?: string } = {};
  for (const role of ['earliest', 'deadline'] as const) {
    const clocks = operation.constraints.filter((constraint) => constraint.kind === 'clock' && constraint.role === role) as Array<Extract<Constraint, { kind: 'clock' }>>;
    const edges = operation.constraints.filter((constraint) => constraint.kind === 'day_bound' && constraint.role === role) as Array<Extract<Constraint, { kind: 'day_bound' }>>;
    if (clocks.length + edges.length > 1) return { ok: false, code: 'contradictory_constraints', detail: `${operation.pendingId}:${role}` };
    if (clocks.length) {
      const at = zoned(ymd, clocks[0].value, clock.timeZone);
      if (!at.ok) return at;
      out[role] = at.iso;
    } else if (edges.length) {
      const sleep = edges[0].edge === 'sleep';
      const day = sleep && clock.sleepHm <= clock.wakeHm ? addDaysToYmd(ymd, 1) : ymd;
      out[role] = localDateTimeIso(day, sleep ? clock.sleepHm : clock.wakeHm, clock.timeZone);
    }
  }
  if (out.earliest && out.deadline && Date.parse(out.earliest) >= Date.parse(out.deadline)) {
    return { ok: false, code: 'contradictory_constraints', detail: `${operation.pendingId}:bounds` };
  }
  return { ok: true, ...out };
}

/** Add bounds to a task or patch. A bound that would overwrite one the placement already set is a contradiction. */
function mergeBounds(target: Record<string, unknown>, bounds: { earliest?: string; deadline?: string }, pendingId: string): ProjectError | null {
  if (bounds.earliest) {
    if (target.earliestStartTime !== undefined) return { ok: false, code: 'contradictory_constraints', detail: `${pendingId}:earliest` };
    target.earliestStartTime = bounds.earliest;
  }
  if (bounds.deadline) {
    if (target.deadline !== undefined) return { ok: false, code: 'contradictory_constraints', detail: `${pendingId}:deadline` };
    target.deadline = bounds.deadline;
  }
  return null;
}

/** The user's whole waking day on that date, as a fixed block. */
function wholeDay(ymd: string, clock: Clock): { scheduledStartTime: string; scheduledEndTime: string; estimatedTimeInMinutes: number } {
  const endYmd = clock.sleepHm <= clock.wakeHm ? addDaysToYmd(ymd, 1) : ymd;
  const scheduledStartTime = localDateTimeIso(ymd, clock.wakeHm, clock.timeZone);
  const scheduledEndTime = localDateTimeIso(endYmd, clock.sleepHm, clock.timeZone);
  return {
    scheduledStartTime,
    scheduledEndTime,
    estimatedTimeInMinutes: Math.round((Date.parse(scheduledEndTime) - Date.parse(scheduledStartTime)) / 60_000),
  };
}

/** A move places the event: a bound or a whole day is not something the move command carries. */
function placementOnly(operation: PendingOperation): ProjectError | null {
  const extra = operation.constraints.find((constraint) => constraint.kind === 'clock' && constraint.role !== 'start' && constraint.role !== 'end');
  return extra ? { ok: false, code: 'unrepresented_constraint', detail: `${operation.pendingId}:clock_${(extra as { role: string }).role}` } : null;
}

/**
 * A delay from now becomes a start: minutes and hours give a date and a clock, days give a date.
 * It cannot be combined with another placement of the same operation.
 */
function resolveRelative(operation: PendingOperation, clock: Clock): { ok: true; operation: PendingOperation } | ProjectError {
  const relative = operation.constraints.filter((constraint): constraint is Extract<Constraint, { kind: 'relative' }> => constraint.kind === 'relative');
  if (!relative.length) return { ok: true, operation };
  const placed = operation.constraints.some((constraint) =>
    constraint.kind === 'date' || constraint.kind === 'all_day' || constraint.kind === 'interval' || (constraint.kind === 'clock' && constraint.role === 'start'));
  if (relative.length > 1 || placed) return { ok: false, code: 'contradictory_constraints', detail: `${operation.pendingId}:relative` };
  if (!clock.nowIso) return { ok: false, code: 'unrepresentable_schedule', detail: 'relative_needs_clock' };
  const delay = relative[0];
  const rest = operation.constraints.filter((constraint) => constraint !== delay);
  if (delay.unit === 'day') {
    const ymd = addDaysToYmd(localYmd(clock.nowIso, clock.timeZone), delay.amount);
    return { ok: true, operation: { ...operation, constraints: [...rest, { constraintId: delay.constraintId, kind: 'date', value: ymd }] } };
  }
  const at = new Date(Date.parse(clock.nowIso) + delay.amount * (delay.unit === 'hour' ? 3_600_000 : 60_000)).toISOString();
  return {
    ok: true,
    operation: {
      ...operation,
      constraints: [
        ...rest,
        { constraintId: delay.constraintId, kind: 'date', value: localYmd(at, clock.timeZone) },
        { constraintId: `${delay.constraintId}-start`, kind: 'clock', value: localHm(at, clock.timeZone), role: 'start' },
      ],
    },
  };
}

/** A named day without a clock spans the user's waking day. */
function dayWindow(ymd: string, clock: Clock): { earliestStartTime: string; deadline: string } {
  const endYmd = clock.sleepHm <= clock.wakeHm ? addDaysToYmd(ymd, 1) : ymd;
  return {
    earliestStartTime: localDateTimeIso(ymd, clock.wakeHm, clock.timeZone),
    deadline: localDateTimeIso(endYmd, clock.sleepHm, clock.timeZone),
  };
}

function projectCreate(
  operation: PendingOperation,
  clock: Clock,
  labels: readonly TimeOfDayLabelV1[],
  language: VNextLanguage,
): { ok: true; intent: VoiceWriteIntent } | ProjectError {
  if (operation.target.kind !== 'new') return { ok: false, code: 'invalid_target', detail: operation.action };
  // keptLabels already limited `unresolved` to labels on an unplaced create.
  const rejected = onlyKinds(operation, ['date', 'clock', 'interval', 'duration', 'unresolved', 'recurrence', 'all_day', 'day_bound', 'ordering'])
    ?? onlyChanges(operation, ['notes', 'priority', 'location', 'status', 'spanRole', ...(emptyReminder(operation.changes) ? ['reminder' as const] : [])]);
  if (rejected) return rejected;
  const title = operation.changes.title;
  if (!title) return { ok: false, code: 'missing_title', detail: operation.pendingId };
  const summary = labels.length ? preservedLabel(language, title, labels.join(', ')) : title;
  const start = findClock(operation, 'start');
  const end = findClock(operation, 'end');
  const date = find(operation, 'date');
  const duration = find(operation, 'duration');
  const interval = find(operation, 'interval');
  const task: Record<string, unknown> = {
    name: title,
    priority: operation.changes.priority ?? 'medium',
    timeZone: clock.timeZone,
    allowSplit: false,
    isUnscheduled: true,
    estimatedTimeInMinutes: duration ? duration.minutes : clock.defaultDuration,
  };
  if (operation.changes.notes !== undefined) task.description = operation.changes.notes;
  if (operation.changes.location !== undefined) task.location = operation.changes.location;
  if (operation.changes.status) task.status = operation.changes.status;
  const recurrence = find(operation, 'recurrence');
  if (recurrence) {
    task.isRecurring = true;
    task.recurrencePattern = recurrence.pattern;
    task.recurrenceWeekDays = recurrence.weekDays ?? null;
  }
  const allDay = find(operation, 'all_day');
  const bounded = hasBounds(operation);
  const order = orderingBounds(operation, clock);
  if (!order.ok) return order;
  if ((start || end || interval || allDay || bounded) && !date) return { ok: false, code: 'unrepresentable_schedule', detail: operation.pendingId };
  if (!date) {
    if (order.earliest || order.deadline) {
      mergeBounds(task, order, operation.pendingId);
      task.isUnscheduled = false;
      return { ok: true, intent: { type: 'create', summary, task } };
    }
    if (operation.scheduling === 'scheduled') return { ok: false, code: 'unrepresentable_schedule', detail: operation.pendingId };
    return { ok: true, intent: { type: 'create', summary, task } };
  }
  if (interval && (start || end)) return { ok: false, code: 'contradictory_constraints', detail: operation.pendingId };
  if (allDay) {
    if (start || end || interval || bounded) return { ok: false, code: 'contradictory_constraints', detail: operation.pendingId };
    const whole = wholeDay(date.value, clock);
    if (duration && duration.minutes !== whole.estimatedTimeInMinutes) return { ok: false, code: 'contradictory_constraints', detail: operation.pendingId };
    Object.assign(task, whole, { eventType: 'fixed', isUnscheduled: false });
    return { ok: true, intent: { type: 'create', summary, task } };
  }
  const bounds = boundsOn(operation, date.value, clock);
  if (!bounds.ok) return bounds;
  const window = operation.changes.spanRole === 'window';
  if (start) {
    const startIso = zoned(date.value, start.value, clock.timeZone);
    if (!startIso.ok) return startIso;
    const endIso = end ? zoned(date.value, end.value, clock.timeZone) : null;
    if (endIso && !endIso.ok) return endIso;
    if (window) {
      if (!endIso) return { ok: false, code: 'unrepresentable_schedule', detail: operation.pendingId };
      task.earliestStartTime = startIso.iso;
      task.deadline = endIso.iso;
    } else {
      task.scheduledStartTime = startIso.iso;
      if (endIso) {
        const minutes = Math.round((Date.parse(endIso.iso) - Date.parse(startIso.iso)) / 60_000);
        if (minutes <= 0) return { ok: false, code: 'contradictory_constraints', detail: operation.pendingId };
        if (duration && duration.minutes !== minutes) return { ok: false, code: 'contradictory_constraints', detail: operation.pendingId };
        task.scheduledEndTime = endIso.iso;
        task.estimatedTimeInMinutes = minutes;
      }
    }
  } else if (end) {
    const endIso = zoned(date.value, end.value, clock.timeZone);
    if (!endIso.ok) return endIso;
    task.deadline = endIso.iso;
  } else if (interval) {
    task.earliestStartTime = localDateTimeIso(date.value, interval.startHm, clock.timeZone);
    task.deadline = localDateTimeIso(date.value, interval.endHm, clock.timeZone);
  } else if (!bounded) {
    Object.assign(task, dayWindow(date.value, clock));
  }
  const merged = mergeBounds(task, bounds, operation.pendingId) ?? mergeBounds(task, order, operation.pendingId);
  if (merged) return merged;
  task.isUnscheduled = false;
  return { ok: true, intent: { type: 'create', summary, task } };
}

/** Reminder commands use the production remind_* shapes. A missing clock stays null for the user setting. */
function projectRemind(operation: PendingOperation, clock: Clock): { ok: true; intent: VoiceWriteIntent } | ProjectError {
  const reminder = operation.changes.reminder;
  const op = reminder?.op ?? (operation.target.kind === 'new' ? 'create' : null);
  if (!op) return { ok: false, code: 'unrepresented_constraint', detail: `${operation.pendingId}:reminder_op` };
  if (operation.target.kind === 'new' && op !== 'create') return { ok: false, code: 'draft_command', detail: op };
  if (operation.target.kind === 'entity' && (op === 'create' || operation.target.entityType !== 'reminder')) {
    return { ok: false, code: 'unsupported_combination', detail: `remind:${op}` };
  }
  const name = reminder?.name || operation.changes.title || '';
  const terminal = op === 'delete' || op === 'resolve';
  if (!name && !terminal) return { ok: false, code: 'missing_title', detail: operation.pendingId };
  const date = find(operation, 'date');
  if (reminder?.dueYmd && date && reminder.dueYmd !== date.value) {
    return { ok: false, code: 'contradictory_constraints', detail: operation.pendingId };
  }
  const due = reminder?.dueYmd || date?.value;
  if (!due && !terminal) return { ok: false, code: 'missing_day', detail: operation.pendingId };
  const rejected = onlyKinds(operation, ['date']) ?? onlyChanges(operation, ['notes', 'reminder']);
  if (rejected) return rejected;
  const explicitClock = reminder?.notificationTime ?? null;
  if (due && !terminal) {
    const resolved = resolveZonedClock(due, explicitClock || clock.defaultReminderTime, clock.timeZone);
    if (resolved.status === 'gap' || resolved.status === 'fold') return { ok: false, code: resolved.status, detail: operation.pendingId };
  }
  const kind = op === 'delete' ? 'remind_delete' : op === 'resolve' ? 'remind_resolve' : op === 'update' ? 'remind_update' : 'remind_create';
  const summary = name || operation.sourceText || kind;
  return {
    ok: true,
    intent: {
      type: 'command',
      summary,
      command: {
        kind,
        name: summary,
        summary,
        ...(operation.target.kind === 'entity' ? { reminderId: operation.target.entityId } : {}),
        ...(due ? { dueYmd: due } : {}),
        notificationTime: explicitClock,
        description: operation.changes.notes ?? null,
        recurrencePattern: reminder?.recurrencePattern ?? null,
        recurrenceWeekDays: null,
      },
    },
  };
}

const COMMAND_VERBS: Record<VNextLanguage, Record<string, string>> = {
  uk: {
    delete: 'Видалити',
    complete: 'Позначити виконаною',
    cancel: 'Скасувати',
    skip: 'Пропустити',
    move: 'Перенести',
    update: 'Змінити',
    end_series: 'Завершити серію',
    complete_occurrence: 'Позначити виконаним і прибрати з календаря',
  },
  en: {
    delete: 'Delete',
    complete: 'Mark done',
    cancel: 'Cancel',
    skip: 'Skip',
    move: 'Move',
    update: 'Change',
    end_series: 'End the series',
    complete_occurrence: 'Mark done and clear from the calendar',
  },
};

/**
 * Preview copy for a command on a stored row: the verb and the stored title, never the transcript.
 * A rename names both titles. `at` is the occurrence or the new start, when the command has one.
 */
export function commandSummary(
  language: VNextLanguage,
  kind: string,
  operation: PendingOperation,
  clock: Pick<Clock, 'timeZone'>,
  at?: { occurrence?: string; start?: string },
): string {
  const stored = operation.target.kind === 'entity' ? operation.target.name : undefined;
  const title = stored || operation.changes.title || operation.sourceText || kind;
  const verb = COMMAND_VERBS[language][kind] ?? COMMAND_VERBS[language].update;
  const renamed = kind === 'update' && stored && operation.changes.title && operation.changes.title !== stored;
  if (renamed) {
    return language === 'uk' ? `Перейменувати «${stored}» на «${operation.changes.title}»` : `Rename “${stored}” to “${operation.changes.title}”`;
  }
  const quoted = language === 'uk' ? `«${title}»` : `“${title}”`;
  const when = (iso: string, withClock: boolean) => {
    const ymd = localYmd(iso, clock.timeZone);
    return withClock ? `${ymd} ${localHm(iso, clock.timeZone)}` : ymd;
  };
  if (at?.start) return `${verb} ${quoted} ${language === 'uk' ? 'на' : 'to'} ${when(at.start, true)}`;
  if (at?.occurrence) {
    const day = when(at.occurrence, false);
    if (kind === 'end_series') return `${verb} ${quoted} ${language === 'uk' ? 'з' : 'from'} ${day}`;
    return `${verb} ${quoted} ${language === 'uk' ? 'за' : 'on'} ${day}`;
  }
  return `${verb} ${quoted}`;
}

function projectCommand(operation: PendingOperation, clock: Clock, language: VNextLanguage): { ok: true; intent: VoiceWriteIntent } | ProjectError {
  if (operation.target.kind !== 'entity') return { ok: false, code: 'draft_command', detail: operation.action };
  const taskId = operation.target.entityId;
  const summary = commandSummary(language, operation.action, operation, clock);
  const taskName = operation.target.name || operation.changes.title || operation.sourceText || operation.action;
  if (operation.target.recurring && operation.target.entityType === 'task') return projectSeriesCommand(operation, clock, language);
  if (operation.target.recurring && operation.target.entityType === 'external_event') {
    // A provider row is already one instance. Only that instance can be moved or deleted.
    if (operation.seriesScope !== 'occurrence') return { ok: false, code: 'unsupported_series_scope', detail: `${operation.seriesScope}:external_event` };
    const start = operation.target.scheduledStart;
    if (operation.occurrenceDate && (!start || localYmd(start, clock.timeZone) !== operation.occurrenceDate)) {
      return { ok: false, code: 'occurrence_not_found', detail: operation.occurrenceDate };
    }
  }
  if (operation.target.entityType === 'external_event') {
    // A provider event has no Luefy task behind it: a move, a rename, or a delete reaches its provider.
    // Cancel of an event is its delete; the preview says delete, so the user confirms that.
    if (operation.action === 'delete' || operation.action === 'cancel') {
      const implied = operation.action === 'cancel' && operation.changes.status === 'canceled';
      const rejected = onlyKinds(operation, []) ?? onlyChanges(operation, implied ? ['status'] : []);
      if (rejected) return rejected;
      const target = operation.target;
      if (!target.googleEventId || !target.provider) return { ok: false, code: 'unrepresentable_delete', detail: taskId };
      const text = commandSummary(language, 'delete', operation, clock);
      return {
        ok: true,
        intent: {
          type: 'command',
          summary: text,
          command: { kind: 'delete_event', taskId, taskName, summary: text, eventId: target.googleEventId, calendarId: target.calendarId, provider: target.provider },
        },
      };
    }
    if (operation.action === 'update') {
      const rejected = onlyKinds(operation, []) ?? onlyChanges(operation, []);
      if (rejected) return rejected;
      const target = operation.target;
      const title = operation.changes.title?.trim();
      if (!title) return { ok: false, code: 'unsupported_action', detail: 'update:external_event' };
      if (!target.googleEventId || !target.provider) return { ok: false, code: 'unrepresentable_update', detail: taskId };
      return {
        ok: true,
        intent: {
          type: 'command',
          summary,
          command: { kind: 'rename_event', taskId, taskName, summary, eventId: target.googleEventId, calendarId: target.calendarId, provider: target.provider, title },
        },
      };
    }
    if (operation.action !== 'move') return { ok: false, code: 'unsupported_action', detail: `${operation.action}:external_event` };
  }
  if (operation.action === 'update') {
    const patch = updatePatch(operation, clock);
    if (!patch.ok) return patch;
    return {
      ok: true,
      intent: {
        type: 'command',
        summary,
        command: { kind: 'update', taskId, taskName, summary, patch: patch.patch },
      },
    };
  }
  // The client skip command needs an occurrence start and event id. The contract cannot carry them yet.
  if (operation.action === 'skip') return { ok: false, code: 'unsupported_action', detail: operation.action };
  if (operation.action === 'complete' || operation.action === 'delete' || operation.action === 'cancel') {
    const status: string | undefined = operation.changes.status;
    const implied = (operation.action === 'complete' && status === 'completed') || (operation.action === 'cancel' && status === 'canceled');
    const rejected = onlyKinds(operation, []) ?? onlyChanges(operation, implied ? ['status'] : []);
    if (rejected) return rejected;
    return {
      ok: true,
      intent: {
        type: 'command',
        summary,
        command: { kind: operation.action, taskId, taskName, summary },
      },
    };
  }
  if (operation.action === 'move') {
    const rejected = onlyKinds(operation, ['date', 'clock', 'duration']) ?? placementOnly(operation) ?? onlyChanges(operation, []);
    if (rejected) return rejected;
    const target = operation.target;
    if (!target.googleEventId || !target.scheduledStart || !target.scheduledEnd) {
      return { ok: false, code: 'unrepresentable_move', detail: taskId };
    }
    const start = resolveStart(operation, clock.timeZone);
    if (!start.ok) return start;
    const end = resolveEnd(operation, start.iso, target.scheduledStart, target.scheduledEnd, clock.defaultDuration, clock.timeZone);
    if (!end.ok) return end;
    const moved = commandSummary(language, 'move', operation, clock, { start: start.iso });
    return {
      ok: true,
      intent: {
        type: 'command',
        summary: moved,
        command: {
          kind: 'move',
          taskId,
          taskName,
          summary: moved,
          googleEventId: target.googleEventId,
          calendarId: target.calendarId,
          ...(target.provider ? { provider: target.provider } : {}),
          recurringEventId: null,
          originalStart: target.scheduledStart,
          originalEnd: target.scheduledEnd,
          start: start.iso,
          end: end.iso,
        },
      },
    };
  }
  return { ok: false, code: 'unsupported_action', detail: operation.action };
}

/** The one placed occurrence on the date the model named. None or several is a question, never a guess. */
function pickOccurrence(operation: PendingOperation, timeZone: string): { ok: true; occurrence: EntityOccurrence } | ProjectError {
  if (operation.target.kind !== 'entity') return { ok: false, code: 'draft_command', detail: operation.action };
  if (!operation.occurrenceDate) return { ok: false, code: 'missing_occurrence', detail: operation.target.entityId };
  const matches = (operation.target.occurrences ?? []).filter((row) => localYmd(row.start, timeZone) === operation.occurrenceDate);
  if (!matches.length) return { ok: false, code: 'occurrence_not_found', detail: operation.occurrenceDate };
  if (matches.length > 1) return { ok: false, code: 'ambiguous_occurrence', detail: operation.occurrenceDate };
  return { ok: true, occurrence: matches[0] };
}

const CLIENT_SERIES_SCOPE: Record<SeriesScope, 'occurrence' | 'series' | 'all'> = { occurrence: 'occurrence', from_day: 'series', all: 'all' };

/**
 * A command on a recurring Luefy task, with the scope the model stated.
 * delete: occurrence → skip, from_day → end the series there, all → delete the task.
 * skip: occurrence only. move: any scope, anchored on a named occurrence.
 * complete: one occurrence (cleared like a skip) or the whole series. cancel, update: the whole series only.
 */
function projectSeriesCommand(operation: PendingOperation, clock: Clock, language: VNextLanguage): { ok: true; intent: VoiceWriteIntent } | ProjectError {
  if (operation.target.kind !== 'entity') return { ok: false, code: 'draft_command', detail: operation.action };
  const target = operation.target;
  const scope = operation.seriesScope;
  if (!scope) return { ok: false, code: 'missing_series_scope', detail: target.entityId };
  const taskId = target.entityId;
  const summary = commandSummary(language, operation.action, operation, clock);
  const taskName = target.name || operation.changes.title || operation.sourceText || operation.action;
  const occurrenceCommand = (kind: 'skip' | 'end_series', copy: string = kind, allowedChanges: Array<keyof OperationChangesV1> = []): { ok: true; intent: VoiceWriteIntent } | ProjectError => {
    const rejected = onlyKinds(operation, []) ?? onlyChanges(operation, allowedChanges);
    if (rejected) return rejected;
    const picked = pickOccurrence(operation, clock.timeZone);
    if (!picked.ok) return picked;
    const text = commandSummary(language, copy, operation, clock, { occurrence: picked.occurrence.start });
    return {
      ok: true,
      intent: {
        type: 'command',
        summary: text,
        command: {
          kind,
          taskId,
          taskName,
          summary: text,
          occurrenceStart: picked.occurrence.start,
          googleEventId: picked.occurrence.googleEventId,
          googleEventCalendarId: target.calendarId,
        },
      },
    };
  };
  if (operation.action === 'skip') {
    return scope === 'occurrence' ? occurrenceCommand('skip') : { ok: false, code: 'unsupported_series_scope', detail: `skip:${scope}` };
  }
  if (operation.action === 'delete') {
    if (scope === 'occurrence') return occurrenceCommand('skip');
    if (scope === 'from_day') return occurrenceCommand('end_series');
  }
  // Done on one day of a series clears that day, as Done on a repeating task does in the app.
  if (operation.action === 'complete' && scope === 'occurrence') {
    return occurrenceCommand('skip', 'complete_occurrence', operation.changes.status === 'completed' ? ['status'] : []);
  }
  if (operation.action === 'move') {
    const rejected = onlyKinds(operation, ['date', 'clock', 'duration']) ?? placementOnly(operation) ?? onlyChanges(operation, []);
    if (rejected) return rejected;
    const picked = pickOccurrence(operation, clock.timeZone);
    if (!picked.ok) return picked;
    if (!picked.occurrence.googleEventId || !target.seriesEventId) return { ok: false, code: 'unrepresentable_move', detail: taskId };
    const start = resolveStart(operation, clock.timeZone);
    if (!start.ok) return start;
    const end = resolveEnd(operation, start.iso, picked.occurrence.start, picked.occurrence.end, clock.defaultDuration, clock.timeZone);
    if (!end.ok) return end;
    const moved = commandSummary(language, 'move', operation, clock, { start: start.iso });
    return {
      ok: true,
      intent: {
        type: 'command',
        summary: moved,
        command: {
          kind: 'move',
          taskId,
          taskName,
          summary: moved,
          googleEventId: picked.occurrence.googleEventId,
          calendarId: target.calendarId,
          recurringEventId: target.seriesEventId,
          originalStart: picked.occurrence.start,
          originalEnd: picked.occurrence.end,
          start: start.iso,
          end: end.iso,
          seriesScope: CLIENT_SERIES_SCOPE[scope],
        },
      },
    };
  }
  if (scope !== 'all') return { ok: false, code: 'unsupported_series_scope', detail: `${operation.action}:${scope}` };
  if (operation.action === 'delete' || operation.action === 'complete' || operation.action === 'cancel') {
    const status: string | undefined = operation.changes.status;
    const implied = (operation.action === 'complete' && status === 'completed') || (operation.action === 'cancel' && status === 'canceled');
    const rejected = onlyKinds(operation, []) ?? onlyChanges(operation, implied ? ['status'] : []);
    if (rejected) return rejected;
    return { ok: true, intent: { type: 'command', summary, command: { kind: operation.action, taskId, taskName, summary } } };
  }
  if (operation.action === 'update') {
    // A series patch keeps its own schedule; a new time for every occurrence is a series move.
    const rejected = onlyKinds(operation, []);
    if (rejected) return rejected;
    const patch = updatePatch(operation, clock);
    if (!patch.ok) return patch;
    return { ok: true, intent: { type: 'command', summary, command: { kind: 'update', taskId, taskName, summary, patch: patch.patch } } };
  }
  return { ok: false, code: 'unsupported_action', detail: `${operation.action}:series` };
}

/** The production update command carries fields and a schedule. An update that changes nothing is not a preview. */
function updatePatch(operation: PendingOperation, clock: Clock): { ok: true; patch: Record<string, unknown> } | ProjectError {
  const rejected = onlyKinds(operation, ['date', 'clock', 'interval', 'duration', 'all_day', 'day_bound', 'ordering'])
    ?? onlyChanges(operation, ['notes', 'priority', 'location', 'status']);
  if (rejected) return rejected;
  const patch: Record<string, unknown> = {
    ...(operation.changes.title ? { name: operation.changes.title } : {}),
    ...(operation.changes.priority ? { priority: operation.changes.priority } : {}),
    ...(operation.changes.notes !== undefined ? { description: operation.changes.notes } : {}),
    ...(operation.changes.location !== undefined ? { location: operation.changes.location } : {}),
    ...(operation.changes.status ? { status: operation.changes.status } : {}),
  };
  const start = findClock(operation, 'start');
  const end = findClock(operation, 'end');
  const date = find(operation, 'date');
  const duration = find(operation, 'duration');
  const interval = find(operation, 'interval');
  const allDay = find(operation, 'all_day');
  const bounded = hasBounds(operation);
  if ((start || end || interval || allDay || bounded) && !date) return { ok: false, code: 'unrepresentable_schedule', detail: operation.pendingId };
  if (interval && (start || end)) return { ok: false, code: 'contradictory_constraints', detail: operation.pendingId };
  if (allDay && (start || end || interval || bounded || duration)) return { ok: false, code: 'contradictory_constraints', detail: operation.pendingId };
  if (date && allDay) {
    Object.assign(patch, wholeDay(date.value, clock));
  } else if (date) {
    if (start) {
      const startIso = zoned(date.value, start.value, clock.timeZone);
      if (!startIso.ok) return startIso;
      patch.scheduledStartTime = startIso.iso;
    }
    if (end) {
      const endIso = zoned(date.value, end.value, clock.timeZone);
      if (!endIso.ok) return endIso;
      patch.scheduledEndTime = endIso.iso;
    }
    if (interval) {
      patch.earliestStartTime = localDateTimeIso(date.value, interval.startHm, clock.timeZone);
      patch.deadline = localDateTimeIso(date.value, interval.endHm, clock.timeZone);
    } else if (!start && !end && !bounded) {
      Object.assign(patch, dayWindow(date.value, clock));
    }
    const bounds = boundsOn(operation, date.value, clock);
    if (!bounds.ok) return bounds;
    const merged = mergeBounds(patch, bounds, operation.pendingId);
    if (merged) return merged;
  }
  const order = orderingBounds(operation, clock);
  if (!order.ok) return order;
  const ordered = mergeBounds(patch, order, operation.pendingId);
  if (ordered) return ordered;
  if (duration) patch.estimatedTimeInMinutes = duration.minutes;
  if (!Object.keys(patch).length) return { ok: false, code: 'empty_patch', detail: operation.pendingId };
  return { ok: true, patch };
}

/**
 * Apply the documented weekday contract: the model chooses `which`; the backend only does calendar arithmetic.
 * `next` is the upcoming occurrence, or the following week when today is that weekday. `this` includes today.
 */
function resolveWeekdayConstraints(
  operation: PendingOperation,
  clock: { nowIso?: string; timeZone: string; wakeHm: string; sleepHm: string },
): { ok: true; operation: PendingOperation } | ProjectError {
  const weekdays = operation.constraints.filter((constraint): constraint is Extract<TemporalProposal, { kind: 'weekday' }> & { constraintId: string } =>
    constraint.kind === 'weekday');
  if (!weekdays.length) return { ok: true, operation };
  if (!clock.nowIso) return { ok: false, code: 'unrepresentable_schedule', detail: 'weekday_needs_clock' };
  if (weekdays.some((constraint) => constraint.which !== 'this' && constraint.which !== 'next')) {
    return { ok: false, code: 'ambiguous_weekday', detail: operation.pendingId };
  }
  const today = scheduleTodayYmd(clock.nowIso, clock.timeZone, clock.wakeHm, clock.sleepHm);
  const constraints = operation.constraints.map((constraint) => {
    if (constraint.kind !== 'weekday') return constraint;
    const upcoming = nextWeekdayYmd(today, constraint.weekday);
    const ymd = constraint.which === 'next' && upcoming === today ? addDaysToYmd(upcoming, 7) : upcoming;
    return { constraintId: constraint.constraintId, kind: 'date' as const, value: ymd };
  });
  return { ok: true, operation: { ...operation, constraints } };
}

function resolveStart(operation: PendingOperation, timeZone: string): { ok: true; iso: string } | ProjectError {
  const clock = findClock(operation, 'start');
  const date = find(operation, 'date');
  if (!clock || !date) return { ok: false, code: 'unrepresentable_schedule', detail: operation.pendingId };
  return zoned(date.value, clock.value, timeZone);
}

function resolveEnd(
  operation: PendingOperation,
  startIso: string,
  originalStart: string,
  originalEnd: string,
  defaultDuration: number,
  timeZone: string,
): { ok: true; iso: string } | ProjectError {
  const endClock = findClock(operation, 'end');
  const date = find(operation, 'date');
  if (endClock && date) return zoned(date.value, endClock.value, timeZone);
  const duration = find(operation, 'duration');
  const minutes = duration
    ? duration.minutes
    : Math.max(defaultDuration, Math.round((Date.parse(originalEnd) - Date.parse(originalStart)) / 60_000) || defaultDuration);
  return { ok: true, iso: new Date(Date.parse(startIso) + minutes * 60_000).toISOString() };
}

function exposesDraftId(intent: VoiceWriteIntent, draftIds: Set<string>): boolean {
  const taskId = intent.type === 'command' ? intent.command.taskId : undefined;
  if (typeof taskId === 'string' && draftIds.has(taskId)) return true;
  const encoded = JSON.stringify(intent);
  for (const id of draftIds) {
    if (encoded.includes(`"${id}"`)) return true;
  }
  for (const key of DRAFT_KEYS) {
    if (intent.type === 'create' && key in intent.task && draftIds.has(String(intent.task[key]))) return true;
  }
  return false;
}

function order(operations: PendingOperation[], dependencies: StructuredState['dependencies']): { ok: true; operations: PendingOperation[] } | { ok: false; code: string; detail: string } {
  const pending = [...operations];
  const ordered: PendingOperation[] = [];
  const ids = new Set(operations.map((operation) => operation.pendingId));
  while (pending.length) {
    const index = pending.findIndex((operation) => (dependencies[operation.pendingId] ?? []).every((id) => !ids.has(id) || ordered.some((item) => item.pendingId === id)));
    if (index < 0) return { ok: false, code: 'dependency_cycle', detail: 'projection' };
    const [operation] = pending.splice(index, 1);
    ordered.push(operation);
  }
  return { ok: true, operations: ordered };
}
