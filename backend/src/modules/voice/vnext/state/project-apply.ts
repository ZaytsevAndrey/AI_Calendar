/**
 * Project a normalized structured preview into the existing client Apply shapes.
 * Does not call a provider. The frontend executor ignores ApplyItem.dependsOn and
 * stops after the first failure, so a dependent command is not given a new provider id.
 * Same-draft work must already be folded. This function rejects anything that would
 * still need a draft id.
 */
import type { VoiceWriteIntent } from '../../voice-agent.types';
import { addDaysToYmd, localDateTimeIso, nextWeekdayYmd, scheduleTodayYmd } from '../../voice-local-date.util';
import { intentKey } from '../session/session';
import { resolveZonedClock } from '../temporal/resolve-clock';
import type { ApplyItem } from '../apply/apply-preview';
import type { PendingOperation, TemporalProposal } from '../contracts/proposal';
import type { StructuredState } from './structured-state';

export type ApplyProjection =
  | { ok: true; intents: VoiceWriteIntent[]; items: ApplyItem[] }
  | { ok: false; code: string; detail: string };

const DRAFT_KEYS = ['taskId', 'localId', 'pendingId', 'id'] as const;

type ProjectError = { ok: false; code: string; detail: string };

export function projectApply(input: {
  state: StructuredState;
  timeZone: string;
  catalogEntityIds: readonly string[];
  defaultDurationMinutes?: number;
  nowIso?: string;
  wakeHm?: string;
  sleepHm?: string;
}): ApplyProjection {
  const draftIds = new Set<string>();
  for (const operation of input.state.operations) {
    draftIds.add(operation.pendingId);
    if (operation.target.kind === 'new') draftIds.add(operation.target.localId);
  }
  const ordered = order(input.state.operations, input.state.dependencies);
  if (!ordered.ok) return { ok: false, code: ordered.code, detail: ordered.detail };
  const intents: VoiceWriteIntent[] = [];
  const keys = new Map<string, string>();
  const byId = new Map(ordered.operations.map((operation) => [operation.pendingId, operation]));
  for (const operation of ordered.operations) {
    if (operation.action !== 'create' && operation.target.kind === 'new') {
      return { ok: false, code: 'draft_command', detail: operation.action };
    }
    if (operation.target.kind === 'entity' && !operation.target.writable) {
      return { ok: false, code: 'unauthorized_entity', detail: operation.target.entityId };
    }
    if (operation.target.kind === 'entity' && !input.catalogEntityIds.includes(operation.target.entityId)) {
      return { ok: false, code: 'unauthorized_entity', detail: operation.target.entityId };
    }
    for (const prerequisite of input.state.dependencies[operation.pendingId] ?? []) {
      const prior = byId.get(prerequisite);
      if (prior?.action === 'create' && operation.action !== 'create') {
        return { ok: false, code: 'unsupported_dependency_execution', detail: operation.pendingId };
      }
    }
    const resolved = resolveWeekdayConstraints(operation, {
      nowIso: input.nowIso,
      timeZone: input.timeZone,
      wakeHm: input.wakeHm ?? '07:00',
      sleepHm: input.sleepHm ?? '23:00',
    });
    if (!resolved.ok) return resolved;
    const projected = operation.action === 'create'
      ? projectCreate(resolved.operation, input.timeZone, input.defaultDurationMinutes ?? 30)
      : projectCommand(resolved.operation, input.timeZone, input.defaultDurationMinutes ?? 30);
    if (!projected.ok) return projected;
    if (exposesDraftId(projected.intent, draftIds)) return { ok: false, code: 'draft_identifier', detail: operation.pendingId };
    keys.set(operation.pendingId, intentKey(projected.intent));
    intents.push(projected.intent);
  }
  const items: ApplyItem[] = ordered.operations.map((operation, index) => {
    const prerequisites = (input.state.dependencies[operation.pendingId] ?? []).map((id) => keys.get(id)).filter((key): key is string => Boolean(key));
    return { intent: intents[index], ...(prerequisites.length ? { dependsOn: prerequisites } : {}) };
  });
  return { ok: true, intents, items };
}

function projectCreate(operation: PendingOperation, timeZone: string, defaultDuration: number): { ok: true; intent: VoiceWriteIntent } | ProjectError {
  if (operation.target.kind !== 'new') return { ok: false, code: 'invalid_target', detail: operation.action };
  const title = operation.changes.title;
  if (!title) return { ok: false, code: 'missing_title', detail: operation.pendingId };
  const clock = operation.constraints.find((constraint): constraint is Extract<TemporalProposal, { kind: 'clock' }> & { constraintId: string } => constraint.kind === 'clock' && constraint.role === 'start');
  const date = operation.constraints.find((constraint) => constraint.kind === 'date');
  const duration = operation.constraints.find((constraint) => constraint.kind === 'duration');
  const task: Record<string, unknown> = {
    name: title,
    priority: operation.changes.priority ?? 'medium',
    timeZone,
    allowSplit: false,
    isUnscheduled: operation.scheduling !== 'scheduled',
    estimatedTimeInMinutes: duration && duration.kind === 'duration' ? duration.minutes : defaultDuration,
  };
  if (operation.changes.notes !== undefined) task.description = operation.changes.notes;
  if (operation.changes.location !== undefined) task.location = operation.changes.location;
  if (operation.changes.status) task.status = operation.changes.status;
  if (clock && date && date.kind === 'date') {
    const zoned = resolveZonedClock(date.value, clock.value, timeZone);
    if (zoned.status !== 'ok') return { ok: false, code: 'unrepresentable_schedule', detail: zoned.status };
    task.scheduledStartTime = zoned.iso;
    task.isUnscheduled = false;
  } else if (clock || (date && operation.scheduling === 'scheduled')) {
    return { ok: false, code: 'unrepresentable_schedule', detail: operation.pendingId };
  } else if (date && date.kind === 'date' && operation.constraints.some((constraint) => constraint.kind === 'interval')) {
    const interval = operation.constraints.find((constraint) => constraint.kind === 'interval');
    if (!interval || interval.kind !== 'interval') return { ok: false, code: 'unrepresentable_schedule', detail: operation.pendingId };
    task.earliestStartTime = localDateTimeIso(date.value, interval.startHm, timeZone);
    task.deadline = localDateTimeIso(date.value, interval.endHm, timeZone);
    task.isUnscheduled = false;
  }
  return { ok: true, intent: { type: 'create', summary: title, task } };
}

function projectCommand(
  operation: PendingOperation,
  timeZone: string,
  defaultDuration: number,
): { ok: true; intent: VoiceWriteIntent } | ProjectError {
  if (operation.target.kind !== 'entity') return { ok: false, code: 'draft_command', detail: operation.action };
  const taskId = operation.target.entityId;
  const summary = operation.changes.title || operation.sourceText || operation.action;
  if (operation.action === 'update') {
    return {
      ok: true,
      intent: {
        type: 'command',
        summary,
        command: {
          kind: 'update',
          taskId,
          taskName: summary,
          summary,
          patch: commandPatch(operation),
        },
      },
    };
  }
  if (operation.action === 'complete' || operation.action === 'delete' || operation.action === 'cancel') {
    return {
      ok: true,
      intent: {
        type: 'command',
        summary,
        command: { kind: operation.action, taskId, taskName: summary, summary },
      },
    };
  }
  if (operation.action === 'move') {
    const target = operation.target;
    if (!target.googleEventId || !target.scheduledStart || !target.scheduledEnd) {
      return { ok: false, code: 'unrepresentable_move', detail: taskId };
    }
    const start = resolveStart(operation, timeZone);
    if (!start.ok) return start;
    const end = resolveEnd(operation, start.iso, target.scheduledStart, target.scheduledEnd, defaultDuration, timeZone);
    return {
      ok: true,
      intent: {
        type: 'command',
        summary,
        command: {
          kind: 'move',
          taskId,
          taskName: summary,
          summary,
          googleEventId: target.googleEventId,
          calendarId: target.calendarId,
          recurringEventId: null,
          originalStart: target.scheduledStart,
          originalEnd: target.scheduledEnd,
          start: start.iso,
          end,
        },
      },
    };
  }
  return { ok: false, code: 'unsupported_action', detail: operation.action };
}

function resolveWeekdayConstraints(
  operation: PendingOperation,
  clock: { nowIso?: string; timeZone: string; wakeHm: string; sleepHm: string },
): { ok: true; operation: PendingOperation } | ProjectError {
  const weekdays = operation.constraints.filter((constraint): constraint is Extract<TemporalProposal, { kind: 'weekday' }> & { constraintId: string } =>
    constraint.kind === 'weekday');
  if (!weekdays.length) return { ok: true, operation };
  if (!clock.nowIso) return { ok: false, code: 'unrepresentable_schedule', detail: 'weekday_needs_clock' };
  const today = scheduleTodayYmd(clock.nowIso, clock.timeZone, clock.wakeHm, clock.sleepHm);
  const constraints = operation.constraints.map((constraint) => {
    if (constraint.kind !== 'weekday') return constraint;
    let ymd = nextWeekdayYmd(today, constraint.weekday);
    if (constraint.which === 'this' && ymd !== today && nextWeekdayYmd(today, constraint.weekday) !== today) {
      // keep next occurrence; "this" on a later day still means that upcoming weekday
    }
    if (constraint.which === 'this' && ymd === today) ymd = today;
    if (constraint.which === 'next' && ymd === today) ymd = addDaysToYmd(ymd, 7);
    return { constraintId: constraint.constraintId, kind: 'date' as const, value: ymd };
  });
  return { ok: true, operation: { ...operation, constraints } };
}

function resolveStart(operation: PendingOperation, timeZone: string): { ok: true; iso: string } | ProjectError {
  const clock = operation.constraints.find((constraint): constraint is Extract<TemporalProposal, { kind: 'clock' }> & { constraintId: string } =>
    constraint.kind === 'clock' && constraint.role === 'start');
  const date = operation.constraints.find((constraint) => constraint.kind === 'date');
  if (!clock || !date || date.kind !== 'date') return { ok: false, code: 'unrepresentable_schedule', detail: operation.pendingId };
  const zoned = resolveZonedClock(date.value, clock.value, timeZone);
  if (zoned.status !== 'ok') return { ok: false, code: 'unrepresentable_schedule', detail: zoned.status };
  return { ok: true, iso: zoned.iso };
}

function resolveEnd(
  operation: PendingOperation,
  startIso: string,
  originalStart: string,
  originalEnd: string,
  defaultDuration: number,
  timeZone: string,
): string {
  const endClock = operation.constraints.find((constraint): constraint is Extract<TemporalProposal, { kind: 'clock' }> & { constraintId: string } =>
    constraint.kind === 'clock' && constraint.role === 'end');
  const date = operation.constraints.find((constraint) => constraint.kind === 'date');
  if (endClock && date && date.kind === 'date') {
    const zoned = resolveZonedClock(date.value, endClock.value, timeZone);
    if (zoned.status === 'ok') return zoned.iso;
  }
  const duration = operation.constraints.find((constraint) => constraint.kind === 'duration');
  const minutes = duration && duration.kind === 'duration'
    ? duration.minutes
    : Math.max(defaultDuration, Math.round((Date.parse(originalEnd) - Date.parse(originalStart)) / 60_000) || defaultDuration);
  return new Date(Date.parse(startIso) + minutes * 60_000).toISOString();
}

function commandPatch(operation: PendingOperation): Record<string, unknown> {
  return {
    ...(operation.changes.title ? { name: operation.changes.title } : {}),
    ...(operation.changes.priority ? { priority: operation.changes.priority } : {}),
    ...(operation.changes.notes !== undefined ? { description: operation.changes.notes } : {}),
    ...(operation.changes.location !== undefined ? { location: operation.changes.location } : {}),
    ...(operation.changes.status ? { status: operation.changes.status } : {}),
  };
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
