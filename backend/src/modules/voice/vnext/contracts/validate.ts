import { isYmd, normalizeHm } from '../../../day-reminders/day-reminder.dates';
import { VOICE_READ_TOOL_NAMES } from '../../voice-agent.tools';
import { FIND_EVENTS_ARGS, FIND_EVENTS_TOOL } from '../search/find-events';
import { FIND_TASKS_ARGS, FIND_TASKS_TOOL } from '../search/find-tasks';
import {
  RECURRENCE_PATTERNS,
  SEMANTIC_ACTIONS,
  TIME_OF_DAY_LABELS,
  type DayPlanEditV1,
  type RecurrencePatternV1,
  type TimeOfDayLabelV1,
  type OperationChangesV1,
  type ReadRequestV1,
  type SemanticConstraintV1,
  type SemanticEnvelopeV1,
  type SemanticOperationV1,
  type TargetRefV1,
  type ValidationIssue,
} from './types';

const TIME_LABELS: Record<string, TimeOfDayLabelV1> = {
  morning: 'morning',
  midday: 'midday',
  afternoon: 'afternoon',
  evening: 'evening',
  night: 'night',
  after_lunch: 'after_lunch',
  after_work: 'after_work',
  вечір: 'evening',
  ввечері: 'evening',
  ранок: 'morning',
  вранці: 'morning',
  ніч: 'night',
  вночі: 'night',
  обід: 'midday',
  опівдні: 'midday',
  'після обіду': 'after_lunch',
  'після роботи': 'after_work',
};

function canonicalTimeLabel(value: unknown): TimeOfDayLabelV1 | null {
  if (typeof value !== 'string') return null;
  return TIME_LABELS[value.trim().toLowerCase()] ?? null;
}

function liftAllDay(value: Record<string, unknown>): void {
  if (!isRecord(value.changes)) return;
  const role = value.changes.spanRole;
  if (role !== 'all_day' && role !== 'all-day') return;
  delete value.changes.spanRole;
  const constraints = Array.isArray(value.constraints) ? value.constraints : [];
  constraints.push({ kind: 'all_day' });
  value.constraints = constraints;
}

function normalizeEnvelopeShape(parsed: Record<string, unknown>): void {
  const kind = parsed.kind;
  if ((kind === 'clarification' || kind === 'answer' || kind === 'control' || kind === 'day_plan') && !Array.isArray(parsed.operations)) {
    parsed.operations = [];
  }
  if (kind === 'clarification' && !isRecord(parsed.clarification) && typeof parsed.question === 'string') {
    parsed.clarification = { question: parsed.question, operationIds: [], missing: [] };
    delete parsed.question;
  }
  if (kind === 'answer' && Array.isArray(parsed.evidenceRefs)) {
    const answer = isRecord(parsed.answer) ? parsed.answer : {};
    if (!Array.isArray(answer.evidenceRefs)) answer.evidenceRefs = parsed.evidenceRefs;
    parsed.answer = answer;
    delete parsed.evidenceRefs;
  }
  if (kind === 'control' && isRecord(parsed.control)) {
    const keys = Object.keys(parsed.control);
    const action = parsed.control.action;
    if (keys.length === 1 && keys[0] === 'action' && (action === 'confirm_pending' || action === 'cancel_pending' || action === 'answer_pending')) {
      parsed.control = action;
    }
  }
  if (!Array.isArray(parsed.requestedReads)) {
    const alias = parsed.reads ?? parsed.readRequests ?? parsed.requests;
    if (Array.isArray(alias)) {
      parsed.requestedReads = alias;
      delete parsed.reads;
      delete parsed.readRequests;
      delete parsed.requests;
    }
  }
}
// find_tasks is the structured voice's trusted set search; the legacy planner does not have it.
const READ_TOOLS = new Set<string>([...VOICE_READ_TOOL_NAMES, FIND_TASKS_TOOL, FIND_EVENTS_TOOL]);
const CHANGE_KEYS = new Set([
  'title',
  'notes',
  'priority',
  'status',
  'spanRole',
  'location',
  'reminder',
  'unschedule',
  'explicitNew',
]);
const PRIORITIES = new Set(['low', 'medium', 'high', 'urgent']);
const REMINDER_OPS = new Set(['create', 'update', 'resolve', 'delete']);
const REMINDER_PATTERNS = new Set(['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY']);
const READ_ARG_KEYS: Record<string, string[]> = {
  get_now_next: [],
  get_day_agenda: ['day'],
  list_unscheduled: [],
  list_problematic: [],
  find_free_gaps: ['day'],
  match_task: ['query'],
  get_task: ['taskId'],
  list_reminders: [],
  [FIND_TASKS_TOOL]: [...FIND_TASKS_ARGS],
  [FIND_EVENTS_TOOL]: [...FIND_EVENTS_ARGS],
};

export type ValidationResult =
  | { ok: true; envelope: SemanticEnvelopeV1 }
  | { ok: false; errors: ValidationIssue[] };

function issue(errors: ValidationIssue[], code: string, path: string, detail: string): void {
  errors.push({ code, path, detail });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function rejectUnknown(errors: ValidationIssue[], value: Record<string, unknown>, allowed: string[], path: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) issue(errors, 'unknown_field', `${path}.${key}`, key);
  }
}

function parseTarget(value: unknown, path: string, errors: ValidationIssue[]): TargetRefV1 | null {
  if (!isRecord(value)) {
    issue(errors, 'invalid_type', path, 'target');
    return null;
  }
  const kind = value.kind;
  if (kind === 'new' && typeof value.localId === 'string' && value.localId.trim()) {
    rejectUnknown(errors, value, ['kind', 'localId'], path);
    return { kind, localId: value.localId.trim() };
  }
  if (kind === 'existing') {
    if (typeof value.id === 'string' && typeof value.proposedId !== 'string') value.proposedId = value.id;
    if (typeof value.title === 'string' && typeof value.description !== 'string') value.description = value.title;
    delete value.id;
    delete value.title;
    rejectUnknown(errors, value, ['kind', 'proposedId', 'description', 'calendarId'], path);
    const proposedId = typeof value.proposedId === 'string' ? value.proposedId.trim() : undefined;
    const description = typeof value.description === 'string' ? value.description.trim() : undefined;
    const calendarId = typeof value.calendarId === 'string' ? value.calendarId.trim() : undefined;
    if (!proposedId && !description) issue(errors, 'empty_target', path, 'existing');
    return { kind, ...(proposedId ? { proposedId } : {}), ...(description ? { description } : {}), ...(calendarId ? { calendarId } : {}) };
  }
  // The model sometimes names the pending operation as proposedId / id (the fields of an existing target).
  // The pending id is the same thing: read it (V7, live baseline g-b-29 / g-c-12).
  if (kind === 'operation_result' && typeof value.opId !== 'string') {
    const alias = typeof value.proposedId === 'string' ? value.proposedId : typeof value.id === 'string' ? value.id : undefined;
    if (alias) value.opId = alias;
    delete value.proposedId;
    delete value.id;
    delete value.description;
  }
  if (kind === 'operation_result' && typeof value.opId === 'string' && value.opId.trim()) {
    rejectUnknown(errors, value, ['kind', 'opId'], path);
    return { kind, opId: value.opId.trim() };
  }
  if (kind === 'context' && typeof value.referentKey === 'string' && value.referentKey.trim()) {
    rejectUnknown(errors, value, ['kind', 'referentKey'], path);
    return { kind, referentKey: value.referentKey.trim() };
  }
  if (kind === 'unresolved' && typeof value.phrase === 'string' && value.phrase.trim()) {
    rejectUnknown(errors, value, ['kind', 'phrase'], path);
    return { kind, phrase: value.phrase.trim() };
  }
  issue(errors, 'unknown_target', path, String(kind));
  return null;
}

function parseConstraint(value: unknown, path: string, errors: ValidationIssue[]): SemanticConstraintV1 | null {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    issue(errors, 'invalid_type', path, 'constraint');
    return null;
  }
  switch (value.kind) {
    case 'date': {
      rejectUnknown(errors, value, ['kind', 'value', 'precision'], path);
      // A YYYY-MM-DD with no precision is a day (V7: the model omitted precision in 7 live corrections).
      if (value.precision === undefined && typeof value.value === 'string' && isYmd(value.value)) value.precision = 'day';
      if (value.precision !== 'day' && value.precision !== 'week' && value.precision !== 'month') {
        issue(errors, 'invalid_precision', path, String(value.precision));
        return null;
      }
      if (typeof value.value !== 'string') {
        issue(errors, 'invalid_type', path, 'value');
        return null;
      }
      if (value.precision === 'day' && value.value !== '' && !isYmd(value.value)) {
        issue(errors, 'invalid_date', path, value.value);
      }
      return { kind: 'date', value: value.value, precision: value.precision };
    }
    case 'relative_time': {
      rejectUnknown(errors, value, ['kind', 'anchor', 'direction', 'amount', 'unit'], path);
      const anchor = value.anchor;
      const direction = value.direction;
      if (anchor !== 'now' && anchor !== 'day_start' && anchor !== 'referenced_task') {
        issue(errors, 'invalid_anchor', path, String(anchor));
        return null;
      }
      if (direction !== 'before' && direction !== 'after') {
        issue(errors, 'invalid_direction', path, String(direction));
        return null;
      }
      if (value.unit !== undefined && value.unit !== 'minute' && value.unit !== 'hour' && value.unit !== 'day') {
        issue(errors, 'invalid_unit', path, String(value.unit));
        return null;
      }
      if (value.amount !== undefined && (typeof value.amount !== 'number' || value.amount < 0 || !Number.isFinite(value.amount))) {
        issue(errors, 'invalid_amount', path, String(value.amount));
        return null;
      }
      return {
        kind: 'relative_time',
        anchor,
        direction,
        ...(typeof value.amount === 'number' ? { amount: value.amount } : {}),
        ...(value.unit === 'minute' || value.unit === 'hour' || value.unit === 'day' ? { unit: value.unit } : {}),
      };
    }
    case 'time_of_day': {
      rejectUnknown(errors, value, ['kind', 'label', 'bound'], path);
      const label = canonicalTimeLabel(value.label);
      if (!label) {
        issue(errors, 'unknown_label', path, String(value.label));
        return null;
      }
      const bound = value.bound ?? 'at';
      if (bound !== 'at' && bound !== 'until' && bound !== 'not_before') {
        issue(errors, 'invalid_bound', path, String(bound));
        return null;
      }
      return { kind: 'time_of_day', label, bound };
    }
    case 'clock': {
      rejectUnknown(errors, value, ['kind', 'value', 'role'], path);
      const hm = typeof value.value === 'string' ? normalizeHm(value.value) : null;
      if (!hm) {
        issue(errors, 'invalid_clock', path, String(value.value));
        return null;
      }
      const role = value.role;
      if (role !== 'start' && role !== 'end' && role !== 'preferred' && role !== 'earliest' && role !== 'deadline') {
        issue(errors, 'invalid_role', path, String(role));
        return null;
      }
      return { kind: 'clock', value: hm, role };
    }
    case 'duration': {
      rejectUnknown(errors, value, ['kind', 'minutes'], path);
      if (typeof value.minutes !== 'number' || value.minutes < 5 || value.minutes > 24 * 60) {
        issue(errors, 'invalid_duration', path, String(value.minutes));
        return null;
      }
      return { kind: 'duration', minutes: value.minutes };
    }
    case 'recurrence': {
      rejectUnknown(errors, value, ['kind', 'expression', 'pattern', 'weekDays'], path);
      if (typeof value.expression !== 'string' || !value.expression.trim()) {
        issue(errors, 'empty_recurrence', path, 'expression');
        return null;
      }
      if (value.pattern !== undefined && !(RECURRENCE_PATTERNS as readonly string[]).includes(String(value.pattern))) {
        issue(errors, 'invalid_recurrence', path, String(value.pattern));
        return null;
      }
      if (value.weekDays !== undefined && (!Array.isArray(value.weekDays) || !value.weekDays.length || value.weekDays.some((day) => !Number.isInteger(day) || day < 0 || day > 6))) {
        issue(errors, 'invalid_recurrence', path, 'weekDays');
        return null;
      }
      return {
        kind: 'recurrence',
        expression: value.expression.trim(),
        ...(value.pattern ? { pattern: value.pattern as RecurrencePatternV1 } : {}),
        ...(Array.isArray(value.weekDays) ? { weekDays: [...new Set(value.weekDays as number[])].sort() } : {}),
      };
    }
    case 'ordering': {
      rejectUnknown(errors, value, ['kind', 'relation', 'target'], path);
      if (value.relation !== 'before' && value.relation !== 'after') {
        issue(errors, 'invalid_relation', path, String(value.relation));
        return null;
      }
      const target = parseTarget(value.target, `${path}.target`, errors);
      if (!target) return null;
      return { kind: 'ordering', relation: value.relation, target };
    }
    case 'day_bound': {
      rejectUnknown(errors, value, ['kind', 'edge', 'role'], path);
      if (value.edge !== 'wake' && value.edge !== 'sleep') {
        issue(errors, 'invalid_edge', path, String(value.edge));
        return null;
      }
      if (value.role !== 'earliest' && value.role !== 'deadline') {
        issue(errors, 'invalid_role', path, String(value.role));
        return null;
      }
      return { kind: 'day_bound', edge: value.edge, role: value.role };
    }
    case 'weekday': {
      rejectUnknown(errors, value, ['kind', 'weekday', 'which'], path);
      if (typeof value.weekday !== 'number' || value.weekday < 0 || value.weekday > 6) {
        issue(errors, 'invalid_weekday', path, String(value.weekday));
        return null;
      }
      if (value.which !== 'next' && value.which !== 'this') {
        issue(errors, 'invalid_which', path, String(value.which));
        return null;
      }
      return { kind: 'weekday', weekday: value.weekday, which: value.which };
    }
    case 'all_day': {
      rejectUnknown(errors, value, ['kind'], path);
      return { kind: 'all_day' };
    }
    default:
      issue(errors, 'unknown_constraint', path, value.kind);
      return null;
  }
}

function parseChanges(value: unknown, path: string, errors: ValidationIssue[]): OperationChangesV1 {
  if (!isRecord(value)) {
    issue(errors, 'invalid_type', path, 'changes');
    return {};
  }
  rejectUnknown(errors, value, [...CHANGE_KEYS], path);
  const changes: OperationChangesV1 = {};
  if ('title' in value) {
    if (typeof value.title !== 'string' || !value.title.trim()) issue(errors, 'invalid_title', path, 'title');
    else changes.title = value.title.trim();
  }
  if ('notes' in value) {
    if (value.notes !== null && typeof value.notes !== 'string') issue(errors, 'invalid_type', `${path}.notes`, 'notes');
    else changes.notes = value.notes as string | null;
  }
  if ('priority' in value) {
    if (!PRIORITIES.has(String(value.priority))) issue(errors, 'invalid_priority', path, String(value.priority));
    else changes.priority = value.priority as OperationChangesV1['priority'];
  }
  if ('status' in value) {
    if (value.status !== 'completed' && value.status !== 'canceled') issue(errors, 'invalid_status', path, String(value.status));
    else changes.status = value.status;
  }
  if ('spanRole' in value) {
    if (value.spanRole !== 'event' && value.spanRole !== 'window') issue(errors, 'invalid_span', path, String(value.spanRole));
    else changes.spanRole = value.spanRole;
  }
  if ('location' in value) {
    if (value.location !== null && typeof value.location !== 'string') issue(errors, 'invalid_type', `${path}.location`, 'location');
    else changes.location = value.location as string | null;
  }
  if ('unschedule' in value) {
    if (value.unschedule !== true) issue(errors, 'invalid_type', `${path}.unschedule`, 'unschedule');
    else changes.unschedule = true;
  }
  if ('explicitNew' in value) {
    if (value.explicitNew !== true && value.explicitNew !== false) issue(errors, 'invalid_type', `${path}.explicitNew`, 'explicitNew');
    else if (value.explicitNew) changes.explicitNew = true;
  }
  if ('reminder' in value) {
    if (!isRecord(value.reminder)) issue(errors, 'invalid_type', `${path}.reminder`, 'reminder');
    else {
      rejectUnknown(errors, value.reminder, ['op', 'name', 'dueYmd', 'notificationTime', 'recurrencePattern'], `${path}.reminder`);
      if (!REMINDER_OPS.has(String(value.reminder.op))) issue(errors, 'invalid_reminder_op', path, String(value.reminder.op));
      else {
        const reminder: NonNullable<OperationChangesV1['reminder']> = {
          op: value.reminder.op as NonNullable<OperationChangesV1['reminder']>['op'],
        };
        if ('name' in value.reminder) {
          if (typeof value.reminder.name !== 'string') issue(errors, 'invalid_type', `${path}.reminder.name`, 'name');
          else reminder.name = value.reminder.name.trim();
        }
        if ('dueYmd' in value.reminder) {
          if (typeof value.reminder.dueYmd !== 'string' || !isYmd(value.reminder.dueYmd)) {
            issue(errors, 'invalid_date', `${path}.reminder.dueYmd`, String(value.reminder.dueYmd));
          } else reminder.dueYmd = value.reminder.dueYmd;
        }
        if ('notificationTime' in value.reminder) {
          if (value.reminder.notificationTime === null) reminder.notificationTime = null;
          else {
            const hm = typeof value.reminder.notificationTime === 'string' ? normalizeHm(value.reminder.notificationTime) : null;
            if (!hm) issue(errors, 'invalid_clock', `${path}.reminder.notificationTime`, String(value.reminder.notificationTime));
            else reminder.notificationTime = hm;
          }
        }
        if ('recurrencePattern' in value.reminder) {
          if (value.reminder.recurrencePattern === null) reminder.recurrencePattern = null;
          else if (!REMINDER_PATTERNS.has(String(value.reminder.recurrencePattern))) {
            issue(errors, 'invalid_recurrence', path, String(value.reminder.recurrencePattern));
          } else {
            reminder.recurrencePattern = value.reminder.recurrencePattern as NonNullable<
              OperationChangesV1['reminder']
            >['recurrencePattern'];
          }
        }
        changes.reminder = reminder;
      }
    }
  }
  return changes;
}

function compatible(action: string, target: TargetRefV1 | null): boolean {
  if (!target) return false;
  if (action === 'create') return target.kind === 'new';
  if (action === 'remind') return target.kind !== 'operation_result' || true;
  return target.kind !== 'new';
}

function parseOperation(value: unknown, path: string, errors: ValidationIssue[], transcript: string): SemanticOperationV1 | null {
  if (!isRecord(value)) {
    issue(errors, 'invalid_type', path, 'operation');
    return null;
  }
  liftAllDay(value);
  rejectUnknown(errors, value, ['opId', 'action', 'target', 'changes', 'constraints', 'dependsOn', 'source', 'scope', 'seriesScope', 'occurrence'], path);
  const opId = typeof value.opId === 'string' ? value.opId.trim() : '';
  if (!/^op-[A-Za-z0-9-]{1,40}$/.test(opId)) issue(errors, 'invalid_op_id', path, opId || '(missing)');
  if (!(SEMANTIC_ACTIONS as readonly string[]).includes(String(value.action))) {
    issue(errors, 'unknown_action', path, String(value.action));
  }
  const target = parseTarget(value.target, `${path}.target`, errors);
  if (target && (SEMANTIC_ACTIONS as readonly string[]).includes(String(value.action)) && !compatible(String(value.action), target)) {
    issue(errors, 'incompatible_target', path, `${String(value.action)}:${target.kind}`);
  }
  const changes = parseChanges(value.changes ?? {}, `${path}.changes`, errors);
  if (!Array.isArray(value.constraints)) issue(errors, 'invalid_type', `${path}.constraints`, 'constraints');
  const constraints: SemanticConstraintV1[] = [];
  if (Array.isArray(value.constraints)) {
    value.constraints.forEach((row, index) => {
      const parsed = parseConstraint(row, `${path}.constraints[${index}]`, errors);
      if (parsed) constraints.push(parsed);
    });
  }
  if (!Array.isArray(value.dependsOn) || value.dependsOn.some((item) => typeof item !== 'string')) {
    issue(errors, 'invalid_type', `${path}.dependsOn`, 'dependsOn');
  }
  if (!isRecord(value.source) || typeof value.source.text !== 'string' || !value.source.text.trim()) {
    issue(errors, 'missing_source', path, 'source');
  } else {
    rejectUnknown(errors, value.source, ['text', 'span'], `${path}.source`);
    const text = value.source.text;
    if (!transcript.includes(text)) issue(errors, 'source_not_in_transcript', path, 'source.text');
    if (value.source.span !== undefined) {
      const span = value.source.span;
      if (!Array.isArray(span) || span.length !== 2 || typeof span[0] !== 'number' || typeof span[1] !== 'number') {
        issue(errors, 'invalid_span', path, 'span');
      } else if (span[0] < 0 || span[1] > transcript.length || span[0] > span[1] || transcript.slice(span[0], span[1]) !== text) {
        issue(errors, 'span_mismatch', path, text);
      }
    }
  }
  const dependsOn = Array.isArray(value.dependsOn) ? value.dependsOn.filter((item): item is string => typeof item === 'string') : [];
  let scope: 'one' | 'all' | undefined;
  if (value.scope !== undefined) {
    if (value.scope !== 'one' && value.scope !== 'all') issue(errors, 'invalid_scope', path, String(value.scope));
    else scope = value.scope;
  }
  let seriesScope: SemanticOperationV1['seriesScope'];
  if (value.seriesScope !== undefined) {
    if (value.seriesScope !== 'occurrence' && value.seriesScope !== 'from_day' && value.seriesScope !== 'all') {
      issue(errors, 'invalid_scope', path, String(value.seriesScope));
    } else seriesScope = value.seriesScope;
  }
  let occurrence: string | undefined;
  if (value.occurrence !== undefined) {
    if (typeof value.occurrence !== 'string' || !isYmd(value.occurrence)) issue(errors, 'invalid_occurrence', path, String(value.occurrence));
    else occurrence = value.occurrence;
  }
  if (!opId || !(SEMANTIC_ACTIONS as readonly string[]).includes(String(value.action)) || !target || !isRecord(value.source)) {
    return null;
  }
  return {
    opId,
    action: value.action as SemanticOperationV1['action'],
    target,
    changes,
    constraints,
    dependsOn,
    ...(scope ? { scope } : {}),
    ...(seriesScope ? { seriesScope } : {}),
    ...(occurrence ? { occurrence } : {}),
    source: {
      text: String(value.source.text),
      ...(Array.isArray(value.source.span) ? { span: [value.source.span[0] as number, value.source.span[1] as number] } : {}),
    },
  };
}

function parseRead(value: unknown, path: string, errors: ValidationIssue[]): ReadRequestV1 | null {
  if (!isRecord(value)) {
    issue(errors, 'invalid_type', path, 'read');
    return null;
  }
  const name = typeof value.name === 'string' ? value.name : typeof value.tool === 'string' ? value.tool : '';
  const args = isRecord(value.args) ? { ...value.args } : isRecord(value.arguments) ? { ...value.arguments } : null;
  if (args && name === 'get_day_agenda' && typeof args.date === 'string' && typeof args.day !== 'string') {
    args.day = args.date;
    delete args.date;
  }
  const requestId = typeof value.requestId === 'string' && value.requestId.trim()
    ? value.requestId.trim()
    : `r-${path.replace(/\D/g, '') || '1'}`;
  if (!READ_TOOLS.has(name)) issue(errors, 'unknown_tool', path, name || '(missing)');
  if (!args) issue(errors, 'invalid_type', `${path}.args`, 'args');
  else if (READ_TOOLS.has(name)) rejectUnknown(errors, args, READ_ARG_KEYS[name] ?? [], `${path}.args`);
  if (!READ_TOOLS.has(name) || !args) return null;
  return { requestId, name, args };
}

function parseDayEdit(value: unknown, path: string, errors: ValidationIssue[]): DayPlanEditV1 | null {
  if (!isRecord(value) || typeof value.op !== 'string') {
    issue(errors, 'invalid_type', path, 'edit');
    return null;
  }
  switch (value.op) {
    case 'add_task': {
      rejectUnknown(errors, value, ['op', 'name', 'durationMinutes', 'preferredHm', 'earliestHm', 'deadlineHm', 'qualitative'], path);
      if (typeof value.name !== 'string' || !value.name.trim()) {
        issue(errors, 'missing_name', path, 'name');
        return null;
      }
      return {
        op: 'add_task',
        name: value.name.trim(),
        durationMinutes: typeof value.durationMinutes === 'number' ? value.durationMinutes : null,
        preferredHm: typeof value.preferredHm === 'string' ? value.preferredHm : null,
        earliestHm: typeof value.earliestHm === 'string' ? value.earliestHm : null,
        deadlineHm: typeof value.deadlineHm === 'string' ? value.deadlineHm : null,
        ...(TIME_OF_DAY_LABELS.includes(value.qualitative as TimeOfDayLabelV1)
          ? { qualitative: value.qualitative as TimeOfDayLabelV1 }
          : {}),
      };
    }
    case 'include_task':
      rejectUnknown(errors, value, ['op', 'taskId'], path);
      if (typeof value.taskId !== 'string') return null;
      return { op: 'include_task', taskId: value.taskId };
    case 'remove_item':
      rejectUnknown(errors, value, ['op', 'itemId'], path);
      if (typeof value.itemId !== 'string') return null;
      return { op: 'remove_item', itemId: value.itemId };
    case 'set_preferred_start':
      rejectUnknown(errors, value, ['op', 'itemId', 'hm', 'qualitative'], path);
      if (typeof value.itemId !== 'string') return null;
      return {
        op: 'set_preferred_start',
        itemId: value.itemId,
        hm: typeof value.hm === 'string' ? value.hm : null,
      };
    case 'set_window':
      rejectUnknown(errors, value, ['op', 'itemId', 'earliestHm', 'deadlineHm'], path);
      if (typeof value.itemId !== 'string') return null;
      return {
        op: 'set_window',
        itemId: value.itemId,
        ...(value.earliestHm === null || typeof value.earliestHm === 'string' ? { earliestHm: value.earliestHm as string | null } : {}),
        ...(value.deadlineHm === null || typeof value.deadlineHm === 'string' ? { deadlineHm: value.deadlineHm as string | null } : {}),
      };
    case 'set_duration':
      rejectUnknown(errors, value, ['op', 'itemId', 'minutes'], path);
      if (typeof value.itemId !== 'string' || typeof value.minutes !== 'number') return null;
      return { op: 'set_duration', itemId: value.itemId, minutes: value.minutes };
    case 'set_order':
      rejectUnknown(errors, value, ['op', 'itemIds'], path);
      if (!Array.isArray(value.itemIds)) return null;
      return { op: 'set_order', itemIds: value.itemIds.filter((item): item is string => typeof item === 'string') };
    default:
      issue(errors, 'unknown_edit', path, value.op);
      return null;
  }
}

function stripJson(raw: string): unknown {
  const text = raw.trim();
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Strict parse. Embedded fragments are not recovered when the whole reply is not JSON. */
export function validateSemanticEnvelope(raw: string, transcript: string): ValidationResult {
  const errors: ValidationIssue[] = [];
  const parsed = stripJson(raw);
  if (!isRecord(parsed)) return { ok: false, errors: [{ code: 'invalid_json', path: '', detail: 'not a JSON object' }] };
  normalizeEnvelopeShape(parsed);
  rejectUnknown(
    errors,
    parsed,
    ['version', 'kind', 'operations', 'answer', 'clarification', 'control', 'dayPlan', 'requestedReads'],
    '$',
  );
  if (parsed.version !== '1') issue(errors, 'unknown_version', '$.version', String(parsed.version));
  const kind = parsed.kind;
  if (kind !== 'operations' && kind !== 'answer' && kind !== 'clarification' && kind !== 'day_plan' && kind !== 'control') {
    issue(errors, 'unknown_kind', '$.kind', String(kind));
  }
  if (!Array.isArray(parsed.operations)) issue(errors, 'invalid_type', '$.operations', 'operations');
  const operations: SemanticOperationV1[] = [];
  if (Array.isArray(parsed.operations)) {
    parsed.operations.forEach((row, index) => {
      const operation = parseOperation(row, `$.operations[${index}]`, errors, transcript);
      if (operation) operations.push(operation);
    });
  }
  const ids = new Set<string>();
  for (const operation of operations) {
    if (ids.has(operation.opId)) issue(errors, 'duplicate_op', operation.opId, operation.opId);
    ids.add(operation.opId);
    if (operation.dependsOn.includes(operation.opId)) issue(errors, 'self_dependency', operation.opId, operation.opId);
  }
  let answer: SemanticEnvelopeV1['answer'];
  if ('answer' in parsed && parsed.answer != null) {
    if (!isRecord(parsed.answer)) issue(errors, 'invalid_type', '$.answer', 'answer');
    else {
      rejectUnknown(errors, parsed.answer, ['text', 'evidenceRefs'], '$.answer');
      answer = {
        ...(typeof parsed.answer.text === 'string' ? { text: parsed.answer.text } : {}),
        ...(Array.isArray(parsed.answer.evidenceRefs)
          ? { evidenceRefs: parsed.answer.evidenceRefs.filter((item): item is string => typeof item === 'string') }
          : {}),
      };
    }
  }
  let clarification: SemanticEnvelopeV1['clarification'];
  if (kind === 'clarification') {
    if (!isRecord(parsed.clarification) || typeof parsed.clarification.question !== 'string' || !parsed.clarification.question.trim()) {
      issue(errors, 'missing_question', '$.clarification', 'question');
    } else {
      rejectUnknown(errors, parsed.clarification, ['question', 'operationIds', 'missing'], '$.clarification');
      clarification = {
        question: parsed.clarification.question.trim(),
        operationIds: Array.isArray(parsed.clarification.operationIds)
          ? parsed.clarification.operationIds.filter((item): item is string => typeof item === 'string')
          : [],
        missing: Array.isArray(parsed.clarification.missing)
          ? parsed.clarification.missing.filter((item): item is string => typeof item === 'string')
          : [],
      };
    }
  }
  let control: SemanticEnvelopeV1['control'];
  if (kind === 'control') {
    if (parsed.control !== 'confirm_pending' && parsed.control !== 'cancel_pending' && parsed.control !== 'answer_pending') {
      issue(errors, 'unknown_control', '$.control', String(parsed.control));
    } else control = parsed.control;
  }
  let dayPlan: SemanticEnvelopeV1['dayPlan'];
  if (kind === 'day_plan') {
    if (!isRecord(parsed.dayPlan)) issue(errors, 'missing_day_plan', '$.dayPlan', 'dayPlan');
    else {
      rejectUnknown(errors, parsed.dayPlan, ['phase', 'day', 'question', 'edits'], '$.dayPlan');
      const phase = parsed.dayPlan.phase;
      if (phase !== 'start' && phase !== 'edit' && phase !== 'question' && phase !== 'apply' && phase !== 'cancel') {
        issue(errors, 'unknown_phase', '$.dayPlan.phase', String(phase));
      } else {
        const edits: DayPlanEditV1[] = [];
        if (Array.isArray(parsed.dayPlan.edits)) {
          parsed.dayPlan.edits.forEach((row, index) => {
            const edit = parseDayEdit(row, `$.dayPlan.edits[${index}]`, errors);
            if (edit) edits.push(edit);
          });
        }
        if (typeof parsed.dayPlan.day === 'string' && parsed.dayPlan.day !== '' && !isYmd(parsed.dayPlan.day)) {
          issue(errors, 'invalid_date', '$.dayPlan.day', parsed.dayPlan.day);
        }
        dayPlan = {
          phase,
          ...(typeof parsed.dayPlan.day === 'string' ? { day: parsed.dayPlan.day } : {}),
          ...(typeof parsed.dayPlan.question === 'string' ? { question: parsed.dayPlan.question } : {}),
          edits,
        };
      }
    }
  }
  const requestedReads: ReadRequestV1[] = [];
  if (Array.isArray(parsed.requestedReads)) {
    parsed.requestedReads.forEach((row, index) => {
      const read = parseRead(row, `$.requestedReads[${index}]`, errors);
      if (read) requestedReads.push(read);
    });
  }
  if (kind === 'operations' && operations.length === 0) issue(errors, 'empty_operations', '$.operations', 'none');
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    envelope: {
      version: '1',
      kind: kind as SemanticEnvelopeV1['kind'],
      operations,
      ...(answer ? { answer } : {}),
      ...(clarification ? { clarification } : {}),
      ...(control ? { control } : {}),
      ...(dayPlan ? { dayPlan } : {}),
      ...(requestedReads.length ? { requestedReads } : {}),
    },
  };
}
