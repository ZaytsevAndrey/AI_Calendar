import { addDaysToYmd, localDateTimeIso } from '../../voice-local-date.util';
import type { VoiceWriteIntent } from '../../voice-agent.types';
import type { SemanticOperationV1 } from '../contracts/types';
import type { VNextLanguage } from '../copy';
import { preservedLabel } from '../copy';
import { resolveTarget, type EntityRecord, type TargetResolution } from '../reference/reference-resolver';
import { resolveZonedClock } from '../temporal/resolve-clock';
import type { ResolvedWhen } from '../temporal/temporal-resolver';

const MAX_WRITES = 6;

export type AdaptedOperation = {
  opId: string;
  intent: VoiceWriteIntent | null;
  blocked?: string;
  preservedLabel?: string;
};

export type AdaptInput = {
  operation: SemanticOperationV1;
  resolution: TargetResolution;
  when: ResolvedWhen[];
  entities: EntityRecord[];
  language: VNextLanguage;
  timeZone: string;
  wakeHm: string;
  sleepHm: string;
  defaultDurationMinutes: number;
  /** Settings `defaultReminderTime`. 09:00 is the application fallback. */
  defaultReminderTime: string;
  userId: string;
};

function entityName(entities: EntityRecord[], id: string): string {
  return entities.find((entity) => entity.id === id)?.name ?? '';
}

function ymdOf(when: ResolvedWhen[]): string | undefined {
  const found = when.find((row) => row.status === 'ymd');
  return found && found.status === 'ymd' ? found.ymd : undefined;
}

function instant(when: ResolvedWhen[], role: string): string | undefined {
  const found = when.find((row) => row.status === 'instant' && row.role === role);
  return found && found.status === 'instant' ? found.iso : undefined;
}

function anyInstant(when: ResolvedWhen[]): Extract<ResolvedWhen, { status: 'instant' }> | undefined {
  const found = when.find((row) => row.status === 'instant');
  return found && found.status === 'instant' ? found : undefined;
}

function duration(when: ResolvedWhen[], fallback: number): number {
  const found = when.find((row) => row.status === 'duration');
  return found && found.status === 'duration' ? found.minutes : fallback;
}

function bareOperation(operation: SemanticOperationV1): boolean {
  const changes = operation.changes;
  const extra = (['title', 'notes', 'priority', 'status', 'spanRole', 'location', 'reminder'] as const).some((key) => changes[key] !== undefined);
  return !extra && operation.constraints.length === 0;
}

function hasRecurrence(operation: SemanticOperationV1): boolean {
  return operation.constraints.some((constraint) => constraint.kind === 'recurrence');
}

function recurrencePattern(operation: SemanticOperationV1): 'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | null {
  const named = operation.changes.reminder?.recurrencePattern;
  if (named) return named;
  const constraint = operation.constraints.find((row) => row.kind === 'recurrence');
  if (!constraint || constraint.kind !== 'recurrence') return null;
  const text = constraint.expression.trim().toLowerCase();
  if (text === 'daily' || text === 'every day' || text === 'щодня' || text === 'кожен день') return 'DAILY';
  if (text === 'weekly' || text === 'every week' || text === 'щотижня') return 'WEEKLY';
  if (text === 'biweekly' || text === 'every other week') return 'BIWEEKLY';
  if (text === 'monthly' || text === 'every month' || text === 'щомісяця') return 'MONTHLY';
  return null;
}

function minutesBetween(startHm: string, endHm: string): number {
  const [sh, sm] = startHm.split(':').map(Number);
  const [eh, em] = endHm.split(':').map(Number);
  const start = sh * 60 + sm;
  let end = eh * 60 + em;
  if (end <= start) end += 24 * 60;
  return end - start;
}

function clientSeriesScope(scope: SemanticOperationV1['seriesScope']): 'occurrence' | 'series' | 'all' | undefined {
  if (scope === 'from_day') return 'series';
  if (scope === 'occurrence' || scope === 'all') return scope;
  return undefined;
}

function commandIntent(summary: string, command: Record<string, unknown>): VoiceWriteIntent {
  return { type: 'command', summary, command };
}

/** Map one resolved operation onto an existing client intent. Never invents an id or a clock. */
export function adaptOperation(input: AdaptInput): AdaptedOperation {
  const { resolution, when, language } = input;
  const operation = input.operation.action === 'create' && input.operation.changes.reminder
    ? { ...input.operation, action: 'remind' as const }
    : input.operation;
  const blockedWhen = when.find((row) => row.status === 'gap' || row.status === 'fold' || row.status === 'needs_day' || row.status === 'invalid_date' || row.status === 'conflicting_day' || row.status === 'past');
  if (blockedWhen) return { opId: operation.opId, intent: null, blocked: blockedWhen.status };
  if (resolution.status === 'rejected') return { opId: operation.opId, intent: null, blocked: resolution.reason };
  if (resolution.status === 'ambiguous' || resolution.status === 'unresolved') {
    return { opId: operation.opId, intent: null, blocked: resolution.status };
  }
  const title = operation.changes.title || (resolution.status === 'resolved' ? entityName(input.entities, resolution.entityId) : '');
  const preserved = when.find((row) => row.status === 'preserved' && row.label !== 'recurrence' && row.label !== 'ordering');
  if (operation.action === 'create' && resolution.status === 'new') {
    if (!title) return { opId: operation.opId, intent: null, blocked: 'missing_title' };
    const pattern = recurrencePattern(operation);
    if (hasRecurrence(operation) && !pattern) return { opId: operation.opId, intent: null, blocked: 'unrepresented_constraint' };
    const ordering = operation.constraints.find((constraint) => constraint.kind === 'ordering');
    let predecessorId: string | undefined;
    let predecessorEarliest: string | undefined;
    let predecessorDeadline: string | undefined;
    if (ordering && ordering.kind === 'ordering') {
      const predecessor = resolveTarget({
        target: ordering.target,
        userId: input.userId,
        entities: input.entities,
        referents: {},
        write: false,
      });
      if (predecessor.status === 'ambiguous' || predecessor.status === 'unresolved' || predecessor.status === 'rejected') {
        return { opId: operation.opId, intent: null, blocked: predecessor.status === 'rejected' ? predecessor.reason : predecessor.status };
      }
      if (predecessor.status !== 'resolved') return { opId: operation.opId, intent: null, blocked: 'missing_predecessor' };
      const entity = input.entities.find((row) => row.id === predecessor.entityId);
      predecessorId = predecessor.entityId;
      if (ordering.relation === 'after') {
        if (!entity?.scheduledEnd) return { opId: operation.opId, intent: null, blocked: 'missing_predecessor' };
        predecessorEarliest = entity.scheduledEnd;
      } else {
        if (!entity?.scheduledStart) return { opId: operation.opId, intent: null, blocked: 'missing_predecessor' };
        predecessorDeadline = entity.scheduledStart;
      }
    }
    const allDay = when.some((row) => row.status === 'all_day');
    const minutes = duration(when, input.defaultDurationMinutes);
    const start = instant(when, 'start') ?? (operation.changes.spanRole === 'window' ? undefined : anyInstant(when)?.iso);
    const end = instant(when, 'end');
    const earliestInstant = instant(when, 'earliest');
    const deadlineInstant = instant(when, 'deadline');
    const window = when.find((row) => row.status === 'window');
    const deadline = when.find((row) => row.status === 'deadline_hm');
    const ymd = ymdOf(when) ?? (window && window.status === 'window' ? window.ymd : undefined);
    const task: Record<string, unknown> = {
      name: title,
      eventType: operation.changes.spanRole === 'event' || allDay ? 'fixed' : 'admin',
      estimatedTimeInMinutes: allDay ? minutesBetween(input.wakeHm, input.sleepHm) : minutes,
      isRecurring: Boolean(pattern),
      ...(pattern ? { recurrencePattern: pattern } : {}),
      ...(predecessorId ? { dependsOn: [predecessorId] } : {}),
      isUnscheduled: !allDay && !start && !window && !deadline && !predecessorEarliest && !predecessorDeadline,
      allowSplit: false,
      priority: operation.changes.priority ?? 'medium',
      timeZone: input.timeZone,
    };
    if (operation.changes.notes !== undefined) task.description = operation.changes.notes;
    if (operation.changes.location !== undefined) task.location = operation.changes.location;
    if (operation.changes.status) task.status = operation.changes.status;
    if (allDay) {
      if (!ymd) return { opId: operation.opId, intent: null, blocked: 'needs_day' };
      const endYmd = input.sleepHm <= input.wakeHm ? addDaysToYmd(ymd, 1) : ymd;
      task.scheduledStartTime = localDateTimeIso(ymd, input.wakeHm, input.timeZone);
      task.scheduledEndTime = localDateTimeIso(endYmd, input.sleepHm, input.timeZone);
      task.isUnscheduled = false;
      task.eventType = 'fixed';
    } else if (operation.changes.spanRole === 'event' && start && end) {
      task.scheduledStartTime = start;
      task.scheduledEndTime = end;
      task.isUnscheduled = false;
      task.eventType = 'fixed';
    } else if (operation.changes.spanRole === 'window' && earliestInstant && deadlineInstant) {
      task.earliestStartTime = earliestInstant;
      task.deadline = deadlineInstant;
      task.isUnscheduled = false;
    } else if (start) {
      task.scheduledStartTime = start;
      task.isUnscheduled = false;
    } else if (window && window.status === 'window' && ymd) {
      task.earliestStartTime = localDateTimeIso(ymd, window.earliestHm, input.timeZone);
      task.deadline = localDateTimeIso(ymd, window.deadlineHm, input.timeZone);
      task.isUnscheduled = false;
    } else if (deadline && deadline.status === 'deadline_hm' && (deadline.ymd || ymd)) {
      task.deadline = localDateTimeIso(deadline.ymd || ymd || '', deadline.hm, input.timeZone);
      task.isUnscheduled = false;
    } else if (ymd && !(preserved && preserved.status === 'preserved')) {
      task.earliestStartTime = localDateTimeIso(ymd, input.wakeHm, input.timeZone);
      task.deadline = localDateTimeIso(ymd, input.sleepHm, input.timeZone);
      task.isUnscheduled = false;
    }
    if (predecessorEarliest) {
      task.earliestStartTime = predecessorEarliest;
      task.isUnscheduled = false;
    }
    if (predecessorDeadline) {
      task.deadline = predecessorDeadline;
      task.isUnscheduled = false;
    }
    const summary = preserved && preserved.status === 'preserved' ? preservedLabel(language, title, preserved.label) : title;
    return {
      opId: operation.opId,
      intent: { type: 'create', summary, task },
      ...(preserved && preserved.status === 'preserved' ? { preservedLabel: preserved.label } : {}),
    };
  }
  if (operation.action === 'remind') {
    if (operation.constraints.some((constraint) => constraint.kind === 'ordering')) {
      return { opId: operation.opId, intent: null, blocked: 'unrepresented_constraint' };
    }
    if (hasRecurrence(operation) && !recurrencePattern(operation)) {
      return { opId: operation.opId, intent: null, blocked: 'unrepresented_constraint' };
    }
    const reminder = operation.changes.reminder;
    const pattern = reminder?.recurrencePattern ?? recurrencePattern(operation);
    const name = reminder?.name || title;
    if (!name) return { opId: operation.opId, intent: null, blocked: 'missing_title' };
    const due = reminder?.dueYmd || ymdOf(when);
    if (!due && reminder?.op !== 'delete' && reminder?.op !== 'resolve') {
      return { opId: operation.opId, intent: null, blocked: 'missing_day' };
    }
    const explicitClock = reminder?.notificationTime ?? null;
    const effectiveClock = explicitClock || input.defaultReminderTime || '09:00';
    if (due && effectiveClock && reminder?.op !== 'delete' && reminder?.op !== 'resolve') {
      const zoned = resolveZonedClock(due, effectiveClock, input.timeZone);
      if (zoned.status === 'gap' || zoned.status === 'fold') return { opId: operation.opId, intent: null, blocked: zoned.status };
    }
    if ((reminder?.op === 'delete' || reminder?.op === 'resolve' || reminder?.op === 'update') && resolution.status !== 'resolved') {
      return { opId: operation.opId, intent: null, blocked: resolution.status === 'operation' ? 'unsupported_binding' : 'unresolved' };
    }
    const kind =
      reminder?.op === 'delete' ? 'remind_delete' : reminder?.op === 'resolve' ? 'remind_resolve' : reminder?.op === 'update' ? 'remind_update' : 'remind_create';
    const command: Record<string, unknown> = {
      kind,
      name,
      summary: name,
      ...(resolution.status === 'resolved' ? { reminderId: resolution.entityId } : {}),
      ...(due ? { dueYmd: due } : {}),
      notificationTime: explicitClock,
      description: operation.changes.notes ?? null,
      recurrencePattern: pattern ?? null,
      recurrenceWeekDays: null,
    };
    return { opId: operation.opId, intent: commandIntent(name, command) };
  }
  if (resolution.status === 'operation') return { opId: operation.opId, intent: null, blocked: 'unsupported_binding' };
  if (resolution.status !== 'resolved') return { opId: operation.opId, intent: null, blocked: 'unresolved' };
  const name = entityName(input.entities, resolution.entityId);
  const recurring = input.entities.find((entity) => entity.id === resolution.entityId)?.recurring === true;
  if (recurring && operation.scope !== 'all' && !operation.seriesScope && (operation.action === 'delete' || operation.action === 'update' || operation.action === 'move' || operation.action === 'complete' || operation.action === 'skip')) {
    return { opId: operation.opId, intent: null, blocked: 'missing_series_scope' };
  }
  const seriesScope = clientSeriesScope(operation.seriesScope);
  if (operation.action === 'delete' || operation.action === 'complete' || operation.action === 'skip' || operation.action === 'cancel') {
    if (!bareOperation(operation)) return { opId: operation.opId, intent: null, blocked: 'unrepresented_constraint' };
  }
  if (operation.action === 'delete') {
    return {
      opId: operation.opId,
      intent: commandIntent(name, { kind: 'delete', taskId: resolution.entityId, taskName: name, summary: name, ...(seriesScope ? { seriesScope } : {}) }),
    };
  }
  if (operation.action === 'complete') {
    return {
      opId: operation.opId,
      intent: commandIntent(name, { kind: 'complete', taskId: resolution.entityId, taskName: name, summary: name }),
    };
  }
  if (operation.action === 'skip') {
    return {
      opId: operation.opId,
      intent: commandIntent(name, { kind: 'skip', taskId: resolution.entityId, taskName: name, summary: name }),
    };
  }
  if (operation.action === 'cancel') {
    return {
      opId: operation.opId,
      intent: commandIntent(name, { kind: 'cancel', taskId: resolution.entityId, taskName: name, summary: name }),
    };
  }
  const qualitative = when.find((row) => row.status === 'preserved' && row.label !== 'recurrence' && row.label !== 'ordering');
  const label = qualitative && qualitative.status === 'preserved' ? qualitative.label : undefined;
  const start = instant(when, 'start') ?? instant(when, 'preferred');
  const hasDuration = when.some((row) => row.status === 'duration');
  if (operation.action === 'move') {
    if (label) return { opId: operation.opId, intent: null, blocked: start ? 'unrepresented_constraint' : 'unmapped_time', preservedLabel: label };
    if (hasRecurrence(operation) || operation.constraints.some((constraint) => constraint.kind === 'ordering') || operation.changes.location !== undefined || operation.changes.status || operation.changes.reminder || operation.changes.notes !== undefined || operation.changes.priority || operation.changes.spanRole) {
      return { opId: operation.opId, intent: null, blocked: 'unrepresented_constraint', ...(label ? { preservedLabel: label } : {}) };
    }
    const extra = when.some((row) => row.status === 'duration' || row.status === 'window' || row.status === 'deadline_hm' || (row.status === 'instant' && row.role !== 'start' && row.role !== 'preferred'));
    if (extra) return { opId: operation.opId, intent: null, blocked: 'unrepresented_constraint' };
    const ymd = ymdOf(when);
    if (!start && ymd) {
      const endYmd = input.sleepHm <= input.wakeHm ? addDaysToYmd(ymd, 1) : ymd;
      return {
        opId: operation.opId,
        intent: commandIntent(name, {
          kind: 'window',
          taskId: resolution.entityId,
          taskName: name,
          summary: name,
          earliestStartTime: localDateTimeIso(ymd, input.wakeHm, input.timeZone),
          deadline: localDateTimeIso(endYmd, input.sleepHm, input.timeZone),
          scheduledStartTime: null,
          scheduledEndTime: null,
          clearUnscheduled: true,
          ...(seriesScope ? { seriesScope } : {}),
        }),
      };
    }
    if (!start) return { opId: operation.opId, intent: null, blocked: 'insufficient_move' };
    if (operation.changes.title) {
      return {
        opId: operation.opId,
        intent: commandIntent(operation.changes.title, {
          kind: 'update',
          taskId: resolution.entityId,
          taskName: name,
          summary: operation.changes.title,
          patch: { name: operation.changes.title, scheduledStartTime: start },
          ...(seriesScope ? { seriesScope } : {}),
        }),
      };
    }
    return {
      opId: operation.opId,
      intent: commandIntent(name, {
        kind: 'move',
        taskId: resolution.entityId,
        taskName: name,
        summary: name,
        scheduledStartTime: start,
        ...(seriesScope ? { seriesScope } : {}),
      }),
    };
  }
  if (operation.action !== 'update') return { opId: operation.opId, intent: null, blocked: 'unsupported_action' };
  if (label) return { opId: operation.opId, intent: null, blocked: 'unmapped_time', preservedLabel: label };
  if (hasRecurrence(operation) || operation.constraints.some((constraint) => constraint.kind === 'ordering') || operation.changes.reminder || operation.changes.spanRole) {
    return { opId: operation.opId, intent: null, blocked: 'unrepresented_constraint' };
  }
  const ymd = ymdOf(when);
  const end = instant(when, 'end');
  const patch: Record<string, unknown> = {
    ...(operation.changes.title ? { name: operation.changes.title } : {}),
    ...(operation.changes.priority ? { priority: operation.changes.priority } : {}),
    ...(operation.changes.notes !== undefined ? { description: operation.changes.notes } : {}),
    ...(operation.changes.location !== undefined ? { location: operation.changes.location } : {}),
    ...(operation.changes.status ? { status: operation.changes.status } : {}),
    ...(start ? { scheduledStartTime: start } : {}),
    ...(end ? { scheduledEndTime: end } : {}),
    ...(hasDuration ? { estimatedTimeInMinutes: duration(when, input.defaultDurationMinutes) } : {}),
  };
  if (!start && ymd) {
    const endYmd = input.sleepHm <= input.wakeHm ? addDaysToYmd(ymd, 1) : ymd;
    patch.earliestStartTime = localDateTimeIso(ymd, input.wakeHm, input.timeZone);
    patch.deadline = localDateTimeIso(endYmd, input.sleepHm, input.timeZone);
  }
  if (!Object.keys(patch).length) return { opId: operation.opId, intent: null, blocked: 'empty_patch' };
  return {
    opId: operation.opId,
    intent: commandIntent(operation.changes.title || name, {
      kind: 'update',
      taskId: resolution.entityId,
      taskName: name,
      summary: operation.changes.title || name,
      patch,
      ...(seriesScope ? { seriesScope } : {}),
    }),
  };
}

export function withinWriteCap(count: number): boolean {
  return count <= MAX_WRITES;
}

export const WRITE_CAP = MAX_WRITES;
