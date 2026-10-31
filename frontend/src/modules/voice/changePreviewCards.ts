import type {
  DayPlanProposal,
  DayPlanProposalItem,
  VoiceIntentExecutionStatus,
  VoiceTaskPatch,
  VoiceWriteIntent,
} from 'api/voice.api';
import i18n from 'i18n';
import { localHm, localYmd } from 'utils/ianaDateTime';
import { formatCivilYmd } from 'utils/formatDate';

export type ChangePreviewKind =
  | 'create'
  | 'move'
  | 'edit'
  | 'delete'
  | 'complete'
  | 'skip'
  | 'cancel'
  | 'window'
  | 'shift'
  | 'end_series'
  | 'remind'
  | 'other';

export type PreviewTaskType = 'fixed' | 'flexible' | 'unscheduled' | 'recurring';

export type PreviewSeriesScope = 'occurrence' | 'series' | 'all';

const SCOPE_LABEL_KEY: Record<PreviewSeriesScope, string> = {
  occurrence: 'voice.previewScopeOccurrence',
  series: 'voice.previewScopeSeries',
  all: 'voice.previewScopeAll',
};

export function changePreviewScopeLabelKey(scope: PreviewSeriesScope): string {
  return SCOPE_LABEL_KEY[scope];
}

/**
 * The series scope a command states. skip and end_series name one day by their kind; the other
 * commands carry seriesScope when they act on a repeating task. A one-off has none.
 */
function scopeOfCommand(command: { kind: string; seriesScope?: PreviewSeriesScope }): PreviewSeriesScope | undefined {
  if (command.kind === 'skip') return 'occurrence';
  if (command.kind === 'end_series') return 'series';
  return command.seriesScope;
}

export type ChangePreviewCard = {
  id: string;
  name: string;
  kind: ChangePreviewKind;
  /** Scheduling behavior (or Later). Null when this change does not say it. */
  taskType: PreviewTaskType | null;
  /** The task repeats. Independent of `taskType`: a fixed series is fixed + repeats. */
  repeats?: boolean;
  /** Which part of a repeating task a command touches: one day, this day and following, or the whole series. */
  scope?: PreviewSeriesScope;
  startIso: string | null;
  endIso: string | null;
  durationMinutes: number | null;
  color: string;
  /** Day plan: new or moved since the previous revision. */
  changed?: boolean;
  /** After apply: what happened to this intent. */
  status?: VoiceIntentExecutionStatus;
};

const PLAN_SOURCE_KIND: Record<DayPlanProposalItem['source'], ChangePreviewKind> = {
  new: 'create',
  flexible: 'shift',
  unscheduled: 'window',
};

// Card accents follow the semantic tokens: neutral change, delete, done, skip.
const DEFAULT_COLOR = 'rgb(var(--ide-link))';
const DELETE_COLOR = 'rgb(var(--ide-error))';
const COMPLETE_COLOR = 'rgb(var(--ide-accent))';
const SKIP_COLOR = 'rgb(var(--ide-warn))';

const KIND_LABEL_KEY: Record<ChangePreviewKind, string> = {
  create: 'voice.previewCreate',
  move: 'voice.previewMove',
  edit: 'voice.previewEdit',
  delete: 'voice.previewDelete',
  complete: 'voice.previewComplete',
  skip: 'voice.previewSkip',
  cancel: 'voice.previewCancel',
  window: 'voice.previewWindow',
  shift: 'voice.previewShift',
  end_series: 'voice.previewEndSeries',
  remind: 'voice.previewReminder',
  other: 'voice.previewEdit',
};

export function changePreviewKindLabelKey(kind: ChangePreviewKind): string {
  return KIND_LABEL_KEY[kind];
}

function minutesBetween(startIso: string | null, endIso: string | null): number | null {
  if (!startIso || !endIso) return null;
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null;
  return Math.max(1, Math.round((end - start) / 60000));
}

function colorForKind(kind: ChangePreviewKind | string): string {
  if (kind === 'delete' || kind === 'cancel' || kind === 'end_series') return DELETE_COLOR;
  if (kind === 'complete') return COMPLETE_COLOR;
  if (kind === 'skip') return SKIP_COLOR;
  return DEFAULT_COLOR;
}

function kindFromCommand(kind: string): ChangePreviewKind {
  switch (kind) {
    case 'move':
    case 'shift':
    case 'window':
    case 'complete':
    case 'skip':
    case 'delete':
    case 'cancel':
    case 'end_series':
      return kind;
    case 'update':
      return 'edit';
    default:
      return 'other';
  }
}

function asIso(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function taskTypeOf(fields: {
  isUnscheduled?: boolean | null;
  isRecurring?: boolean | null;
  eventType?: string | null;
}, fallbackFlexible: boolean): PreviewTaskType | null {
  if (fields.isUnscheduled) return 'unscheduled';
  if (fields.eventType === 'fixed') return 'fixed';
  if (fields.eventType === 'admin' || fallbackFlexible) return 'flexible';
  return null;
}

function typeFromPatch(patch: VoiceTaskPatch): PreviewTaskType | null {
  if (patch.eventType === 'fixed') return 'fixed';
  if (patch.eventType === 'admin') return 'flexible';
  return null;
}

/** Date in the user's zone, plus a clock when one was stored. Midnight is a day, not a time. */
export function formatPreviewWhen(
  card: Pick<ChangePreviewCard, 'startIso' | 'endIso'>,
  timeZone: string,
  unscheduledLabel: string,
): string {
  const start = card.startIso;
  const end = card.endIso && card.endIso !== start ? card.endIso : null;
  if (!start && !end) return unscheduledLabel;
  if (start && end) {
    const startDay = localYmd(start, timeZone);
    const endDay = localYmd(end, timeZone);
    if (startDay === endDay) {
      const day = civilDay(startDay);
      const startClock = wallClock(start, timeZone);
      const endClock = wallClock(end, timeZone);
      if (startClock && endClock) return `${day}, ${startClock}–${endClock}`;
      if (startClock) return `${day}, ${startClock}`;
      if (endClock) return `${day}, ${i18n.t('voice.seatUntil', { when: endClock })}`;
      return day;
    }
    return `${stamp(start, timeZone)} – ${stamp(end, timeZone)}`;
  }
  return stamp((start || end) as string, timeZone);
}

function stamp(iso: string, timeZone: string): string {
  const day = civilDay(localYmd(iso, timeZone));
  const clock = wallClock(iso, timeZone);
  return clock ? `${day}, ${clock}` : day;
}

function civilDay(ymd: string): string {
  return formatCivilYmd(ymd) || ymd;
}

function wallClock(iso: string, timeZone: string): string | null {
  if (/T00:00/.test(iso)) return null;
  const hm = localHm(iso, timeZone);
  return hm === '00:00' ? null : hm;
}

function cardFromIntent(intent: VoiceWriteIntent, index: number): ChangePreviewCard {
  if (intent.type === 'create') {
    const task = intent.task;
    const scheduledStart = asIso(task.scheduledStartTime);
    const scheduledEnd = asIso(task.scheduledEndTime);
    const earliest = asIso(task.earliestStartTime);
    const deadline = asIso(task.deadline);
    let startIso = scheduledStart || earliest;
    let endIso = scheduledEnd;
    if (!scheduledStart && !scheduledEnd && deadline && deadline !== startIso) {
      if (startIso) endIso = deadline;
      else startIso = deadline;
    }
    if (task.isUnscheduled) {
      startIso = deadline;
      endIso = null;
    }
    const duration =
      typeof task.estimatedTimeInMinutes === 'number' && task.estimatedTimeInMinutes > 0
        ? task.estimatedTimeInMinutes
        : minutesBetween(startIso, endIso);
    return {
      id: `create-${index}-${task.name}`,
      name: task.name || intent.summary,
      kind: 'create',
      taskType: taskTypeOf(task, true),
      repeats: !!task.isRecurring,
      startIso,
      endIso,
      durationMinutes: duration,
      color: colorForKind('create'),
    };
  }

  const command = intent.command;
  if (String(command.kind || '').startsWith('remind_')) {
    const due = 'dueYmd' in command && typeof command.dueYmd === 'string' ? command.dueYmd : '';
    const clock =
      'notificationTime' in command && typeof command.notificationTime === 'string'
        ? command.notificationTime
        : '';
    const name = 'name' in command && typeof command.name === 'string' ? command.name : intent.summary;
    return {
      id: `remind-${index}-${name}`,
      name: name || intent.summary,
      kind: 'remind',
      taskType: null,
      startIso: due ? `${due}T${clock || '00:00'}:00` : null,
      endIso: null,
      durationMinutes: null,
      color: colorForKind(command.kind === 'remind_delete' ? 'delete' : 'remind'),
    };
  }
  if (command.kind === 'edit_occurrence') {
    // WP-B: one day of a series (or this day and following). Completion of the day is a done card; any
    // other change is an edit of that day. The card shows the new start when there is one, else the day.
    const kind: ChangePreviewKind = command.status === 'completed' ? 'complete' : 'edit';
    const scope: PreviewSeriesScope = command.scope === 'following' ? 'series' : 'occurrence';
    return {
      id: `command-${index}-${command.taskId}-${kind}-${command.occurrenceStart}`,
      name: command.name || command.taskName || intent.summary,
      kind,
      taskType: null,
      repeats: true,
      scope,
      startIso: command.start ?? command.occurrenceStart,
      endIso: null,
      durationMinutes: typeof command.durationMinutes === 'number' && command.durationMinutes > 0 ? command.durationMinutes : null,
      color: colorForKind(kind),
    };
  }
  const kind = kindFromCommand(String(command.kind || ''));
  if (command.kind === 'update') {
    const patch = command.patch;
    const startIso = asIso(patch.scheduledStartTime) || asIso(patch.earliestStartTime);
    let endIso = asIso(patch.scheduledEndTime);
    const deadline = asIso(patch.deadline);
    if (!endIso && deadline && deadline !== startIso) endIso = deadline;
    const duration =
      typeof patch.estimatedTimeInMinutes === 'number' && patch.estimatedTimeInMinutes > 0
        ? patch.estimatedTimeInMinutes
        : minutesBetween(startIso, endIso);
    const scope = scopeOfCommand(command);
    return {
      id: `command-${index}-${command.taskId}-${kind}`,
      name: command.taskName || intent.summary,
      kind,
      taskType: typeFromPatch(patch),
      ...(patch.isRecurring || scope ? { repeats: true } : {}),
      ...(scope ? { scope } : {}),
      startIso,
      endIso,
      durationMinutes: duration,
      color: colorForKind(kind),
    };
  }

  let startIso: string | null = null;
  let endIso: string | null = null;

  if ('start' in command && typeof command.start === 'string') startIso = command.start;
  if ('end' in command && typeof command.end === 'string') endIso = command.end;
  if (!startIso && 'scheduledStartTime' in command && typeof command.scheduledStartTime === 'string') {
    startIso = command.scheduledStartTime;
  }
  if (!endIso && 'scheduledEndTime' in command && typeof command.scheduledEndTime === 'string') {
    endIso = command.scheduledEndTime;
  }
  if (!startIso && 'earliestStartTime' in command && typeof command.earliestStartTime === 'string') {
    startIso = command.earliestStartTime;
  }
  if (!endIso && 'deadline' in command && typeof command.deadline === 'string') {
    endIso = command.deadline;
  }
  if (!startIso && 'occurrenceStart' in command && typeof command.occurrenceStart === 'string') {
    startIso = command.occurrenceStart;
  }

  const name =
    ('taskName' in command && typeof command.taskName === 'string' && command.taskName) ||
    intent.summary ||
    kind;

  const scope = scopeOfCommand(command);
  return {
    id: `command-${index}-${String(('taskId' in command && command.taskId) || name)}-${kind}`,
    name,
    kind,
    taskType: null,
    ...(scope ? { repeats: true, scope } : {}),
    startIso,
    endIso,
    durationMinutes: minutesBetween(startIso, endIso),
    color: colorForKind(kind),
  };
}

export function buildChangePreviewCards(input: {
  intents?: VoiceWriteIntent[] | null;
  plan?: DayPlanProposal | null;
  statuses?: VoiceIntentExecutionStatus[] | null;
}): ChangePreviewCard[] {
  if (input.plan?.items?.length) {
    const changed = new Set(input.plan.changedItemIds ?? []);
    return input.plan.items.map((item) => {
      const kind = PLAN_SOURCE_KIND[item.source] ?? 'window';
      return {
        id: `plan-${item.itemId}`,
        name: item.name,
        kind,
        taskType: item.source === 'unscheduled' ? 'unscheduled' : 'flexible',
        startIso: item.start,
        endIso: item.end,
        durationMinutes: item.durationMinutes || minutesBetween(item.start, item.end),
        color: colorForKind(kind),
        changed: changed.has(item.itemId),
      };
    });
  }

  const intents = input.intents?.filter(Boolean) ?? [];
  return intents.map((intent, index) => ({
    ...cardFromIntent(intent, index),
    status: input.statuses?.[index],
  }));
}
